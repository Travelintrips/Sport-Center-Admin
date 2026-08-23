import { Router } from "express";
import { asc, eq, sql } from "drizzle-orm";
import { db, paymentSettlementConfigsTable } from "@workspace/db";
import { adminMiddleware } from "../lib/auth";
import { logAudit, getClientInfo, getUserFromReq } from "../lib/auditLog";

const router = Router();

function asPositiveInt(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} tidak valid`);
  return parsed;
}

router.get("/admin/payment-settlement-configs", adminMiddleware, async (req, res) => {
  try {
    const companyId = req.query.companyId ? asPositiveInt(req.query.companyId, "Company") : null;
    // Settlement ownership uses the canonical Supabase company master.
    // Do not use sport_center.users here: those are login/customer identities
    // and their IDs do not necessarily match facility_company_mappings.company_id.
    const companiesResult = await db.execute(sql`
      SELECT
        id,
        code,
        COALESCE(
          NULLIF(BTRIM(name), ''),
          NULLIF(BTRIM(company_name), ''),
          NULLIF(BTRIM(code), ''),
          'Company #' || id::text
        ) AS name
      FROM public.companies
      WHERE is_active = TRUE
      ORDER BY name, code
    `);

    const bankAccountsResult = await db.execute(sql`
      SELECT id, company_id, bank_name, name, account_number, coa_id, is_active
      FROM public.company_bank_accounts
      WHERE (${companyId}::integer IS NULL OR company_id = ${companyId})
      ORDER BY company_id, name, account_number
    `);

    const configs = await db
      .select()
      .from(paymentSettlementConfigsTable)
      .where(companyId ? eq(paymentSettlementConfigsTable.companyId, companyId) : undefined)
      .orderBy(asc(paymentSettlementConfigsTable.companyId), asc(paymentSettlementConfigsTable.effectiveFrom));

    const companyRows = ((companiesResult as any).rows ?? companiesResult) as Array<{
      id: number | string;
      code: string | null;
      name: string;
    }>;

    res.json({
      // This is intentionally sourced from public.companies, the canonical
      // Supabase company master. The db package selects the DEV or PROD
      // Supabase URL based on NODE_ENV, so the same endpoint stays isolated
      // between environments.
      companies: companyRows.map((company) => ({
        id: Number(company.id),
        code: company.code,
        name: company.name,
      })),
      bankAccounts: (bankAccountsResult as any).rows ?? bankAccountsResult,
      configs,
    });
  } catch (err) {
    req.log.error({ err }, "List payment settlement configs error");
    res.status(400).json({ error: err instanceof Error ? err.message : "Gagal memuat konfigurasi settlement" });
  }
});

router.post("/admin/payment-settlement-configs/bank-accounts", adminMiddleware, async (req, res) => {
  try {
    const companyId = asPositiveInt(req.body.companyId, "Company");
    const bankName = String(req.body.bankName ?? "").trim();
    const name = String(req.body.name ?? "").trim();
    const accountNumber = String(req.body.accountNumber ?? "").trim();
    const coaId = req.body.coaId == null || req.body.coaId === "" ? null : asPositiveInt(req.body.coaId, "COA");
    if (!bankName || !name || !accountNumber) {
      res.status(400).json({ error: "Bank, nama rekening, dan nomor rekening wajib diisi" });
      return;
    }

    const companyResult = await db.execute(sql`
      SELECT id
      FROM public.companies
      WHERE id = ${companyId}
        AND is_active = TRUE
      LIMIT 1
    `);
    if (!((companyResult as any).rows ?? companyResult)[0]) {
      res.status(400).json({ error: "Company tidak ditemukan" });
      return;
    }

    const result = await db.execute(sql`
      INSERT INTO public.company_bank_accounts
        (company_id, bank_name, name, account_number, coa_id, is_active, created_at, updated_at)
      VALUES
        (${companyId}, ${bankName}, ${name}, ${accountNumber}, ${coaId}, TRUE, NOW(), NOW())
      RETURNING id, company_id, bank_name, name, account_number, coa_id, is_active
    `);
    const account = ((result as any).rows ?? result)[0];
    await logAudit({
      ...getUserFromReq(req),
      action: "COMPANY_BANK_ACCOUNT_CREATED",
      entity: "company_bank_account",
      entityId: Number(account.id),
      after: account,
      ...getClientInfo(req),
    });
    res.status(201).json(account);
  } catch (err: any) {
    req.log.error({ err }, "Create company bank account error");
    res.status(400).json({ error: String(err?.message ?? "Gagal membuat rekening perusahaan") });
  }
});

router.post("/admin/payment-settlement-configs/rules", adminMiddleware, async (req, res) => {
  try {
    const companyId = asPositiveInt(req.body.companyId, "Company");
    const bankAccountId = String(req.body.bankAccountId ?? "").trim();
    const effectiveFrom = String(req.body.effectiveFrom ?? "").trim();
    const effectiveUntil = req.body.effectiveUntil ? String(req.body.effectiveUntil).trim() : null;
    const delay = Number(req.body.settlementDelayBusinessDays ?? 1);
    if (!bankAccountId || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || !Number.isInteger(delay) || delay < 0) {
      res.status(400).json({ error: "Rekening, tanggal efektif, dan delay settlement tidak valid" });
      return;
    }

    const accountResult = await db.execute(sql`
      SELECT id
      FROM public.company_bank_accounts
      WHERE company_id = ${companyId}
        AND account_number = ${bankAccountId}
        AND is_active = TRUE
      LIMIT 1
    `);
    if (!((accountResult as any).rows ?? accountResult)[0]) {
      res.status(400).json({ error: "Rekening aktif tersebut belum terdaftar untuk company ini" });
      return;
    }

    const [config] = await db
      .insert(paymentSettlementConfigsTable)
      .values({
        companyId,
        providerCode: "mandiri_direct",
        bankAccountId,
        settlementDelayBusinessDays: delay,
        effectiveFrom,
        effectiveUntil,
        isActive: true,
        source: "OWNER_APPROVED",
      })
      .returning();
    await logAudit({
      ...getUserFromReq(req),
      action: "PAYMENT_SETTLEMENT_RULE_CREATED",
      entity: "payment_settlement_config",
      entityId: config.id,
      after: config,
      ...getClientInfo(req),
    });
    res.status(201).json(config);
  } catch (err: any) {
    req.log.error({ err }, "Create payment settlement rule error");
    res.status(400).json({ error: String(err?.message ?? "Gagal membuat settlement rule") });
  }
});

export default router;