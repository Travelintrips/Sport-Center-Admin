import { Router } from "express";
import { db } from "@workspace/db";
import { bankMutationsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import {
  verifySheetAccess,
  pushReconciliationToSheet,
  pullMutationsFromSheet,
} from "../lib/googleSheets";
import {
  normalizeDescription,
  extractOrderId,
  extractProviderName,
  buildMutationKey,
} from "../lib/bankMatcher";
import { normalizePaymentProvider } from "../lib/paymentProvider";
import { resolveBankImportSource } from "../lib/paymentEnrichment";

const router = Router();

// POST /bank-reconciliation/sheets/connect
router.post("/bank-reconciliation/sheets/connect", adminMiddleware, async (req, res) => {
  try {
    const { sheetId } = req.body;
    if (!sheetId || typeof sheetId !== "string") {
      res.status(400).json({ error: "sheetId wajib diisi" });
      return;
    }
    const info = await verifySheetAccess(sheetId);
    res.json({ ok: true, title: info.title, sheetNames: info.sheetNames });
  } catch (err: any) {
    req.log.error({ err }, "Bank recon sheets connect error");
    res.status(400).json({ error: err?.message ?? "Tidak dapat mengakses sheet. Pastikan Service Account memiliki akses editor." });
  }
});

// POST /bank-reconciliation/sheets/pull
// Tarik mutasi dari Google Sheet dan import ke DB
router.post("/bank-reconciliation/sheets/pull", adminMiddleware, async (req, res) => {
  try {
    const { sheetId, sheetName } = req.body;
    if (!sheetId || typeof sheetId !== "string") {
      res.status(400).json({ error: "sheetId wajib diisi" });
      return;
    }

    const resolvedSheetName = sheetName ?? undefined;
    const sourceMapping = await resolveBankImportSource(sheetId, resolvedSheetName);
    const rows = await pullMutationsFromSheet(sheetId, resolvedSheetName);
    if (!rows.length) {
      res.json({ ok: true, importedCount: 0, skippedCount: 0 });
      return;
    }

    let importedCount = 0;
    let skippedCount = 0;

    for (const row of rows) {
      const creditAmount = Number(row.creditAmount) || 0;
      const debitAmount = Number(row.debitAmount) || 0;
      const direction: "IN" | "OUT" = creditAmount > 0 ? "IN" : "OUT";
      const amount = Math.max(creditAmount, debitAmount);
      if (amount <= 0) { skippedCount++; continue; }

      const mutationKey = buildMutationKey(row.transactionDate, amount, direction);

      // Cek duplikat
      const existing = await db
        .select({ id: bankMutationsTable.id })
        .from(bankMutationsTable)
        .where(eq(bankMutationsTable.mutationKey, mutationKey))
        .limit(1);

      if (existing.length > 0) { skippedCount++; continue; }

      const normalizedDescription = normalizeDescription(row.description);
      const providerOrderId = extractOrderId(row.description) ?? null;
      const detectedDescriptionProvider = extractProviderName(normalizedDescription);
      const mappedProvider = normalizePaymentProvider(sourceMapping?.providerName);
      const providerName = mappedProvider ?? detectedDescriptionProvider ?? null;
      const providerDetectionSource = mappedProvider
        ? "provider-specific import source"
        : detectedDescriptionProvider
          ? "proven description pattern"
          : null;
      const mappedBankAccountId = sourceMapping?.bankAccountId ?? null;
      const mappedCompanyId = sourceMapping?.companyId ?? null;
      const rawPayload = {
        ...row,
        sourceType: "google_sheet",
        sourceId: sheetId,
        worksheetName: resolvedSheetName ?? null,
        sourceClassification: "actual_bank_mutation",
        sourceMappingConfigured: Boolean(sourceMapping),
        sourceMappingValidated: Boolean(sourceMapping),
      };

      try {
        await db.insert(bankMutationsTable).values({
          companyId: mappedCompanyId,
          bankAccountId: mappedBankAccountId,
          transactionDate: row.transactionDate,
          description: row.description,
          creditAmount: String(creditAmount),
          debitAmount: String(debitAmount),
          amount: String(amount),
          direction,
          mutationKey,
          normalizedDescription,
          providerDetectionSource,
          providerOrderId,
          providerName,
          rawPayload,
          status: "unmatched",
        });
        importedCount++;
      } catch {
        skippedCount++;
      }
    }

    res.json({ ok: true, importedCount, skippedCount });
  } catch (err: any) {
    req.log.error({ err }, "Bank recon sheets pull error");
    res.status(400).json({ error: err?.message ?? "Gagal membaca mutasi dari Google Sheet" });
  }
});

// POST /bank-reconciliation/sheets/push
// Push hasil rekonsiliasi ke Google Sheet
router.post("/bank-reconciliation/sheets/push", adminMiddleware, async (req, res) => {
  try {
    const { sheetId, sheetName, statusFilter } = req.body as { sheetId: string; sheetName?: string; statusFilter?: string[] };
    if (!sheetId || typeof sheetId !== "string") {
      res.status(400).json({ error: "sheetId wajib diisi" });
      return;
    }

    const mutations = await db
      .select()
      .from(bankMutationsTable)
      .orderBy(desc(bankMutationsTable.transactionDate));

    const filtered = statusFilter?.length
      ? mutations.filter((m) => statusFilter.includes(m.status))
      : mutations;

    const result = await pushReconciliationToSheet(sheetId, filtered.map((m) => ({
      id: m.id,
      transactionDate: m.transactionDate,
      description: m.description,
      creditAmount: m.creditAmount ?? "0",
      debitAmount: m.debitAmount ?? "0",
      amount: m.amount,
      direction: m.direction,
      status: m.status,
      providerOrderId: m.providerOrderId,
      providerName: m.providerName,
      bankAccountId: m.bankAccountId,
      createdAt: m.createdAt,
    })), sheetName ?? undefined);

    res.json({ ok: true, updatedRows: result.updatedRows });
  } catch (err: any) {
    req.log.error({ err }, "Bank recon sheets push error");
    res.status(400).json({ error: err?.message ?? "Gagal menulis ke Google Sheet" });
  }
});

export default router;
