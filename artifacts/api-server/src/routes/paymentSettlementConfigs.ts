import { Router } from "express";
import { asc, eq, sql } from "drizzle-orm";
import { auditLogsTable, db, paymentSettlementConfigsTable } from "@workspace/db";
import { adminMiddleware } from "../lib/auth";
import { logAudit, getClientInfo, getUserFromReq } from "../lib/auditLog";

const router = Router();
const SETTLEMENT_PROVIDER = "mandiri_direct";

class SettlementRuleRequestError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "SettlementRuleRequestError";
  }
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dayBefore(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function parseRuleIds(value: unknown): number[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  const ids = values.map((item) => Number(item));
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new SettlementRuleRequestError("ID rule yang akan ditutup tidak valid");
  }
  return [...new Set(ids)];
}

function ruleStatus(config: {
  isActive: boolean;
  effectiveFrom: string;
  effectiveUntil: string | null;
}, today = new Date().toISOString().slice(0, 10)): "active" | "scheduled" | "ended" | "inactive" {
  if (!config.isActive) return "inactive";
  if (config.effectiveFrom > today) return "scheduled";
  if (config.effectiveUntil && config.effectiveUntil < today) return "ended";
  return "active";
}

function sendSettlementRuleError(req: any, res: any, err: unknown, fallback: string): void {
  const statusCode = err instanceof SettlementRuleRequestError ? err.statusCode : 400;
  const error = err instanceof Error ? err.message : fallback;
  const details = err instanceof SettlementRuleRequestError ? err.details : {};
  req.log.error({ err }, fallback);
  res.status(statusCode).json({ error, ...details });
}

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

    const today = new Date().toISOString().slice(0, 10);
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
      configs: (configs as any[]).map((config) => ({
        ...config,
        status: ruleStatus(config, today),
      })),
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
    const auditContext = { ...getUserFromReq(req), ...getClientInfo(req) };
    const companyId = asPositiveInt(req.body.companyId, "Company");
    const bankAccountId = String(req.body.bankAccountId ?? "").trim();
    const effectiveFrom = String(req.body.effectiveFrom ?? "").trim();
    const effectiveUntil = req.body.effectiveUntil ? String(req.body.effectiveUntil).trim() : null;
    const delay = Number(req.body.settlementDelayBusinessDays ?? 1);
    const closeRuleIds = parseRuleIds(req.body.closeRuleIds ?? req.body.closeRuleId);
    if (!bankAccountId || !isValidIsoDate(effectiveFrom) || (effectiveUntil != null && !isValidIsoDate(effectiveUntil)) || !Number.isInteger(delay) || delay < 0) {
      res.status(400).json({ error: "Rekening, tanggal efektif, dan delay settlement tidak valid" });
      return;
    }
    if (effectiveUntil != null && effectiveUntil < effectiveFrom) {
      res.status(400).json({ error: "Tanggal efektif sampai tidak boleh sebelum tanggal efektif mulai" });
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

    const { config } = await db.transaction(async (tx) => {
      // Serialize rule changes for this company/provider. The overlap check and
      // any explicit period closure must commit together with the new rule.
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtext(${`payment-settlement-config:${companyId}:${SETTLEMENT_PROVIDER}`})
        )
      `);

      const overlappingResult = await tx.execute(sql`
        SELECT id, company_id, provider_code, bank_account_id,
               settlement_delay_business_days, effective_from::text,
               effective_until::text, is_active, source, created_at, updated_at
          FROM sport_center.payment_settlement_configs
         WHERE company_id = ${companyId}
           AND provider_code = ${SETTLEMENT_PROVIDER}
           AND is_active = TRUE
           AND effective_from <= COALESCE(${effectiveUntil}::date, '9999-12-31'::date)
           AND (effective_until IS NULL OR effective_until >= ${effectiveFrom}::date)
         FOR UPDATE
      `);
      const overlappingRules = (((overlappingResult as any).rows ?? overlappingResult) as Array<Record<string, unknown>>);
      const overlapIds = overlappingRules.map((rule) => Number(rule.id));

      if (overlapIds.length > 0) {
        const requestedIds = [...closeRuleIds].sort((a, b) => a - b);
        const requiredIds = [...overlapIds].sort((a, b) => a - b);
        const hasDifferentTerms = overlappingRules.some(
          (rule) => String(rule.bank_account_id) !== bankAccountId ||
            Number(rule.settlement_delay_business_days) !== delay,
        );
        if (requestedIds.length !== requiredIds.length || requestedIds.some((id, index) => id !== requiredIds[index])) {
          throw new SettlementRuleRequestError(
            hasDifferentTerms
              ? "Periode rule bertumpang tindih dengan rekening atau delay settlement yang berbeda. Tutup semua rule lama yang ditampilkan secara eksplisit terlebih dahulu."
              : "Periode rule bertumpang tindih dengan rule aktif. Konfirmasi penutupan semua rule lama yang ditampilkan untuk melanjutkan.",
            409,
            {
              code: "SETTLEMENT_RULE_OVERLAP",
              requiresExplicitClose: true,
              overlaps: overlappingRules.map((rule) => ({
                id: Number(rule.id),
                bankAccountId: String(rule.bank_account_id),
                settlementDelayBusinessDays: Number(rule.settlement_delay_business_days),
                effectiveFrom: String(rule.effective_from),
                effectiveUntil: rule.effective_until == null ? null : String(rule.effective_until),
              })),
            },
          );
        }

      }

      const revisionRule = overlappingRules
        .filter((rule) => String(rule.effective_from) === effectiveFrom)
        .sort((left, right) => Number(right.id) - Number(left.id))[0] ?? null;
      const changedRules: Array<{
        before: Record<string, unknown>;
        after: Record<string, unknown>;
        action:
          | "PAYMENT_SETTLEMENT_RULE_CLOSED"
          | "PAYMENT_SETTLEMENT_RULE_DEACTIVATED"
          | "PAYMENT_SETTLEMENT_RULE_REVISED";
      }> = [];
      for (const rule of overlappingRules) {
        if (revisionRule && Number(rule.id) === Number(revisionRule.id)) continue;
        const previousEffectiveFrom = String(rule.effective_from);
        const shouldDeactivate =
          previousEffectiveFrom >= effectiveFrom &&
          (rule.effective_until == null || String(rule.effective_until) >= effectiveFrom);
        const updateValues = shouldDeactivate
          ? { isActive: false, updatedAt: new Date() }
          : { effectiveUntil: dayBefore(effectiveFrom), updatedAt: new Date() };
        const [closed] = await tx
          .update(paymentSettlementConfigsTable)
          .set(updateValues)
          .where(eq(paymentSettlementConfigsTable.id, Number(rule.id)))
          .returning();
        changedRules.push({
          before: rule,
          after: closed as Record<string, unknown>,
          action: shouldDeactivate
            ? "PAYMENT_SETTLEMENT_RULE_DEACTIVATED"
            : "PAYMENT_SETTLEMENT_RULE_CLOSED",
        });
      }

      let config: Record<string, unknown>;
      if (revisionRule) {
        const [revised] = await tx
          .update(paymentSettlementConfigsTable)
          .set({
            companyId,
            providerCode: SETTLEMENT_PROVIDER,
            bankAccountId,
            settlementDelayBusinessDays: delay,
            effectiveFrom,
            effectiveUntil,
            isActive: true,
            source: "OWNER_APPROVED",
            updatedAt: new Date(),
          })
          .where(eq(paymentSettlementConfigsTable.id, Number(revisionRule.id)))
          .returning();
        config = revised as Record<string, unknown>;
      } else {
        const [created] = await tx
          .insert(paymentSettlementConfigsTable)
          .values({
            companyId,
            providerCode: SETTLEMENT_PROVIDER,
            bankAccountId,
            settlementDelayBusinessDays: delay,
            effectiveFrom,
            effectiveUntil,
            isActive: true,
            source: "OWNER_APPROVED",
          })
          .returning();
        config = created as Record<string, unknown>;
      }

      // Settlement rules are financial configuration. Their audit records must
      // be committed atomically with the period changes, never best-effort.
      for (const changedRule of changedRules) {
        await tx.insert(auditLogsTable).values({
          ...auditContext,
          action: changedRule.action,
          entity: "payment_settlement_config",
          entityId: Number(changedRule.after.id),
          before: changedRule.before as any,
          after: changedRule.after as any,
        });
      }
      await tx.insert(auditLogsTable).values({
        ...auditContext,
        action: revisionRule
          ? "PAYMENT_SETTLEMENT_RULE_REVISED"
          : "PAYMENT_SETTLEMENT_RULE_CREATED",
        entity: "payment_settlement_config",
        entityId: Number(config.id),
        after: {
          ...config,
          closedRuleIds: changedRules
            .filter((rule) => rule.action === "PAYMENT_SETTLEMENT_RULE_CLOSED")
            .map((rule) => Number(rule.after.id)),
          deactivatedRuleIds: changedRules
            .filter((rule) => rule.action === "PAYMENT_SETTLEMENT_RULE_DEACTIVATED")
            .map((rule) => Number(rule.after.id)),
          revisedRuleId: revisionRule ? Number(revisionRule.id) : null,
        } as any,
      });
      return { config };
    });

    res.status(201).json(config);
  } catch (err: any) {
    sendSettlementRuleError(req, res, err, "Create payment settlement rule error");
  }
});

router.patch("/admin/payment-settlement-configs/rules/:id", adminMiddleware, async (req, res) => {
  try {
    const auditContext = { ...getUserFromReq(req), ...getClientInfo(req) };
    const id = asPositiveInt(req.params.id, "Rule");
    const action = String(req.body.action ?? "").trim().toLowerCase();
    if (action !== "deactivate" && action !== "close") {
      throw new SettlementRuleRequestError("Aksi rule tidak valid. Gunakan deactivate atau close.");
    }

    const result = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(paymentSettlementConfigsTable)
        .where(eq(paymentSettlementConfigsTable.id, id))
        .limit(1);
      if (!current) throw new SettlementRuleRequestError("Rule settlement tidak ditemukan", 404);

      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtext(${`payment-settlement-config:${current.companyId}:${current.providerCode}`})
        )
      `);
      const [existing] = await tx
        .select()
        .from(paymentSettlementConfigsTable)
        .where(eq(paymentSettlementConfigsTable.id, id))
        .for("update")
        .limit(1);
      if (!existing) throw new SettlementRuleRequestError("Rule settlement tidak ditemukan", 404);

      if (action === "deactivate") {
        if (!existing.isActive) {
          throw new SettlementRuleRequestError("Rule settlement sudah nonaktif", 409);
        }
        const today = new Date().toISOString().slice(0, 10);
        if (existing.effectiveFrom <= today) {
          throw new SettlementRuleRequestError(
            "Hanya rule yang belum mulai berlaku yang dapat dinonaktifkan. Tutup periode rule aktif agar histori settlement tetap dapat ditelusuri.",
            409,
            { code: "SETTLEMENT_RULE_HISTORICAL_DEACTIVATION_BLOCKED" },
          );
        }
        const [updated] = await tx
          .update(paymentSettlementConfigsTable)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(paymentSettlementConfigsTable.id, id))
          .returning();
        const auditAction = "PAYMENT_SETTLEMENT_RULE_DEACTIVATED";
        await tx.insert(auditLogsTable).values({
          ...auditContext,
          action: auditAction,
          entity: "payment_settlement_config",
          entityId: id,
          before: existing as any,
          after: updated as any,
        });
        return { after: updated, action: auditAction };
      }

      const effectiveUntil = String(req.body.effectiveUntil ?? "").trim();
      if (!isValidIsoDate(effectiveUntil) || effectiveUntil < existing.effectiveFrom) {
        throw new SettlementRuleRequestError("Tanggal penutupan tidak valid atau sebelum tanggal mulai rule");
      }
      if (existing.effectiveUntil && effectiveUntil > existing.effectiveUntil) {
        throw new SettlementRuleRequestError("Penutupan hanya boleh memperpendek periode rule, bukan membukanya kembali");
      }
      if (existing.effectiveUntil === effectiveUntil) {
        throw new SettlementRuleRequestError("Rule settlement sudah ditutup pada tanggal tersebut", 409);
      }
      const today = new Date().toISOString().slice(0, 10);
      if (existing.effectiveFrom <= today && effectiveUntil < today) {
        throw new SettlementRuleRequestError(
          "Penutupan manual tidak boleh berlaku surut. Pilih hari ini atau tanggal mendatang agar histori settlement tidak berubah.",
          409,
          { code: "SETTLEMENT_RULE_RETROACTIVE_CLOSE_BLOCKED" },
        );
      }
      const [updated] = await tx
        .update(paymentSettlementConfigsTable)
        .set({ effectiveUntil, updatedAt: new Date() })
        .where(eq(paymentSettlementConfigsTable.id, id))
        .returning();
      const auditAction = "PAYMENT_SETTLEMENT_RULE_CLOSED";
      await tx.insert(auditLogsTable).values({
        ...auditContext,
        action: auditAction,
        entity: "payment_settlement_config",
        entityId: id,
        before: existing as any,
        after: updated as any,
      });
      return { after: updated, action: auditAction };
    });

    res.json(result.after);
  } catch (err: any) {
    sendSettlementRuleError(req, res, err, "Update payment settlement rule error");
  }
});

export default router;