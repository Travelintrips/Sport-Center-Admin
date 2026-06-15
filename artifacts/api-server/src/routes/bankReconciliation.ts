import { Router } from "express";
import { db } from "@workspace/db";
import {
  bankMutationsTable,
  bankReconciliationMatchesTable,
  bankJournalEntriesTable,
  bankReconciliationAccountRulesTable,
  bankReconciliationClosingTable,
  bankAccountBalancesTable,
  bookingsTable,
  paymentsTable,
  facilitiesTable,
  auditLogsTable,
  companyInvoicesTable,
  companyInvoiceItemsTable,
} from "@workspace/db";
import { eq, desc, and, inArray, sql, gte, lte, isNull } from "drizzle-orm";
import { adminMiddleware, financeMiddleware, superAdminMiddleware } from "../lib/auth";
import { runBankAudit } from "../lib/bankAudit";
import {
  normalizeDescription,
  extractOrderId,
  extractProviderName,
  buildMutationKey,
  runMatching,
} from "../lib/bankMatcher";
import { writeApprovalToSheetRow, isGoogleSheetsConfigured } from "../lib/googleSheets";
import * as XLSX from "xlsx";
import multer from "multer";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Module-level helper — dipanggil dari /approve DAN /approve-candidate
// Memperbarui status payment/booking + settlement invoice perusahaan
async function propagateApproval(
  type: string | undefined,
  id: number | undefined,
  auditCtx?: { userId?: number; userRole?: string; ipAddress?: string; userAgent?: string },
) {
  if (!type || !id) return;
  const CONFIRMABLE = ["pending_payment", "waiting_confirmation"];
  const ctx = auditCtx ?? {};

  if (type === "payment") {
    const [pmt] = await db.select({
      bookingId: paymentsTable.bookingId,
      amount: paymentsTable.amount,
    }).from(paymentsTable).where(eq(paymentsTable.id, id)).limit(1);

    await db.update(paymentsTable).set({ status: "confirmed", updatedAt: new Date() }).where(eq(paymentsTable.id, id));
    await db.insert(auditLogsTable).values({
      userId: ctx.userId, userRole: ctx.userRole,
      action: "payment_confirmed_via_recon", entity: "payment", entityId: id,
      after: { status: "confirmed", source: "bank_reconciliation" },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    if (pmt?.bookingId) {
      const updated = await db.update(bookingsTable).set({ status: "confirmed", updatedAt: new Date() }).where(
        and(eq(bookingsTable.id, pmt.bookingId), inArray(bookingsTable.status, CONFIRMABLE as any[]))
      ).returning({ id: bookingsTable.id });
      if (updated.length > 0) {
        await db.insert(auditLogsTable).values({
          userId: ctx.userId, userRole: ctx.userRole,
          action: "booking_confirmed_via_recon", entity: "booking", entityId: pmt.bookingId,
          after: { status: "confirmed", source: "bank_reconciliation" },
          ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
        });
      }

      // Invoice partial payment settlement
      const [invoiceItem] = await db.select({ invoiceId: companyInvoiceItemsTable.invoiceId })
        .from(companyInvoiceItemsTable)
        .where(eq(companyInvoiceItemsTable.bookingId, pmt.bookingId))
        .limit(1);
      if (invoiceItem) {
        await settleInvoice(invoiceItem.invoiceId!, parseFloat(pmt.amount ?? "0"), ctx);
      }
    }
  } else if (type === "order") {
    const updated = await db.update(bookingsTable).set({ status: "confirmed", updatedAt: new Date() }).where(
      and(eq(bookingsTable.id, id), inArray(bookingsTable.status, CONFIRMABLE as any[]))
    ).returning({ id: bookingsTable.id });
    if (updated.length > 0) {
      await db.insert(auditLogsTable).values({
        userId: ctx.userId, userRole: ctx.userRole,
        action: "booking_confirmed_via_recon", entity: "booking", entityId: id,
        after: { status: "confirmed", source: "bank_reconciliation" },
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
      });

      // Invoice partial payment settlement via order booking total
      const [invoiceItem] = await db.select({
        invoiceId: companyInvoiceItemsTable.invoiceId,
        totalAmount: companyInvoiceItemsTable.totalAmount,
      }).from(companyInvoiceItemsTable).where(eq(companyInvoiceItemsTable.bookingId, id)).limit(1);
      if (invoiceItem) {
        await settleInvoice(invoiceItem.invoiceId!, parseFloat(invoiceItem.totalAmount ?? "0"), ctx);
      }
    }
  }
  // type === 'expense': tidak ada booking/payment/invoice yang perlu di-update
}

// ===== Period Lock Helper =====
// Cek apakah tanggal transaksi jatuh di periode yang sudah ditutup
async function isPeriodLocked(transactionDate: string, bankAccountId?: string | null): Promise<boolean> {
  if (!transactionDate) return false;
  const year = parseInt(transactionDate.slice(0, 4));
  const month = parseInt(transactionDate.slice(5, 7));
  if (isNaN(year) || isNaN(month)) return false;

  // Cek closing global (tanpa bankAccountId) ATAU closing per rekening ini
  const conds: any[] = [
    eq(bankReconciliationClosingTable.periodYear, year),
    eq(bankReconciliationClosingTable.periodMonth, month),
    eq(bankReconciliationClosingTable.status, "closed"),
  ];
  const [locked] = await db.select({ id: bankReconciliationClosingTable.id })
    .from(bankReconciliationClosingTable)
    .where(and(...conds))
    .limit(1);
  return !!locked;
}

// ===== Bank Balance Ledger Helper =====
// Rekalkkulasi dan upsert saldo bank berdasarkan semua mutasi approved untuk rekening ini
async function updateBankBalance(bankAccountId: string, companyId?: number | null): Promise<void> {
  if (!bankAccountId) return;
  try {
    const { rows } = await db.execute(sql`
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE direction = 'IN'  AND status = 'approved'), 0) AS total_in,
        COALESCE(SUM(amount) FILTER (WHERE direction = 'OUT' AND status = 'approved'), 0) AS total_out
      FROM sport_center.bank_mutations
      WHERE bank_account_id = ${bankAccountId}
    `);
    const stats = (rows as any[])[0] ?? {};
    const currentBalance = parseFloat(stats.total_in ?? "0") - parseFloat(stats.total_out ?? "0");

    // Upsert: on conflict do update
    if (companyId != null) {
      await db.execute(sql`
        INSERT INTO sport_center.bank_account_balances (bank_account_id, company_id, current_balance, updated_at)
        VALUES (${bankAccountId}, ${companyId}, ${currentBalance}, NOW())
        ON CONFLICT (bank_account_id, company_id) DO UPDATE SET
          current_balance = EXCLUDED.current_balance,
          updated_at = NOW()
      `);
    } else {
      await db.execute(sql`
        INSERT INTO sport_center.bank_account_balances (bank_account_id, company_id, current_balance, updated_at)
        VALUES (${bankAccountId}, NULL, ${currentBalance}, NOW())
        ON CONFLICT (bank_account_id, company_id) DO UPDATE SET
          current_balance = EXCLUDED.current_balance,
          updated_at = NOW()
      `);
    }
  } catch {
    // non-fatal: balance update failure should not block the main flow
  }
}

async function settleInvoice(
  invoiceId: number,
  paymentAmount: number,
  ctx: { userId?: number; userRole?: string; ipAddress?: string; userAgent?: string },
) {
  if (!invoiceId || paymentAmount <= 0) return;
  const [invoice] = await db.select().from(companyInvoicesTable).where(eq(companyInvoicesTable.id, invoiceId)).limit(1);
  if (!invoice || invoice.status === "paid") return;

  const currentPaid = parseFloat(invoice.paidAmount ?? "0");
  const grandTotal = parseFloat(invoice.grandTotal ?? "0");
  const newPaid = currentPaid + paymentAmount;
  const newRemaining = Math.max(0, grandTotal - newPaid);
  const newStatus: "paid" | "partial_paid" | "unpaid" =
    newPaid >= grandTotal ? "paid" : newPaid > 0 ? "partial_paid" : "unpaid";

  await db.update(companyInvoicesTable).set({
    paidAmount: String(newPaid),
    remainingAmount: String(newRemaining),
    status: newStatus,
    paidAt: newStatus === "paid" ? new Date() : null,
  }).where(eq(companyInvoicesTable.id, invoiceId));

  await db.insert(auditLogsTable).values({
    userId: ctx.userId, userRole: ctx.userRole,
    action: "invoice_partial_payment", entity: "company_invoice", entityId: invoiceId,
    after: { paidAmount: newPaid, remainingAmount: newRemaining, status: newStatus, source: "bank_reconciliation" },
    ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
  });
}

// Peta akun akuntansi double-entry
const ACCOUNT_MAP = {
  BANK:        { code: "1001", name: "Kas/Bank" },
  BOOKING_REV: { code: "4001", name: "Pendapatan Booking" },
  ADVANCE:     { code: "2001", name: "Uang Muka Diterima" },
  BANK_FEE:    { code: "6001", name: "Biaya Administrasi Bank" },
  REFUND:      { code: "2002", name: "Refund Payable" },
  VENDOR:      { code: "6002", name: "Beban Vendor/Pemasok" },
  RENT:        { code: "6003", name: "Beban Sewa" },
  OPERATIONAL: { code: "6005", name: "Beban Operasional" },
  TAX:         { code: "2003", name: "Hutang Pajak" },
  OTHER:       { code: "6099", name: "Beban Lain-lain" },
};

// Post jurnal akuntansi — hanya dipanggil saat status final = approved
// Idempotent: jika accountingPosted sudah true, tidak ada jurnal baru
// Phase 2: coba dynamic COA lookup, fallback ke ACCOUNT_MAP
async function postAccountingJournal(
  mutation: {
    id: number; transactionDate: string; amount: string | null; direction: string;
    description: string; accountingPosted: boolean;
    bankAccountId?: string | null; taxType?: string | null; transactionType?: string | null;
  },
  candidateType: string | undefined,
  candidateId: number | undefined,
  postedBy?: string,
): Promise<string | null> {
  if (mutation.accountingPosted) return null;

  const amount = parseFloat(mutation.amount ?? "0");
  if (amount <= 0) return null;

  const journalId = `JRN-${mutation.transactionDate.replace(/-/g, "").slice(0, 8)}-${String(mutation.id).padStart(6, "0")}`;
  const memo = mutation.description.slice(0, 200);

  let debitCode: string, debitName: string, creditCode: string, creditName: string;

  // --- Dynamic COA lookup (Phase 2) ---
  const lookupType =
    (mutation.direction === "OUT" && mutation.taxType) ? mutation.taxType :
    mutation.transactionType ??
    (candidateType ?? (mutation.direction === "IN" ? "payment" : "OTHER"));

  const ruleConditions: any[] = [
    eq(bankReconciliationAccountRulesTable.direction, mutation.direction),
    eq(bankReconciliationAccountRulesTable.transactionType, lookupType),
    eq(bankReconciliationAccountRulesTable.isActive, true),
  ];
  if (mutation.bankAccountId) {
    ruleConditions.push(eq(bankReconciliationAccountRulesTable.bankAccountId, mutation.bankAccountId));
  }
  const [specificRule] = await db.select().from(bankReconciliationAccountRulesTable)
    .where(and(...ruleConditions)).orderBy(desc(bankReconciliationAccountRulesTable.id)).limit(1);

  let rule = specificRule;
  if (!rule && mutation.bankAccountId) {
    const [generalRule] = await db.select().from(bankReconciliationAccountRulesTable)
      .where(and(
        eq(bankReconciliationAccountRulesTable.direction, mutation.direction),
        eq(bankReconciliationAccountRulesTable.transactionType, lookupType),
        eq(bankReconciliationAccountRulesTable.isActive, true),
        isNull(bankReconciliationAccountRulesTable.bankAccountId),
      )).orderBy(desc(bankReconciliationAccountRulesTable.id)).limit(1);
    rule = generalRule;
  }

  if (rule) {
    debitCode = rule.debitCoaId; debitName = rule.debitCoaName;
    creditCode = rule.creditCoaId; creditName = rule.creditCoaName;
  } else if (mutation.direction === "IN") {
    // Fallback ACCOUNT_MAP IN
    debitCode = ACCOUNT_MAP.BANK.code; debitName = ACCOUNT_MAP.BANK.name;
    if (candidateType === "payment" || candidateType === "order") {
      creditCode = ACCOUNT_MAP.BOOKING_REV.code; creditName = ACCOUNT_MAP.BOOKING_REV.name;
    } else {
      creditCode = ACCOUNT_MAP.ADVANCE.code; creditName = ACCOUNT_MAP.ADVANCE.name;
    }
  } else {
    // Fallback ACCOUNT_MAP OUT
    creditCode = ACCOUNT_MAP.BANK.code; creditName = ACCOUNT_MAP.BANK.name;
    if (candidateType === "expense" && candidateId) {
      if (candidateId < 900000) {
        debitCode = ACCOUNT_MAP.REFUND.code; debitName = ACCOUNT_MAP.REFUND.name;
      } else if (candidateId === 900001) {
        debitCode = ACCOUNT_MAP.BANK_FEE.code; debitName = ACCOUNT_MAP.BANK_FEE.name;
      } else if (candidateId === 900002) {
        debitCode = ACCOUNT_MAP.REFUND.code; debitName = ACCOUNT_MAP.REFUND.name;
      } else if (candidateId === 900003) {
        debitCode = ACCOUNT_MAP.RENT.code; debitName = ACCOUNT_MAP.RENT.name;
      } else if (candidateId === 900004) {
        debitCode = ACCOUNT_MAP.VENDOR.code; debitName = ACCOUNT_MAP.VENDOR.name;
      } else if (candidateId === 900005) {
        debitCode = ACCOUNT_MAP.OPERATIONAL.code; debitName = ACCOUNT_MAP.OPERATIONAL.name;
      } else if (candidateId === 900006) {
        debitCode = ACCOUNT_MAP.TAX.code; debitName = ACCOUNT_MAP.TAX.name;
      } else {
        debitCode = ACCOUNT_MAP.OTHER.code; debitName = ACCOUNT_MAP.OTHER.name;
      }
    } else {
      debitCode = ACCOUNT_MAP.OTHER.code; debitName = ACCOUNT_MAP.OTHER.name;
    }
  }

  await db.insert(bankJournalEntriesTable).values({
    journalId,
    mutationId: mutation.id,
    companyId: (mutation as any).companyId ?? null,
    direction: mutation.direction,
    amount: String(amount),
    debitAccountCode: debitCode,
    debitAccountName: debitName,
    creditAccountCode: creditCode,
    creditAccountName: creditName,
    memo,
    candidateType: candidateType ?? null,
    candidateId: candidateId ?? null,
    postedAt: new Date(),
    postedBy: postedBy ?? null,
  });

  await db.update(bankMutationsTable).set({
    accountingPosted: true,
    journalId,
    updatedAt: new Date(),
  }).where(eq(bankMutationsTable.id, mutation.id));

  return journalId;
}

function parseRows(rows: any[]): Array<{
  transactionDate: string;
  description: string;
  creditAmount: number;
  debitAmount: number;
  bankAccountId?: string;
}> {
  return rows
    .map((row) => {
      const normalized: Record<string, any> = {};
      for (const [k, v] of Object.entries(row)) {
        normalized[k.toLowerCase().replace(/[\s\-\.]+/g, "_")] = v;
      }

      const dateRaw =
        normalized["tanggal"] ??
        normalized["transaction_date"] ??
        normalized["date"] ??
        normalized["tgl"] ??
        "";
      const description =
        String(
          normalized["keterangan"] ??
          normalized["description"] ??
          normalized["ket"] ??
          normalized["narasi"] ??
          normalized["deskripsi"] ??
          ""
        ).trim();
      const creditRaw =
        normalized["credit"] ??
        normalized["kredit"] ??
        normalized["cr"] ??
        normalized["masuk"] ??
        normalized["credit_amount"] ??
        "0";
      const debitRaw =
        normalized["debit"] ??
        normalized["db"] ??
        normalized["keluar"] ??
        normalized["debit_amount"] ??
        "0";
      const bankAccountId = String(
        normalized["rekening"] ??
        normalized["account"] ??
        normalized["bank_account"] ??
        normalized["no_rek"] ??
        ""
      ).trim() || undefined;

      const parseIndonesianNumber = (raw: any): number => {
        const s = String(raw ?? "").trim();
        if (!s || s === "-") return 0;
        // Indonesian format: "1.250.000,50" → dot=thousands, comma=decimal
        // International format: "1,250,000.50" → comma=thousands, dot=decimal
        const hasDotAndComma = s.includes(".") && s.includes(",");
        if (hasDotAndComma) {
          const lastDot = s.lastIndexOf(".");
          const lastComma = s.lastIndexOf(",");
          if (lastComma > lastDot) {
            // Indonesian: "1.250,50" → remove dots, replace comma with dot
            return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
          } else {
            // International: "1,250.50" → remove commas
            return parseFloat(s.replace(/,/g, "")) || 0;
          }
        }
        // Only comma: "1250,50" → likely Indonesian decimal
        if (s.includes(",") && !s.includes(".")) {
          return parseFloat(s.replace(",", ".")) || 0;
        }
        // Only dot: heuristik — jika dot diikuti tepat 3 digit di akhir = pemisah ribuan Indonesia
        // Contoh: "1.250" → 1250, "1.250.000" → 1250000, "1.25" → 1.25 (desimal)
        const dotParts = s.split(".");
        if (dotParts.length > 1 && dotParts.slice(1).every((p) => p.length === 3)) {
          // Semua bagian setelah titik punya tepat 3 digit → format ribuan
          return parseFloat(s.replace(/\./g, "")) || 0;
        }
        return parseFloat(s.replace(/[^0-9.]/g, "")) || 0;
      };
      const credit = parseIndonesianNumber(creditRaw);
      const debit = parseIndonesianNumber(debitRaw);

      let transactionDate = "";
      if (dateRaw) {
        const raw = String(dateRaw).trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
          transactionDate = raw.slice(0, 10);
        } else if (/^\d{2}\/\d{2}\/\d{4}/.test(raw)) {
          const [d, m, y] = raw.split("/");
          transactionDate = `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
        } else if (/^\d{2}-\d{2}-\d{4}/.test(raw)) {
          const [d, m, y] = raw.split("-");
          transactionDate = `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
        } else {
          const n = Number(raw);
          if (!isNaN(n) && n > 40000) {
            const date = XLSX.SSF.parse_date_code(n);
            transactionDate = `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
          }
        }
      }

      if (!transactionDate || !description) return null;

      return { transactionDate, description, creditAmount: credit, debitAmount: debit, bankAccountId };
    })
    .filter(Boolean) as any[];
}

// POST /bank-reconciliation/import
router.post("/bank-reconciliation/import", adminMiddleware, upload.single("file"), async (req, res) => {
  try {
    let rows: any[] = [];

    if (req.file) {
      const wb = XLSX.read(req.file.buffer, { type: "buffer", cellDates: false });
      const sheet = wb.Sheets[wb.SheetNames[0]!]!;
      rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    } else if (req.body?.rows) {
      if (!Array.isArray(req.body.rows)) {
        res.status(400).json({ error: "rows harus berupa array" });
        return;
      }
      if (req.body.rows.length > 5000) {
        res.status(400).json({ error: "Terlalu banyak baris — maksimum 5.000 baris per import" });
        return;
      }
      rows = req.body.rows;
    } else {
      res.status(400).json({ error: "Upload file Excel/CSV atau kirim data rows[]" });
      return;
    }

    const parsed = parseRows(rows);
    if (!parsed.length) {
      res.status(400).json({ error: "Tidak ada baris valid ditemukan. Pastikan kolom: Tanggal, Keterangan, Credit, Debit." });
      return;
    }

    let inserted = 0;
    let skipped = 0;
    const insertedIds: number[] = [];

    for (const row of parsed) {
      const credit = row.creditAmount;
      const debit = row.debitAmount;
      const amount = credit > 0 ? credit : debit;
      const direction = credit > 0 ? "IN" : "OUT";

      if (amount <= 0) { skipped++; continue; }

      const mutationKey = buildMutationKey(row.transactionDate, amount, direction as "IN" | "OUT");
      const normDesc = normalizeDescription(row.description);
      const providerOrderId = extractOrderId(row.description);
      const providerName = extractProviderName(row.description);

      const [existing] = await db
        .select({ id: bankMutationsTable.id })
        .from(bankMutationsTable)
        .where(
          and(
            eq(bankMutationsTable.mutationKey, mutationKey),
            eq(bankMutationsTable.description, row.description)
          )
        )
        .limit(1);

      if (existing) { skipped++; continue; }

      const [rec] = await db
        .insert(bankMutationsTable)
        .values({
          bankAccountId: row.bankAccountId,
          transactionDate: row.transactionDate,
          description: row.description,
          creditAmount: String(credit),
          debitAmount: String(debit),
          amount: String(amount),
          direction,
          mutationKey,
          normalizedDescription: normDesc,
          providerName,
          providerOrderId,
          rawPayload: row,
          status: "unmatched",
        })
        .returning({ id: bankMutationsTable.id });

      if (rec) { insertedIds.push(rec.id); inserted++; }
    }

    let matchResult = { processed: 0, autoMatched: 0, needsReview: 0, unmatched: 0, duplicates: 0 };
    if (insertedIds.length) {
      matchResult = await runMatching(insertedIds);
    }

    res.json({
      ok: true,
      total: parsed.length,
      inserted,
      skipped,
      matching: matchResult,
    });
  } catch (err: any) {
    req.log.error({ err }, "Bank reconciliation import error");
    res.status(500).json({ error: err?.message ?? "Gagal import mutasi" });
  }
});

// GET /bank-reconciliation/mutations
router.get("/bank-reconciliation/mutations", adminMiddleware, async (req, res) => {
  try {
    const { status, dateFrom, dateTo, minAmount, maxAmount, search, direction, page = "1", pageSize = "50" } = req.query as Record<string, string>;

    let query = db.select().from(bankMutationsTable).$dynamic();
    const conditions = [];

    if (status && status !== "all") {
      if (status === "approved_unposted") {
        conditions.push(eq(bankMutationsTable.status, "approved"));
        conditions.push(eq(bankMutationsTable.accountingPosted, false));
      } else {
        conditions.push(inArray(bankMutationsTable.status, [status as any]));
      }
    }
    if (dateFrom) conditions.push(gte(bankMutationsTable.transactionDate, dateFrom));
    if (dateTo) conditions.push(lte(bankMutationsTable.transactionDate, dateTo));
    const minAmt = Number(minAmount); if (minAmount && !isNaN(minAmt)) conditions.push(sql`${bankMutationsTable.amount} >= ${minAmt}`);
    const maxAmt = Number(maxAmount); if (maxAmount && !isNaN(maxAmt)) conditions.push(sql`${bankMutationsTable.amount} <= ${maxAmt}`);
    if (direction && direction !== "all") conditions.push(eq(bankMutationsTable.direction, direction));
    if (search) {
      conditions.push(
        sql`(${bankMutationsTable.description} ILIKE ${"%" + search + "%"} OR ${bankMutationsTable.normalizedDescription} ILIKE ${"%" + search + "%"} OR ${bankMutationsTable.providerName} ILIKE ${"%" + search + "%"})`
      );
    }

    if (conditions.length) query = query.where(and(...conditions)) as any;

    const limit = Math.min(Number(pageSize) || 50, 200);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const mutations = await query
      .orderBy(desc(bankMutationsTable.transactionDate), desc(bankMutationsTable.id))
      .limit(limit)
      .offset(offset);

    let countQuery = db.select({ total: sql<number>`count(*)::int` }).from(bankMutationsTable).$dynamic();
    if (conditions.length) countQuery = countQuery.where(and(...conditions)) as any;
    const [{ total }] = await countQuery;

    // Status counts: bangun kondisi baru TANPA filter status — untuk stats bar yang akurat
    // Sengaja dibangun terpisah (bukan filter dari conditions[]) agar tidak bergantung pada urutan array
    const baseConditions: ReturnType<typeof gte>[] = [];
    if (dateFrom) baseConditions.push(gte(bankMutationsTable.transactionDate, dateFrom) as any);
    if (dateTo) baseConditions.push(lte(bankMutationsTable.transactionDate, dateTo) as any);
    if (minAmount) baseConditions.push(sql`${bankMutationsTable.amount} >= ${Number(minAmount)}` as any);
    if (maxAmount) baseConditions.push(sql`${bankMutationsTable.amount} <= ${Number(maxAmount)}` as any);
    if (direction && direction !== "all") baseConditions.push(eq(bankMutationsTable.direction, direction) as any);
    if (search) {
      baseConditions.push(
        sql`(${bankMutationsTable.description} ILIKE ${"%" + search + "%"} OR ${bankMutationsTable.normalizedDescription} ILIKE ${"%" + search + "%"} OR ${bankMutationsTable.providerName} ILIKE ${"%" + search + "%"})` as any
      );
    }

    const statusCountsRows = await (baseConditions.length
      ? db
          .select({ status: bankMutationsTable.status, count: sql<number>`count(*)::int` })
          .from(bankMutationsTable)
          .where(and(...baseConditions))
          .groupBy(bankMutationsTable.status)
      : db
          .select({ status: bankMutationsTable.status, count: sql<number>`count(*)::int` })
          .from(bankMutationsTable)
          .groupBy(bankMutationsTable.status)
    );
    const statusCounts: Record<string, number> = {};
    for (const r of statusCountsRows) {
      if (r.status) statusCounts[r.status] = r.count;
    }

    res.json({ mutations, total, page: Number(page), pageSize: limit, statusCounts });
  } catch (err: any) {
    req.log.error({ err }, "Bank reconciliation list error");
    res.status(500).json({ error: err?.message ?? "Gagal memuat mutasi" });
  }
});

// GET /bank-reconciliation/matches/:mutationId
router.get("/bank-reconciliation/matches/:mutationId", adminMiddleware, async (req, res) => {
  try {
    const mutationId = Number(req.params["mutationId"]);
    if (isNaN(mutationId)) { res.status(400).json({ error: "Invalid mutation ID" }); return; }

    const [mutation] = await db
      .select()
      .from(bankMutationsTable)
      .where(eq(bankMutationsTable.id, mutationId))
      .limit(1);

    if (!mutation) { res.status(404).json({ error: "Mutasi tidak ditemukan" }); return; }

    const { rows } = await db.execute(sql`
      SELECT
        m.id,
        m.mutation_id        AS "mutationId",
        m.candidate_type     AS "candidateType",
        m.candidate_id       AS "candidateId",
        m.match_score        AS "matchScore",
        m.match_reason       AS "matchReason",
        m.amount_match       AS "amountMatch",
        m.date_match         AS "dateMatch",
        m.name_match         AS "nameMatch",
        m.order_id_match     AS "orderIdMatch",
        m.proof_match        AS "proofMatch",
        m.note,
        m.status,
        m.created_at         AS "createdAt",
        -- Payment enrichment (candidateType = 'payment')
        p.proof_url          AS "proofUrl",
        p.ocr_name           AS "ocrName",
        p.ocr_amount         AS "ocrAmount",
        p.ocr_date           AS "ocrDate",
        p.ocr_raw            AS "ocrRaw",
        p.status             AS "paymentStatus",
        p.booking_id         AS "paymentBookingId",
        -- Booking enrichment via payment (candidateType = 'payment')
        bp.order_number      AS "bookingOrderNumber",
        bp.customer_name     AS "customerName",
        bp.customer_phone    AS "customerPhone",
        bp.booking_date      AS "bookingDate",
        bp.status            AS "bookingStatus",
        COALESCE(bp.grand_total, bp.total_price)::text AS "bookingAmount",
        fp.name              AS "facilityName",
        -- Order booking enrichment (candidateType = 'order')
        bo.order_number      AS "orderOrderNumber",
        bo.customer_name     AS "orderCustomerName",
        bo.customer_phone    AS "orderCustomerPhone",
        bo.booking_date      AS "orderBookingDate",
        bo.status            AS "orderBookingStatus",
        COALESCE(bo.grand_total, bo.total_price)::text AS "orderBookingAmount",
        fo.name              AS "orderFacilityName"
      FROM sport_center.bank_reconciliation_matches m
      -- Payment join
      LEFT JOIN sport_center.payments p
        ON p.id = m.candidate_id AND m.candidate_type = 'payment'
      -- Booking via payment
      LEFT JOIN sport_center.bookings bp
        ON bp.id = p.booking_id AND m.candidate_type = 'payment'
      LEFT JOIN sport_center.facilities fp
        ON fp.id = bp.facility_id AND m.candidate_type = 'payment'
      -- Direct order/booking join
      LEFT JOIN sport_center.bookings bo
        ON bo.id = m.candidate_id AND m.candidate_type = 'order'
      LEFT JOIN sport_center.facilities fo
        ON fo.id = bo.facility_id AND m.candidate_type = 'order'
      WHERE m.mutation_id = ${mutationId}
      ORDER BY m.match_score DESC
    `);

    // Normalise: untuk candidateType='order' salin field order* ke field utama agar UI konsisten
    const matches = (rows as any[]).map((r) => {
      if (r.candidateType === "order") {
        return {
          ...r,
          bookingOrderNumber: r.orderOrderNumber ?? r.bookingOrderNumber,
          customerName: r.orderCustomerName ?? r.customerName,
          customerPhone: r.orderCustomerPhone ?? r.customerPhone,
          bookingDate: r.orderBookingDate ?? r.bookingDate,
          bookingStatus: r.orderBookingStatus ?? r.bookingStatus,
          bookingAmount: r.orderBookingAmount ?? r.bookingAmount,
          facilityName: r.orderFacilityName ?? r.facilityName,
        };
      }
      return r;
    });

    res.json({ mutation, matches });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Gagal memuat kandidat" });
  }
});

// POST /bank-reconciliation/:mutationId/approve
router.post("/bank-reconciliation/:mutationId/approve", adminMiddleware, async (req, res) => {
  try {
    const mutationId = Number(req.params["mutationId"]);
    const { matchId, candidateType, candidateId } = req.body as {
      matchId?: number;
      candidateType?: string;
      candidateId?: number;
    };

    if (isNaN(mutationId)) { res.status(400).json({ error: "Invalid mutation ID" }); return; }

    const [mutation] = await db
      .select()
      .from(bankMutationsTable)
      .where(eq(bankMutationsTable.id, mutationId))
      .limit(1);

    if (!mutation) { res.status(404).json({ error: "Mutasi tidak ditemukan" }); return; }

    // Phase 2: Period Lock — blok approve jika periode sudah ditutup
    if (await isPeriodLocked(mutation.transactionDate, mutation.bankAccountId)) {
      res.status(423).json({ error: "Periode sudah ditutup. Hubungi Super Admin untuk membuka kembali sebelum melakukan perubahan." });
      return;
    }

    // Idempotency guard — jangan proses ulang yang sudah approved/rejected
    if (mutation.status === "approved") {
      res.json({ ok: true, skipped: true, reason: "already_approved" });
      return;
    }
    if (mutation.status === "rejected") {
      // Boleh approve mutasi yang sudah rejected (admin koreksi) — lanjutkan
    }

    const adminUser = (req as any).user;
    const auditCtx = { userId: adminUser?.userId, userRole: adminUser?.role, ipAddress: req.ip, userAgent: req.headers["user-agent"] as string };
    let approvedCandidateType: string | undefined;
    let approvedCandidateId: number | undefined;

    await db
      .update(bankReconciliationMatchesTable)
      .set({ status: "rejected" })
      .where(eq(bankReconciliationMatchesTable.mutationId, mutationId));

    if (matchId) {
      await db
        .update(bankReconciliationMatchesTable)
        .set({ status: "approved" })
        .where(
          and(
            eq(bankReconciliationMatchesTable.mutationId, mutationId),
            eq(bankReconciliationMatchesTable.id, matchId)
          )
        );

      const [match] = await db
        .select()
        .from(bankReconciliationMatchesTable)
        .where(eq(bankReconciliationMatchesTable.id, matchId))
        .limit(1);

      approvedCandidateType = match?.candidateType ?? undefined;
      approvedCandidateId = match?.candidateId ?? undefined;

      await db
        .update(bankMutationsTable)
        .set({
          status: "approved",
          matchedPaymentId: match?.candidateType === "payment" ? match.candidateId : null,
          matchedOrderId: match?.candidateType === "order" ? match.candidateId : null,
          updatedAt: new Date(),
        })
        .where(eq(bankMutationsTable.id, mutationId));

      if (match) await propagateApproval(match.candidateType ?? undefined, match.candidateId ?? undefined, auditCtx);
    } else if (candidateType && candidateId) {
      approvedCandidateType = candidateType;
      approvedCandidateId = candidateId;

      await db
        .insert(bankReconciliationMatchesTable)
        .values({
          mutationId,
          candidateType: candidateType as any,
          candidateId,
          matchScore: 100,
          matchReason: "Manual approval oleh admin +100",
          amountMatch: true,
          dateMatch: true,
          nameMatch: false,
          orderIdMatch: false,
          proofMatch: false,
          status: "approved",
        });

      await db
        .update(bankMutationsTable)
        .set({
          status: "approved",
          matchedPaymentId: candidateType === "payment" ? candidateId : null,
          matchedOrderId: candidateType === "order" ? candidateId : null,
          updatedAt: new Date(),
        })
        .where(eq(bankMutationsTable.id, mutationId));

      await propagateApproval(candidateType, candidateId, auditCtx);
    } else {
      await db
        .update(bankMutationsTable)
        .set({ status: "approved", updatedAt: new Date() })
        .where(eq(bankMutationsTable.id, mutationId));
    }

    // Set approved_by + approved_at
    const approvedByStr = adminUser?.email ?? (adminUser?.userId ? `user:${adminUser.userId}` : "admin");
    await db.update(bankMutationsTable).set({
      approvedBy: approvedByStr,
      approvedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(bankMutationsTable.id, mutationId));

    // Post jurnal akuntansi (fire-and-forget, idempotent)
    const [freshMutation] = await db.select().from(bankMutationsTable).where(eq(bankMutationsTable.id, mutationId)).limit(1);
    if (freshMutation) {
      postAccountingJournal(freshMutation, approvedCandidateType, approvedCandidateId, approvedByStr)
        .catch((err: any) => req.log.warn({ err }, "Journal posting gagal (non-fatal)"));
      // Phase 3: update bank balance ledger
      if (freshMutation.bankAccountId) {
        updateBankBalance(freshMutation.bankAccountId, freshMutation.companyId ?? null)
          .catch(() => {});
      }
    }

    // Audit log
    await db.insert(auditLogsTable).values({
      userId: adminUser?.userId,
      userRole: adminUser?.role,
      action: "approve_mutation",
      entity: "bank_mutation",
      entityId: mutationId,
      after: { matchId, candidateType: approvedCandidateType, candidateId: approvedCandidateId },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] as string,
    });

    // Auto-write ke Google Sheet kolom H
    if (isGoogleSheetsConfigured()) {
      const { sheetId, sheetName } = req.body as { sheetId?: string; sheetName?: string };
      if (sheetId) {
        const [updated] = await db
          .select()
          .from(bankMutationsTable)
          .where(eq(bankMutationsTable.id, mutationId))
          .limit(1);

        if (updated) {
          const extraNote = updated.providerOrderId
            ? `Order: ${updated.providerOrderId}`
            : updated.providerName ?? "";

          writeApprovalToSheetRow(
            sheetId,
            sheetName ?? undefined,
            updated.transactionDate,
            updated.description,
            "DISETUJUI",
            extraNote,
          ).catch((err) => req.log.warn({ err }, "Sheet write kolom H gagal (non-fatal)"));
        }
      }
    }

    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "Bank reconciliation approve error");
    res.status(500).json({ error: err?.message ?? "Gagal approve" });
  }
});

// POST /bank-reconciliation/:mutationId/reject
router.post("/bank-reconciliation/:mutationId/reject", adminMiddleware, async (req, res) => {
  try {
    const mutationId = Number(req.params["mutationId"]);
    if (isNaN(mutationId)) { res.status(400).json({ error: "Invalid mutation ID" }); return; }

    const [mutation] = await db
      .select({ status: bankMutationsTable.status, transactionDate: bankMutationsTable.transactionDate, bankAccountId: bankMutationsTable.bankAccountId })
      .from(bankMutationsTable)
      .where(eq(bankMutationsTable.id, mutationId))
      .limit(1);

    if (!mutation) { res.status(404).json({ error: "Mutasi tidak ditemukan" }); return; }

    // Phase 2: Period Lock — blok reject jika periode sudah ditutup
    if (await isPeriodLocked(mutation.transactionDate, mutation.bankAccountId)) {
      res.status(423).json({ error: "Periode sudah ditutup. Hubungi Super Admin untuk membuka kembali." });
      return;
    }

    // Idempotency guard
    if (mutation.status === "rejected") {
      res.json({ ok: true, skipped: true, reason: "already_rejected" });
      return;
    }

    const rejUser = (req as any).user;
    const rejectedByStr = rejUser?.email ?? (rejUser?.userId ? `user:${rejUser.userId}` : "admin");
    await db
      .update(bankMutationsTable)
      .set({ status: "rejected", rejectedBy: rejectedByStr, rejectedAt: new Date(), updatedAt: new Date() })
      .where(eq(bankMutationsTable.id, mutationId));

    await db
      .update(bankReconciliationMatchesTable)
      .set({ status: "rejected" })
      .where(eq(bankReconciliationMatchesTable.mutationId, mutationId));

    // Audit log
    const user = (req as any).user;
    await db.insert(auditLogsTable).values({
      userId: user?.userId,
      userRole: user?.role,
      action: "reject_mutation",
      entity: "bank_mutation",
      entityId: mutationId,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] as string,
    });

    if (isGoogleSheetsConfigured()) {
      const { sheetId, sheetName } = req.body as { sheetId?: string; sheetName?: string };
      if (sheetId) {
        const [updated] = await db
          .select()
          .from(bankMutationsTable)
          .where(eq(bankMutationsTable.id, mutationId))
          .limit(1);

        if (updated) {
          writeApprovalToSheetRow(
            sheetId,
            sheetName ?? undefined,
            updated.transactionDate,
            updated.description,
            "DITOLAK",
            "",
          ).catch((err) => req.log.warn({ err }, "Sheet write kolom H (reject) gagal (non-fatal)"));
        }
      }
    }

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Gagal reject" });
  }
});

// DELETE /bank-reconciliation/mutations
router.delete("/bank-reconciliation/mutations", adminMiddleware, async (req, res) => {
  try {
    const { statusFilter } = req.body as { statusFilter?: string[] };

    // Mutasi approved tidak boleh dihapus — sudah bagian dari rekonsiliasi final
    const safeFilter = (statusFilter ?? []).filter((s) => s !== "approved");
    if (statusFilter?.includes("approved")) {
      res.status(400).json({ error: "Mutasi dengan status 'approved' tidak dapat dihapus" });
      return;
    }

    let deletedCount = 0;
    let lockedSkipped = 0;

    // Ambil ID kandidat untuk dihapus (tanpa locked period)
    const getCandidateIds = async (extraCond?: any): Promise<number[]> => {
      let q = db.select({ id: bankMutationsTable.id, transactionDate: bankMutationsTable.transactionDate, bankAccountId: bankMutationsTable.bankAccountId })
        .from(bankMutationsTable).$dynamic();
      if (extraCond) q = q.where(extraCond) as any;
      const rows = await q;
      const unlocked: number[] = [];
      for (const r of rows) {
        if (await isPeriodLocked(r.transactionDate, r.bankAccountId)) { lockedSkipped++; }
        else { unlocked.push(r.id); }
      }
      return unlocked;
    };

    if (safeFilter.length > 0) {
      const ids = await getCandidateIds(inArray(bankMutationsTable.status, safeFilter as any));
      if (ids.length > 0) {
        await db.delete(bankReconciliationMatchesTable).where(inArray(bankReconciliationMatchesTable.mutationId, ids));
        await db.delete(bankMutationsTable).where(inArray(bankMutationsTable.id, ids));
        deletedCount = ids.length;
      }
    } else if (!statusFilter || statusFilter.length === 0) {
      const ids = await getCandidateIds(sql`${bankMutationsTable.status} != 'approved'`);
      if (ids.length > 0) {
        await db.delete(bankReconciliationMatchesTable).where(inArray(bankReconciliationMatchesTable.mutationId, ids));
        await db.delete(bankMutationsTable).where(inArray(bankMutationsTable.id, ids));
      }
      deletedCount = ids.length;
    }
    res.json({ ok: true, deletedCount, lockedSkipped });
  } catch (err: any) {
    req.log.error({ err }, "Bank reconciliation delete mutations error");
    res.status(500).json({ error: err?.message ?? "Gagal menghapus data mutasi" });
  }
});

// GET /bank-reconciliation/report — laporan bulanan rekonsiliasi
router.get("/bank-reconciliation/report", adminMiddleware, async (req, res) => {
  try {
    const { rows } = await db.execute(sql`
      SELECT
        TO_CHAR(TO_DATE(LEFT(mutation_key, 8), 'YYYYMMDD'), 'YYYY-MM') AS month,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE direction = 'IN')::int AS total_in,
        COUNT(*) FILTER (WHERE direction = 'OUT')::int AS total_out,
        COALESCE(SUM(amount) FILTER (WHERE direction = 'IN'), 0)::numeric AS amount_in,
        COALESCE(SUM(amount) FILTER (WHERE direction = 'OUT'), 0)::numeric AS amount_out,
        COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
        COUNT(*) FILTER (WHERE status = 'approved' AND direction = 'OUT')::int AS approved_out,
        COUNT(*) FILTER (WHERE status = 'unmatched')::int AS unmatched,
        COUNT(*) FILTER (WHERE status = 'auto_matched')::int AS auto_matched,
        COUNT(*) FILTER (WHERE status = 'need_review')::int AS need_review,
        COUNT(*) FILTER (WHERE status = 'duplicate_need_review')::int AS duplicate,
        COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
        COUNT(*) FILTER (WHERE accounting_posted = true)::int AS posted,
        COUNT(*) FILTER (WHERE status = 'approved' AND accounting_posted = false)::int AS unposted,
        COALESCE(SUM(amount) FILTER (WHERE direction = 'IN' AND status = 'approved'), 0)::numeric AS approved_amount_in,
        COALESCE(SUM(amount) FILTER (WHERE direction = 'OUT' AND status = 'approved'), 0)::numeric AS approved_amount_out,
        COALESCE(SUM(amount) FILTER (WHERE direction = 'IN' AND status NOT IN ('approved','rejected')), 0)::numeric AS pending_amount_in
      FROM sport_center.bank_mutations
      WHERE mutation_key ~ '^20[0-9]{6}_'
      GROUP BY TO_CHAR(TO_DATE(LEFT(mutation_key, 8), 'YYYYMMDD'), 'YYYY-MM')
      ORDER BY TO_CHAR(TO_DATE(LEFT(mutation_key, 8), 'YYYYMMDD'), 'YYYY-MM') DESC
      LIMIT 36
    `);

    const totals = rows.reduce(
      (acc: any, r: any) => ({
        total: acc.total + Number(r.total),
        total_in: acc.total_in + Number(r.total_in ?? 0),
        total_out: acc.total_out + Number(r.total_out ?? 0),
        amount_in: acc.amount_in + Number(r.amount_in),
        amount_out: acc.amount_out + Number(r.amount_out),
        approved: acc.approved + Number(r.approved),
        approved_out: acc.approved_out + Number(r.approved_out ?? 0),
        unmatched: acc.unmatched + Number(r.unmatched),
        auto_matched: acc.auto_matched + Number(r.auto_matched ?? 0),
        need_review: acc.need_review + Number(r.need_review ?? 0),
        duplicate: acc.duplicate + Number(r.duplicate),
        rejected: acc.rejected + Number(r.rejected),
        posted: acc.posted + Number(r.posted ?? 0),
        unposted: acc.unposted + Number(r.unposted ?? 0),
        approved_amount_in: acc.approved_amount_in + Number(r.approved_amount_in),
        approved_amount_out: acc.approved_amount_out + Number(r.approved_amount_out ?? 0),
        pending_amount_in: acc.pending_amount_in + Number(r.pending_amount_in),
      }),
      {
        total: 0, total_in: 0, total_out: 0,
        amount_in: 0, amount_out: 0,
        approved: 0, approved_out: 0, unmatched: 0, auto_matched: 0, need_review: 0,
        duplicate: 0, rejected: 0,
        posted: 0, unposted: 0,
        approved_amount_in: 0, approved_amount_out: 0, pending_amount_in: 0,
      }
    );

    res.json({ rows, totals });
  } catch (err: any) {
    req.log.error({ err }, "Bank reconciliation report error");
    res.status(500).json({ error: err?.message ?? "Gagal memuat laporan" });
  }
});

// POST /bank-reconciliation/run-matching
router.post("/bank-reconciliation/run-matching", adminMiddleware, async (req, res) => {
  try {
    const { mutationIds } = req.body as { mutationIds?: number[] };
    const result = await runMatching(mutationIds);
    res.json({ ok: true, ...result });
  } catch (err: any) {
    req.log.error({ err }, "Bank reconciliation run-matching error");
    res.status(500).json({ error: err?.message ?? "Gagal jalankan matching" });
  }
});

// POST /bank-reconciliation/scan-ocr
router.post("/bank-reconciliation/scan-ocr", adminMiddleware, async (req, res) => {
  try {
    const { paymentId, proofUrl } = req.body as { paymentId: number; proofUrl: string };
    if (!proofUrl) {
      res.status(400).json({ error: "proofUrl wajib diisi" });
      return;
    }

    const imgRes = await fetch(proofUrl);
    if (!imgRes.ok) {
      res.status(400).json({ error: `Gagal mengunduh gambar: ${imgRes.statusText}` });
      return;
    }
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("ind+eng", 1, {
      cachePath: "/tmp/tesseract-cache",
      logger: () => {},
    });
    const { data } = await worker.recognize(imgBuffer);
    await worker.terminate();

    const rawText = data.text || "";
    const lines = rawText.split("\n").map((l: string) => l.trim()).filter(Boolean);
    let ocrName: string | null = null;
    let ocrAmount: number | null = null;
    let ocrDate: string | null = null;

    const amountMatch = rawText.match(/(?:Rp\.?\s*|IDR\s*)?([\d]{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?)/i);
    if (amountMatch) {
      const cleaned = amountMatch[1]!.replace(/\./g, "").replace(",", ".");
      ocrAmount = parseFloat(cleaned) || null;
    }

    const dateMatch = rawText.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})|(\d{4})[\/\-](\d{2})[\/\-](\d{2})/);
    if (dateMatch) {
      if (dateMatch[4]) {
        ocrDate = `${dateMatch[4]}-${dateMatch[5]}-${dateMatch[6]}`;
      } else {
        const d = dateMatch[1]!.padStart(2, "0");
        const m = dateMatch[2]!.padStart(2, "0");
        const y = dateMatch[3]!.length === 2 ? `20${dateMatch[3]}` : dateMatch[3]!;
        ocrDate = `${y}-${m}-${d}`;
      }
    }

    const skipWords = /^(transfer|bank|rekening|tanggal|nominal|total|biaya|fee|dari|ke|kode|ref|no|rp|idr|berhasil|sukses|debet|kredit|saldo|date|amount|beneficiary|sender)/i;
    for (const line of lines) {
      if (line.length > 3 && /[a-zA-Z]{3,}/.test(line) && !skipWords.test(line) && !/^\d+$/.test(line)) {
        ocrName = line.slice(0, 100);
        break;
      }
    }

    if (paymentId) {
      await db.execute(sql`
        UPDATE sport_center.payments
        SET ocr_name = ${ocrName}, ocr_amount = ${ocrAmount}, ocr_date = ${ocrDate}, ocr_raw = ${rawText.slice(0, 2000)}
        WHERE id = ${paymentId}
      `);
    }

    res.json({
      ok: true,
      ocrName,
      ocrAmount,
      ocrDate,
      ocrRaw: rawText.slice(0, 500),
    });
  } catch (err: any) {
    req.log.error({ err }, "OCR scan error");
    res.status(500).json({ error: err?.message ?? "Gagal scan OCR" });
  }
});

// GET /bank-reconciliation/mutations/:id/journal — detail baris jurnal (COA debit & kredit)
router.get("/bank-reconciliation/mutations/:id/journal", financeMiddleware, async (req, res) => {
  try {
    const mutationId = parseInt(req.params.id as string);
    if (isNaN(mutationId)) { res.status(400).json({ error: "ID tidak valid" }); return; }
    const entries = await db.select().from(bankJournalEntriesTable)
      .where(eq(bankJournalEntriesTable.mutationId, mutationId))
      .orderBy(bankJournalEntriesTable.id);
    res.json({ entries });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Gagal ambil jurnal" });
  }
});

// PATCH /bank-reconciliation/mutations/:id/journal — koreksi COA tanpa void & repost
router.patch("/bank-reconciliation/mutations/:id/journal", superAdminMiddleware, async (req, res) => {
  try {
    const mutationId = parseInt(req.params.id as string);
    if (isNaN(mutationId)) { res.status(400).json({ error: "ID tidak valid" }); return; }

    const { debitAccountCode, debitAccountName, creditAccountCode, creditAccountName, correctionNote } = req.body as {
      debitAccountCode: string; debitAccountName: string;
      creditAccountCode: string; creditAccountName: string;
      correctionNote?: string;
    };
    if (!debitAccountCode || !debitAccountName || !creditAccountCode || !creditAccountName) {
      res.status(400).json({ error: "Kode dan nama akun debit & kredit wajib diisi" }); return;
    }

    const [mut] = await db.select({ transactionDate: bankMutationsTable.transactionDate, bankAccountId: bankMutationsTable.bankAccountId, status: bankMutationsTable.status })
      .from(bankMutationsTable).where(eq(bankMutationsTable.id, mutationId)).limit(1);
    if (!mut) { res.status(404).json({ error: "Mutasi tidak ditemukan" }); return; }
    if (mut.status !== "approved") { res.status(400).json({ error: "Hanya jurnal dari mutasi approved yang bisa dikoreksi" }); return; }
    if (await isPeriodLocked(mut.transactionDate, mut.bankAccountId)) {
      res.status(423).json({ error: "Periode sudah ditutup. Koreksi COA tidak dapat dilakukan." }); return;
    }

    const [entry] = await db.select({ id: bankJournalEntriesTable.id }).from(bankJournalEntriesTable)
      .where(eq(bankJournalEntriesTable.mutationId, mutationId)).limit(1);
    if (!entry) { res.status(404).json({ error: "Jurnal belum diposting untuk mutasi ini" }); return; }

    const adminUser = (req as any).user;
    await db.update(bankJournalEntriesTable)
      .set({ debitAccountCode, debitAccountName, creditAccountCode, creditAccountName })
      .where(eq(bankJournalEntriesTable.mutationId, mutationId));

    await db.insert(auditLogsTable).values({
      userId: adminUser?.userId, userRole: adminUser?.role,
      action: "edit_journal_coa", entity: "bank_mutation", entityId: mutationId,
      after: { debitAccountCode, debitAccountName, creditAccountCode, creditAccountName, correctionNote: correctionNote ?? null },
      ipAddress: req.ip, userAgent: req.headers["user-agent"] as string,
    });

    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "Bank reconciliation journal COA patch error");
    res.status(500).json({ error: err?.message ?? "Gagal koreksi COA jurnal" });
  }
});

// GET /bank-reconciliation/mutations/:id/candidates
router.get("/bank-reconciliation/mutations/:id/candidates", adminMiddleware, async (req, res) => {
  try {
    const mutationId = parseInt(req.params.id as string);
    if (isNaN(mutationId)) { res.status(400).json({ error: "ID tidak valid" }); return; }

    const [mutation] = await db.select().from(bankMutationsTable).where(eq(bankMutationsTable.id, mutationId)).limit(1);
    if (!mutation) { res.status(404).json({ error: "Mutasi tidak ditemukan" }); return; }

    const candidates = await db
      .select()
      .from(bankReconciliationMatchesTable)
      .where(eq(bankReconciliationMatchesTable.mutationId, mutationId))
      .orderBy(desc(bankReconciliationMatchesTable.matchScore));

    const paymentIds = candidates.filter((c) => c.candidateType === "payment").map((c) => c.candidateId);
    const orderIds = candidates.filter((c) => c.candidateType === "order").map((c) => c.candidateId);

    const payments = paymentIds.length
      ? await db.select({
          id: paymentsTable.id,
          bookingId: paymentsTable.bookingId,
          amount: paymentsTable.amount,
          proofUrl: paymentsTable.proofUrl,
          status: paymentsTable.status,
          createdAt: paymentsTable.createdAt,
        }).from(paymentsTable).where(inArray(paymentsTable.id, paymentIds))
      : [];
    const paymentMap = new Map(payments.map((p) => [p.id, p]));

    const allBookingIds = [
      ...new Set([
        ...payments.map((p) => p.bookingId).filter((x): x is number => x != null),
        ...orderIds,
      ]),
    ];
    const bookings = allBookingIds.length
      ? await db.select({
          id: bookingsTable.id,
          orderNumber: bookingsTable.orderNumber,
          customerName: bookingsTable.customerName,
          customerPhone: bookingsTable.customerPhone,
          customerEmail: bookingsTable.customerEmail,
          bookingDate: bookingsTable.bookingDate,
          totalPrice: bookingsTable.totalPrice,
          grandTotal: bookingsTable.grandTotal,
          status: bookingsTable.status,
          facilityId: bookingsTable.facilityId,
        }).from(bookingsTable).where(inArray(bookingsTable.id, allBookingIds))
      : [];
    const bookingMap = new Map(bookings.map((b) => [b.id, b]));

    const facilityIds = [...new Set(bookings.map((b) => b.facilityId).filter((x): x is number => x != null))];
    const facilities = facilityIds.length
      ? await db.select({ id: facilitiesTable.id, name: facilitiesTable.name })
          .from(facilitiesTable).where(inArray(facilitiesTable.id, facilityIds))
      : [];
    const facilityMap = new Map(facilities.map((f) => [f.id, f]));

    const enriched = candidates.map((c) => {
      const payment = c.candidateType === "payment" ? paymentMap.get(c.candidateId) ?? null : null;
      const bookingId = payment ? payment.bookingId : (c.candidateType === "order" ? c.candidateId : null);
      const booking = bookingId ? bookingMap.get(bookingId) ?? null : null;
      const facility = booking?.facilityId ? facilityMap.get(booking.facilityId) ?? null : null;
      const paymentDate = payment?.createdAt ? String(payment.createdAt).slice(0, 10) : null;

      return {
        ...c,
        customerName: booking?.customerName ?? null,
        customerPhone: booking?.customerPhone ?? null,
        customerEmail: booking?.customerEmail ?? null,
        bookingOrderNumber: booking?.orderNumber ?? null,
        bookingDate: booking?.bookingDate ?? null,
        bookingStatus: booking?.status ?? null,
        bookingAmount: String(booking?.grandTotal ?? booking?.totalPrice ?? 0),
        paymentProofUrl: payment?.proofUrl ?? null,
        paymentStatus: payment?.status ?? null,
        paymentDate,
        facilityName: facility?.name ?? null,
      };
    });

    const user = (req as any).user;
    await db.insert(auditLogsTable).values({
      userId: user?.userId,
      userRole: user?.role,
      action: "view_candidates",
      entity: "bank_mutation",
      entityId: mutationId,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] as string,
    });

    res.json({ mutation, candidates: enriched });
  } catch (err: any) {
    req.log.error({ err }, "Bank reconciliation get-candidates error");
    res.status(500).json({ error: err?.message ?? "Gagal memuat kandidat" });
  }
});

// POST /bank-reconciliation/mutations/:id/approve-candidate
router.post("/bank-reconciliation/mutations/:id/approve-candidate", adminMiddleware, async (req, res) => {
  try {
    const mutationId = parseInt(req.params.id as string);
    if (isNaN(mutationId)) { res.status(400).json({ error: "ID tidak valid" }); return; }
    const { candidateType, candidateId, note } = req.body as { candidateType: "payment" | "order" | "expense"; candidateId: number; note?: string };
    if (!candidateType || !candidateId) { res.status(400).json({ error: "candidateType dan candidateId diperlukan" }); return; }

    const [mutation] = await db.select().from(bankMutationsTable).where(eq(bankMutationsTable.id, mutationId)).limit(1);
    if (!mutation) { res.status(404).json({ error: "Mutasi tidak ditemukan" }); return; }

    await db.update(bankReconciliationMatchesTable).set({ status: "rejected" }).where(eq(bankReconciliationMatchesTable.mutationId, mutationId));

    const [existing] = await db.select().from(bankReconciliationMatchesTable).where(and(
      eq(bankReconciliationMatchesTable.mutationId, mutationId),
      eq(bankReconciliationMatchesTable.candidateId, candidateId),
    )).limit(1);

    if (existing) {
      await db.update(bankReconciliationMatchesTable)
        .set({ status: "approved", note: note ?? null })
        .where(eq(bankReconciliationMatchesTable.id, existing.id));
    } else {
      await db.insert(bankReconciliationMatchesTable).values({
        mutationId,
        candidateType: candidateType as any,
        candidateId,
        matchScore: 100,
        matchReason: note ?? "Disetujui manual oleh admin +100",
        amountMatch: true,
        dateMatch: false,
        nameMatch: false,
        orderIdMatch: false,
        proofMatch: false,
        statusValidMatch: false,
        toleranceUsed: false,
        note: note ?? null,
        status: "approved",
      });
    }

    const adminUser2 = (req as any).user;
    const auditCtx2 = { userId: adminUser2?.userId, userRole: adminUser2?.role, ipAddress: req.ip, userAgent: req.headers["user-agent"] as string };

    await db.update(bankMutationsTable).set({
      status: "approved",
      matchedPaymentId: candidateType === "payment" ? candidateId : null,
      matchedOrderId: candidateType === "order" ? candidateId : null,
      updatedAt: new Date(),
    }).where(eq(bankMutationsTable.id, mutationId));

    // Propagate ke booking/payment + audit log
    await propagateApproval(candidateType, candidateId, auditCtx2);

    // Set approved_by + approved_at
    const approvedByStr2 = adminUser2?.email ?? (adminUser2?.userId ? `user:${adminUser2.userId}` : "admin");
    await db.update(bankMutationsTable).set({
      approvedBy: approvedByStr2,
      approvedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(bankMutationsTable.id, mutationId));

    // Post jurnal akuntansi (fire-and-forget, idempotent)
    const [freshMutation2] = await db.select().from(bankMutationsTable).where(eq(bankMutationsTable.id, mutationId)).limit(1);
    if (freshMutation2) {
      postAccountingJournal(freshMutation2, candidateType, candidateId, approvedByStr2)
        .catch((err: any) => req.log.warn({ err }, "Journal posting gagal (non-fatal)"));
      // Phase 3: update bank balance ledger
      if (freshMutation2.bankAccountId) {
        updateBankBalance(freshMutation2.bankAccountId, freshMutation2.companyId ?? null)
          .catch(() => {});
      }
    }

    await db.insert(auditLogsTable).values({
      userId: adminUser2?.userId,
      userRole: adminUser2?.role,
      action: "approve_candidate",
      entity: "bank_mutation",
      entityId: mutationId,
      after: { candidateType, candidateId, note },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] as string,
    });

    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "Bank reconciliation approve-candidate error");
    res.status(500).json({ error: err?.message ?? "Gagal approve kandidat" });
  }
});

// POST /bank-reconciliation/mutations/:id/mark-unmatched
router.post("/bank-reconciliation/mutations/:id/mark-unmatched", adminMiddleware, async (req, res) => {
  try {
    const mutationId = parseInt(req.params.id as string);
    if (isNaN(mutationId)) { res.status(400).json({ error: "ID tidak valid" }); return; }

    const [mutation] = await db.select().from(bankMutationsTable).where(eq(bankMutationsTable.id, mutationId)).limit(1);
    if (!mutation) { res.status(404).json({ error: "Mutasi tidak ditemukan" }); return; }

    // Phase 2: Period Lock
    if (await isPeriodLocked(mutation.transactionDate, mutation.bankAccountId)) {
      res.status(423).json({ error: "Periode sudah ditutup. Tidak dapat mengubah status mutasi." });
      return;
    }

    await db.update(bankMutationsTable).set({
      status: "unmatched",
      matchedPaymentId: null,
      matchedOrderId: null,
      updatedAt: new Date(),
    }).where(eq(bankMutationsTable.id, mutationId));
    await db.update(bankReconciliationMatchesTable).set({ status: "rejected" }).where(eq(bankReconciliationMatchesTable.mutationId, mutationId));

    const user = (req as any).user;
    await db.insert(auditLogsTable).values({
      userId: user?.userId,
      userRole: user?.role,
      action: "mark_unmatched",
      entity: "bank_mutation",
      entityId: mutationId,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] as string,
    });

    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "Bank reconciliation mark-unmatched error");
    res.status(500).json({ error: err?.message ?? "Gagal tandai unmatched" });
  }
});

// POST /bank-reconciliation/mutations/:id/mark-duplicate
router.post("/bank-reconciliation/mutations/:id/mark-duplicate", adminMiddleware, async (req, res) => {
  try {
    const mutationId = parseInt(req.params.id as string);
    if (isNaN(mutationId)) { res.status(400).json({ error: "ID tidak valid" }); return; }

    const [mutation] = await db.select().from(bankMutationsTable).where(eq(bankMutationsTable.id, mutationId)).limit(1);
    if (!mutation) { res.status(404).json({ error: "Mutasi tidak ditemukan" }); return; }

    // Phase 2: Period Lock
    if (await isPeriodLocked(mutation.transactionDate, mutation.bankAccountId)) {
      res.status(423).json({ error: "Periode sudah ditutup. Tidak dapat mengubah status mutasi." });
      return;
    }

    await db.update(bankMutationsTable).set({ status: "duplicate_need_review", updatedAt: new Date() }).where(eq(bankMutationsTable.id, mutationId));

    const user = (req as any).user;
    await db.insert(auditLogsTable).values({
      userId: user?.userId,
      userRole: user?.role,
      action: "mark_duplicate",
      entity: "bank_mutation",
      entityId: mutationId,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] as string,
    });

    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "Bank reconciliation mark-duplicate error");
    res.status(500).json({ error: err?.message ?? "Gagal tandai duplikat" });
  }
});

// POST /bank-reconciliation/mutations/:id/post-journal — buat jurnal untuk mutasi approved yang belum diposting
// POST /bank-reconciliation/mutations/post-journal-bulk — posting semua jurnal yang belum diposting
router.post("/bank-reconciliation/mutations/post-journal-bulk", financeMiddleware, async (req, res) => {
  try {
    const adminUser = (req as any).user;
    const postedBy = adminUser?.email ?? (adminUser?.userId ? `user:${adminUser.userId}` : "admin");

    const unposted = await db.select().from(bankMutationsTable).where(
      and(eq(bankMutationsTable.status, "approved"), eq(bankMutationsTable.accountingPosted, false))
    );

    const results: { id: number; journalId: string | null; skipped?: boolean; error?: string }[] = [];

    for (const mut of unposted) {
      try {
        // Skip jika periode locked
        if (await isPeriodLocked(mut.transactionDate, mut.bankAccountId)) {
          results.push({ id: mut.id, journalId: null, skipped: true });
          continue;
        }

        const [approvedMatch] = await db.select().from(bankReconciliationMatchesTable).where(
          and(eq(bankReconciliationMatchesTable.mutationId, mut.id), eq(bankReconciliationMatchesTable.status, "approved"))
        ).limit(1);

        const journalId = await postAccountingJournal(
          mut,
          approvedMatch?.candidateType ?? undefined,
          approvedMatch?.candidateId ?? undefined,
          postedBy,
        );

        await db.insert(auditLogsTable).values({
          userId: adminUser?.userId, userRole: adminUser?.role,
          action: "post_journal_bulk", entity: "bank_mutation", entityId: mut.id,
          after: { journalId }, ipAddress: req.ip, userAgent: req.headers["user-agent"] as string,
        });

        results.push({ id: mut.id, journalId });
      } catch (e: any) {
        results.push({ id: mut.id, journalId: null, error: e?.message ?? "error" });
      }
    }

    const posted = results.filter((r) => r.journalId && !r.skipped).length;
    const skipped = results.filter((r) => r.skipped).length;
    const errors = results.filter((r) => r.error).length;

    res.json({ ok: true, total: unposted.length, posted, skipped, errors, results });
  } catch (err: any) {
    req.log.error({ err }, "Bank reconciliation post-journal-bulk error");
    res.status(500).json({ error: err?.message ?? "Gagal bulk posting jurnal" });
  }
});

router.post("/bank-reconciliation/mutations/:id/post-journal", financeMiddleware, async (req, res) => {
  try {
    const mutationId = parseInt(req.params.id as string);
    if (isNaN(mutationId)) { res.status(400).json({ error: "ID tidak valid" }); return; }

    const [mutation] = await db.select().from(bankMutationsTable).where(eq(bankMutationsTable.id, mutationId)).limit(1);
    if (!mutation) { res.status(404).json({ error: "Mutasi tidak ditemukan" }); return; }

    // Phase 2: Period Lock
    if (await isPeriodLocked(mutation.transactionDate, mutation.bankAccountId)) {
      res.status(423).json({ error: "Periode sudah ditutup. Posting jurnal tidak dapat dilakukan." });
      return;
    }

    if (mutation.status !== "approved") {
      res.status(400).json({ error: "Jurnal hanya bisa dibuat untuk mutasi yang sudah disetujui" }); return;
    }

    // Idempotency — sudah diposting
    if (mutation.accountingPosted) {
      res.json({ ok: true, skipped: true, journalId: mutation.journalId }); return;
    }

    // Ambil kandidat yang disetujui untuk menentukan akun jurnal yang tepat
    const [approvedMatch] = await db.select().from(bankReconciliationMatchesTable).where(
      and(eq(bankReconciliationMatchesTable.mutationId, mutationId), eq(bankReconciliationMatchesTable.status, "approved"))
    ).limit(1);

    const adminUser = (req as any).user;
    const postedBy = adminUser?.email ?? (adminUser?.userId ? `user:${adminUser.userId}` : "admin");

    const journalId = await postAccountingJournal(
      mutation,
      approvedMatch?.candidateType ?? undefined,
      approvedMatch?.candidateId ?? undefined,
      postedBy,
    );

    await db.insert(auditLogsTable).values({
      userId: adminUser?.userId, userRole: adminUser?.role,
      action: "post_journal", entity: "bank_mutation", entityId: mutationId,
      after: { journalId }, ipAddress: req.ip, userAgent: req.headers["user-agent"] as string,
    });

    res.json({ ok: true, journalId });
  } catch (err: any) {
    req.log.error({ err }, "Bank reconciliation post-journal error");
    res.status(500).json({ error: err?.message ?? "Gagal posting jurnal" });
  }
});

// PATCH /bank-reconciliation/mutations/:id/tax-fields — set transaction_type, tax_type, tax_period, tax_payment_reference
router.patch("/bank-reconciliation/mutations/:id/tax-fields", financeMiddleware, async (req, res) => {
  try {
    const mutationId = parseInt(req.params.id as string);
    if (isNaN(mutationId)) { res.status(400).json({ error: "ID tidak valid" }); return; }
    const [mutTax] = await db.select({ transactionDate: bankMutationsTable.transactionDate, bankAccountId: bankMutationsTable.bankAccountId })
      .from(bankMutationsTable).where(eq(bankMutationsTable.id, mutationId)).limit(1);
    // Phase 2: Period Lock
    if (mutTax && await isPeriodLocked(mutTax.transactionDate, mutTax.bankAccountId)) {
      res.status(423).json({ error: "Periode sudah ditutup. Tidak dapat mengubah klasifikasi." });
      return;
    }

    const { transactionType, taxType, taxPeriod, taxPaymentReference } = req.body as {
      transactionType?: string; taxType?: string; taxPeriod?: string; taxPaymentReference?: string;
    };
    await db.update(bankMutationsTable).set({
      transactionType: transactionType ?? null,
      taxType: taxType ?? null,
      taxPeriod: taxPeriod ?? null,
      taxPaymentReference: taxPaymentReference ?? null,
      updatedAt: new Date(),
    }).where(eq(bankMutationsTable.id, mutationId));
    const user = (req as any).user;
    await db.insert(auditLogsTable).values({
      userId: user?.userId, userRole: user?.role,
      action: "update_tax_fields", entity: "bank_mutation", entityId: mutationId,
      after: { transactionType, taxType, taxPeriod, taxPaymentReference },
      ipAddress: req.ip, userAgent: req.headers["user-agent"] as string,
    });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Gagal update tax fields" });
  }
});

// ================================================================
// FASE 2: Aturan COA (Account Rules) CRUD
// ================================================================

// GET /bank-reconciliation/account-rules
router.get("/bank-reconciliation/account-rules", adminMiddleware, async (req, res) => {
  try {
    const rules = await db.select().from(bankReconciliationAccountRulesTable)
      .orderBy(bankReconciliationAccountRulesTable.direction, bankReconciliationAccountRulesTable.transactionType);
    res.json({ rules });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Gagal memuat aturan COA" });
  }
});

// POST /bank-reconciliation/account-rules
router.post("/bank-reconciliation/account-rules", financeMiddleware, async (req, res) => {
  try {
    const user = (req as any).user;
    const { transactionType, direction, debitCoaId, debitCoaName, creditCoaId, creditCoaName, bankAccountId, companyId } =
      req.body as {
        transactionType: string; direction: string;
        debitCoaId: string; debitCoaName: string; creditCoaId: string; creditCoaName: string;
        bankAccountId?: string; companyId?: number;
      };
    if (!transactionType || !direction || !debitCoaId || !creditCoaId) {
      res.status(400).json({ error: "transactionType, direction, debitCoaId, creditCoaId wajib diisi" }); return;
    }
    const [rule] = await db.insert(bankReconciliationAccountRulesTable).values({
      transactionType, direction, debitCoaId, debitCoaName, creditCoaId, creditCoaName,
      bankAccountId: bankAccountId ?? null, companyId: companyId ?? null,
      createdBy: user?.email ?? `user:${user?.userId}`,
      updatedBy: user?.email ?? `user:${user?.userId}`,
    }).returning();
    await db.insert(auditLogsTable).values({
      userId: user?.userId, userRole: user?.role,
      action: "create_account_rule", entity: "bank_reconciliation_account_rule", entityId: rule!.id,
      after: rule, ipAddress: req.ip, userAgent: req.headers["user-agent"] as string,
    });
    res.json({ ok: true, rule });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Gagal buat aturan COA" });
  }
});

// PUT /bank-reconciliation/account-rules/:id
router.put("/bank-reconciliation/account-rules/:id", financeMiddleware, async (req, res) => {
  try {
    const ruleId = parseInt(req.params.id as string);
    if (isNaN(ruleId)) { res.status(400).json({ error: "ID tidak valid" }); return; }
    const user = (req as any).user;
    const { transactionType, direction, debitCoaId, debitCoaName, creditCoaId, creditCoaName, bankAccountId, isActive } = req.body as any;
    const [updated] = await db.update(bankReconciliationAccountRulesTable).set({
      transactionType, direction, debitCoaId, debitCoaName, creditCoaId, creditCoaName,
      bankAccountId: bankAccountId ?? null, isActive: isActive ?? true,
      updatedBy: user?.email ?? `user:${user?.userId}`,
      updatedAt: new Date(),
    }).where(eq(bankReconciliationAccountRulesTable.id, ruleId)).returning();
    if (!updated) { res.status(404).json({ error: "Aturan tidak ditemukan" }); return; }
    res.json({ ok: true, rule: updated });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Gagal update aturan COA" });
  }
});

// DELETE /bank-reconciliation/account-rules/:id
router.delete("/bank-reconciliation/account-rules/:id", superAdminMiddleware, async (req, res) => {
  try {
    const ruleId = parseInt(req.params.id as string);
    if (isNaN(ruleId)) { res.status(400).json({ error: "ID tidak valid" }); return; }
    await db.delete(bankReconciliationAccountRulesTable).where(eq(bankReconciliationAccountRulesTable.id, ruleId));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Gagal hapus aturan COA" });
  }
});

// ================================================================
// FASE 4: Monthly Bank Closing
// ================================================================

// GET /bank-reconciliation/closing
router.get("/bank-reconciliation/closing", financeMiddleware, async (req, res) => {
  try {
    const { bankAccountId } = req.query as { bankAccountId?: string };
    const conditions: any[] = [];
    if (bankAccountId) conditions.push(eq(bankReconciliationClosingTable.bankAccountId, bankAccountId));
    const closings = await db.select().from(bankReconciliationClosingTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(bankReconciliationClosingTable.periodYear), desc(bankReconciliationClosingTable.periodMonth));
    res.json({ closings });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Gagal memuat closing" });
  }
});

// POST /bank-reconciliation/closing/compute — hitung & buat closing baru
router.post("/bank-reconciliation/closing/compute", financeMiddleware, async (req, res) => {
  try {
    const { periodYear, periodMonth, bankAccountId, openingBalance, statementEndingBalance, notes } = req.body as {
      periodYear: number; periodMonth: number;
      bankAccountId?: string; openingBalance?: number; statementEndingBalance?: number; notes?: string;
    };
    if (!periodYear || !periodMonth) { res.status(400).json({ error: "periodYear dan periodMonth wajib" }); return; }

    // Hitung total IN/OUT approved untuk periode ini
    const monthStr = `${periodYear}-${String(periodMonth).padStart(2, "0")}`;
    const { rows: statsRows } = await db.execute(sql`
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE direction = 'IN' AND status = 'approved'), 0) AS total_in,
        COALESCE(SUM(amount) FILTER (WHERE direction = 'OUT' AND status = 'approved'), 0) AS total_out
      FROM sport_center.bank_mutations
      WHERE TO_CHAR(TO_DATE(transaction_date, 'YYYY-MM-DD'), 'YYYY-MM') = ${monthStr}
        ${bankAccountId ? sql`AND bank_account_id = ${bankAccountId}` : sql``}
    `);
    const stats = (statsRows as any[])[0] ?? {};
    const totalIn = parseFloat(stats.total_in ?? "0");
    const totalOut = parseFloat(stats.total_out ?? "0");
    const opening = openingBalance ?? 0;
    const systemEnding = opening + totalIn - totalOut;
    const stmtEnding = statementEndingBalance ?? systemEnding;
    const difference = systemEnding - stmtEnding;

    // Upsert closing
    const existingConditions: any[] = [
      eq(bankReconciliationClosingTable.periodYear, periodYear),
      eq(bankReconciliationClosingTable.periodMonth, periodMonth),
    ];
    if (bankAccountId) existingConditions.push(eq(bankReconciliationClosingTable.bankAccountId, bankAccountId));

    const [existing] = await db.select().from(bankReconciliationClosingTable)
      .where(and(...existingConditions)).limit(1);

    const user = (req as any).user;
    let closing;
    if (existing) {
      if (existing.status === "closed") { res.status(400).json({ error: "Periode sudah ditutup. Hubungi Super Admin untuk membuka kembali." }); return; }
      [closing] = await db.update(bankReconciliationClosingTable).set({
        openingBalance: String(opening), totalIn: String(totalIn), totalOut: String(totalOut),
        systemEndingBalance: String(systemEnding), statementEndingBalance: String(stmtEnding),
        difference: String(difference), notes: notes ?? existing.notes, updatedAt: new Date(),
      }).where(eq(bankReconciliationClosingTable.id, existing.id)).returning();
    } else {
      [closing] = await db.insert(bankReconciliationClosingTable).values({
        periodYear, periodMonth, bankAccountId: bankAccountId ?? null, companyId: null,
        openingBalance: String(opening), totalIn: String(totalIn), totalOut: String(totalOut),
        systemEndingBalance: String(systemEnding), statementEndingBalance: String(stmtEnding),
        difference: String(difference), status: "unreconciled", notes: notes ?? null,
      }).returning();
    }
    res.json({ ok: true, closing });
  } catch (err: any) {
    req.log.error({ err }, "Bank reconciliation closing compute error");
    res.status(500).json({ error: err?.message ?? "Gagal compute closing" });
  }
});

// POST /bank-reconciliation/closing/:id/close — finalize
router.post("/bank-reconciliation/closing/:id/close", financeMiddleware, async (req, res) => {
  try {
    const closingId = parseInt(req.params.id as string);
    if (isNaN(closingId)) { res.status(400).json({ error: "ID tidak valid" }); return; }
    const [closing] = await db.select().from(bankReconciliationClosingTable).where(eq(bankReconciliationClosingTable.id, closingId)).limit(1);
    if (!closing) { res.status(404).json({ error: "Closing tidak ditemukan" }); return; }
    if (closing.status === "closed") { res.json({ ok: true, skipped: true, reason: "already_closed" }); return; }
    if (Math.abs(parseFloat(closing.difference ?? "0")) > 0.01) {
      res.status(400).json({ error: `Selisih (${closing.difference}) harus 0 sebelum menutup periode.` }); return;
    }
    const user = (req as any).user;
    const closedBy = user?.email ?? `user:${user?.userId}`;
    const [updated] = await db.update(bankReconciliationClosingTable).set({
      status: "closed", closedBy, closedAt: new Date(), updatedAt: new Date(),
    }).where(eq(bankReconciliationClosingTable.id, closingId)).returning();
    await db.insert(auditLogsTable).values({
      userId: user?.userId, userRole: user?.role,
      action: "close_bank_period", entity: "bank_reconciliation_closing", entityId: closingId,
      after: { status: "closed", closedBy }, ipAddress: req.ip, userAgent: req.headers["user-agent"] as string,
    });
    res.json({ ok: true, closing: updated });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Gagal tutup periode" });
  }
});

// POST /bank-reconciliation/closing/:id/reopen — reopen (superAdmin only)
router.post("/bank-reconciliation/closing/:id/reopen", superAdminMiddleware, async (req, res) => {
  try {
    const closingId = parseInt(req.params.id as string);
    if (isNaN(closingId)) { res.status(400).json({ error: "ID tidak valid" }); return; }
    const user = (req as any).user;
    const reopenedBy = user?.email ?? `user:${user?.userId}`;
    const [updated] = await db.update(bankReconciliationClosingTable).set({
      status: "unreconciled", reopenedBy, reopenedAt: new Date(), updatedAt: new Date(),
    }).where(eq(bankReconciliationClosingTable.id, closingId)).returning();
    if (!updated) { res.status(404).json({ error: "Closing tidak ditemukan" }); return; }
    await db.insert(auditLogsTable).values({
      userId: user?.userId, userRole: user?.role,
      action: "reopen_bank_period", entity: "bank_reconciliation_closing", entityId: closingId,
      after: { status: "unreconciled", reopenedBy }, ipAddress: req.ip, userAgent: req.headers["user-agent"] as string,
    });
    res.json({ ok: true, closing: updated });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Gagal buka kembali periode" });
  }
});

// PATCH /bank-reconciliation/closing/:id — update statement balance / notes
router.patch("/bank-reconciliation/closing/:id", financeMiddleware, async (req, res) => {
  try {
    const closingId = parseInt(req.params.id as string);
    if (isNaN(closingId)) { res.status(400).json({ error: "ID tidak valid" }); return; }
    const [closing] = await db.select().from(bankReconciliationClosingTable).where(eq(bankReconciliationClosingTable.id, closingId)).limit(1);
    if (!closing) { res.status(404).json({ error: "Closing tidak ditemukan" }); return; }
    if (closing.status === "closed") { res.status(400).json({ error: "Periode sudah ditutup." }); return; }
    const { statementEndingBalance, notes } = req.body as { statementEndingBalance?: number; notes?: string };
    const stmtEnding = statementEndingBalance ?? parseFloat(closing.statementEndingBalance ?? "0");
    const difference = parseFloat(closing.systemEndingBalance ?? "0") - stmtEnding;
    const [updated] = await db.update(bankReconciliationClosingTable).set({
      statementEndingBalance: String(stmtEnding),
      difference: String(difference),
      notes: notes ?? closing.notes,
      updatedAt: new Date(),
    }).where(eq(bankReconciliationClosingTable.id, closingId)).returning();
    res.json({ ok: true, closing: updated });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Gagal update closing" });
  }
});

// ================================================================
// FASE 5: Exception Dashboard
// ================================================================

// GET /bank-reconciliation/exception-dashboard
router.get("/bank-reconciliation/exception-dashboard", adminMiddleware, async (req, res) => {
  try {
    // KPI stats
    const { rows: kpiRows } = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total_mutations,
        COUNT(*) FILTER (WHERE status = 'approved')::int AS total_approved,
        COUNT(*) FILTER (WHERE status = 'need_review')::int AS total_need_review,
        COUNT(*) FILTER (WHERE status = 'unmatched')::int AS total_unmatched,
        COUNT(*) FILTER (WHERE status = 'duplicate_need_review')::int AS total_duplicate,
        COUNT(*) FILTER (WHERE status = 'rejected')::int AS total_rejected,
        COUNT(*) FILTER (WHERE status = 'approved' AND accounting_posted = false)::int AS total_unposted_journal,
        COALESCE(SUM(amount) FILTER (WHERE status NOT IN ('approved','rejected') AND direction = 'IN'), 0)::numeric AS outstanding_difference
      FROM sport_center.bank_mutations
    `);
    const kpi = (kpiRows as any[])[0] ?? {};

    // Exception: Need Review (last 30)
    const needReview = await db.select({
      id: bankMutationsTable.id,
      transactionDate: bankMutationsTable.transactionDate,
      description: bankMutationsTable.description,
      amount: bankMutationsTable.amount,
      direction: bankMutationsTable.direction,
      bankAccountId: bankMutationsTable.bankAccountId,
    }).from(bankMutationsTable)
      .where(eq(bankMutationsTable.status, "need_review"))
      .orderBy(desc(bankMutationsTable.transactionDate), desc(bankMutationsTable.id))
      .limit(30);

    // Exception: Unmatched (last 30)
    const unmatched = await db.select({
      id: bankMutationsTable.id,
      transactionDate: bankMutationsTable.transactionDate,
      description: bankMutationsTable.description,
      amount: bankMutationsTable.amount,
      direction: bankMutationsTable.direction,
      bankAccountId: bankMutationsTable.bankAccountId,
    }).from(bankMutationsTable)
      .where(eq(bankMutationsTable.status, "unmatched"))
      .orderBy(desc(bankMutationsTable.transactionDate), desc(bankMutationsTable.id))
      .limit(30);

    // Exception: Duplicate (last 30)
    const duplicate = await db.select({
      id: bankMutationsTable.id,
      transactionDate: bankMutationsTable.transactionDate,
      description: bankMutationsTable.description,
      amount: bankMutationsTable.amount,
      direction: bankMutationsTable.direction,
      bankAccountId: bankMutationsTable.bankAccountId,
    }).from(bankMutationsTable)
      .where(eq(bankMutationsTable.status, "duplicate_need_review"))
      .orderBy(desc(bankMutationsTable.id))
      .limit(30);

    // Exception: Approved belum dijurnal (last 30)
    const approvedUnposted = await db.select({
      id: bankMutationsTable.id,
      transactionDate: bankMutationsTable.transactionDate,
      description: bankMutationsTable.description,
      amount: bankMutationsTable.amount,
      direction: bankMutationsTable.direction,
      bankAccountId: bankMutationsTable.bankAccountId,
      approvedBy: bankMutationsTable.approvedBy,
      approvedAt: bankMutationsTable.approvedAt,
    }).from(bankMutationsTable)
      .where(and(eq(bankMutationsTable.status, "approved"), eq(bankMutationsTable.accountingPosted, false)))
      .orderBy(desc(bankMutationsTable.transactionDate), desc(bankMutationsTable.id))
      .limit(30);

    // Exception: Closed period violations — approved mutations in closed periods without journal
    const { rows: cpvRows } = await db.execute(sql`
      SELECT bm.id, bm.transaction_date AS "transactionDate", bm.description, bm.amount, bm.direction,
             bm.bank_account_id AS "bankAccountId", bm.accounting_posted AS "accountingPosted"
      FROM sport_center.bank_mutations bm
      JOIN sport_center.bank_reconciliation_closing bc
        ON TO_CHAR(TO_DATE(bm.transaction_date, 'YYYY-MM-DD'), 'YYYY-MM') =
           TO_CHAR(TO_DATE(bc.period_year::text || '-' || LPAD(bc.period_month::text,2,'0') || '-01', 'YYYY-MM-DD'), 'YYYY-MM')
        AND bc.status = 'closed'
      WHERE bm.status != 'approved' OR bm.accounting_posted = false
      ORDER BY bm.transaction_date DESC
      LIMIT 20
    `);

    res.json({
      kpi: {
        totalMutations: Number(kpi.total_mutations ?? 0),
        totalApproved: Number(kpi.total_approved ?? 0),
        totalNeedReview: Number(kpi.total_need_review ?? 0),
        totalUnmatched: Number(kpi.total_unmatched ?? 0),
        totalDuplicate: Number(kpi.total_duplicate ?? 0),
        totalRejected: Number(kpi.total_rejected ?? 0),
        totalUnpostedJournal: Number(kpi.total_unposted_journal ?? 0),
        outstandingDifference: Number(kpi.outstanding_difference ?? 0),
      },
      exceptions: {
        needReview,
        unmatched,
        duplicate,
        approvedUnposted,
        closedPeriodViolations: cpvRows as any[],
      },
    });
  } catch (err: any) {
    req.log.error({ err }, "Exception dashboard error");
    res.status(500).json({ error: err?.message ?? "Gagal memuat exception dashboard" });
  }
});

// ================================================================
// FASE 3: Bank Balance Ledger
// ================================================================

// GET /bank-reconciliation/balances
router.get("/bank-reconciliation/balances", adminMiddleware, async (req, res) => {
  try {
    const balances = await db.select().from(bankAccountBalancesTable)
      .orderBy(bankAccountBalancesTable.bankAccountId);
    res.json({ balances });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Gagal memuat saldo rekening" });
  }
});

// ================================================================
// FASE 6: Final Validation / Audit
// ================================================================

// GET /bank-reconciliation/audit-trail — riwayat aksi bank rekonsiliasi dari audit_logs
router.get("/bank-reconciliation/audit-trail", financeMiddleware, async (req, res) => {
  try {
    const { action, search, dateFrom, dateTo, page = "1", pageSize = "50" } = req.query as Record<string, string>;
    const limit = Math.min(Number(pageSize) || 50, 200);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const conditions: any[] = [
      sql`${auditLogsTable.entity} IN ('bank_mutation', 'bank_journal', 'bank_reconciliation')`,
    ];
    if (action && action !== "all") conditions.push(eq(auditLogsTable.action, action));
    if (dateFrom) conditions.push(sql`DATE(${auditLogsTable.createdAt}) >= ${dateFrom}::date`);
    if (dateTo) conditions.push(sql`DATE(${auditLogsTable.createdAt}) <= ${dateTo}::date`);
    if (search) conditions.push(sql`(${auditLogsTable.userRole} ILIKE ${"%" + search + "%"} OR ${auditLogsTable.action} ILIKE ${"%" + search + "%"} OR ${auditLogsTable.ipAddress} ILIKE ${"%" + search + "%"})`);

    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(auditLogsTable).where(and(...conditions));
    const rows = await db.select().from(auditLogsTable).where(and(...conditions))
      .orderBy(desc(auditLogsTable.createdAt)).limit(limit).offset(offset);

    const actionCounts = await db.select({
      action: auditLogsTable.action, count: sql<number>`count(*)::int`,
    }).from(auditLogsTable)
      .where(sql`${auditLogsTable.entity} IN ('bank_mutation', 'bank_journal', 'bank_reconciliation')`)
      .groupBy(auditLogsTable.action).orderBy(desc(sql`count(*)`));

    res.json({ total, page: Number(page), pageSize: limit, rows, actionCounts });
  } catch (err: any) {
    req.log.error({ err }, "Bank audit-trail error");
    res.status(500).json({ error: err?.message ?? "Gagal ambil audit trail" });
  }
});

// GET /bank-reconciliation/audit — validasi integritas data produksi
router.get("/bank-reconciliation/audit", financeMiddleware, async (req, res) => {
  try {
    const result = await runBankAudit();
    res.json(result);
  } catch (err: any) {
    req.log.error({ err }, "Bank reconciliation audit error");
    res.status(500).json({ error: err?.message ?? "Gagal menjalankan audit" });
  }
});

export default router;
