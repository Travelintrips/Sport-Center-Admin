import { Router } from "express";
import { db } from "@workspace/db";
import {
  bankMutationsTable,
  bankReconciliationMatchesTable,
  bookingsTable,
  paymentsTable,
  facilitiesTable,
  auditLogsTable,
} from "@workspace/db";
import { eq, desc, and, inArray, sql, like, gte, lte } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import {
  normalizeDescription,
  extractOrderId,
  extractProviderName,
  buildMutationKey,
  runMatching,
} from "../lib/bankMatcher";
import * as XLSX from "xlsx";
import multer from "multer";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function parseRows(rows: any[]): Array<{
  transactionDate: string;
  description: string;
  creditAmount: number;
  debitAmount: number;
  bankAccountId?: string;
}> {
  return rows
    .map((row) => {
      // Normalize keys to lowercase with underscores
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

      const credit = parseFloat(String(creditRaw).replace(/[^0-9.]/g, "")) || 0;
      const debit = parseFloat(String(debitRaw).replace(/[^0-9.]/g, "")) || 0;

      // Parse date
      let transactionDate = "";
      if (dateRaw) {
        const raw = String(dateRaw).trim();
        // Try ISO
        if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
          transactionDate = raw.slice(0, 10);
        } else if (/^\d{2}\/\d{2}\/\d{4}/.test(raw)) {
          const [d, m, y] = raw.split("/");
          transactionDate = `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
        } else if (/^\d{2}-\d{2}-\d{4}/.test(raw)) {
          const [d, m, y] = raw.split("-");
          transactionDate = `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
        } else {
          // Excel serial date number
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

    // Auto-run matching for newly inserted
    let matchResult = { processed: 0, autoApproved: 0, needsReview: 0, unmatched: 0, duplicates: 0 };
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
      conditions.push(inArray(bankMutationsTable.status, [status as any]));
    }
    if (dateFrom) conditions.push(gte(bankMutationsTable.transactionDate, dateFrom));
    if (dateTo) conditions.push(lte(bankMutationsTable.transactionDate, dateTo));
    if (minAmount) conditions.push(sql`${bankMutationsTable.amount} >= ${Number(minAmount)}`);
    if (maxAmount) conditions.push(sql`${bankMutationsTable.amount} <= ${Number(maxAmount)}`);
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

    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(bankMutationsTable);

    res.json({ mutations, total, page: Number(page), pageSize: limit });
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

    const matches = await db
      .select()
      .from(bankReconciliationMatchesTable)
      .where(eq(bankReconciliationMatchesTable.mutationId, mutationId))
      .orderBy(desc(bankReconciliationMatchesTable.matchScore));

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

    // Reject all other matches for this mutation
    await db
      .update(bankReconciliationMatchesTable)
      .set({ status: "rejected" })
      .where(eq(bankReconciliationMatchesTable.mutationId, mutationId));

    // Approve selected match
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

      await db
        .update(bankMutationsTable)
        .set({
          status: "approved",
          matchedPaymentId: match?.candidateType === "payment" ? match.candidateId : null,
          matchedOrderId: match?.candidateType === "order" ? match.candidateId : null,
          updatedAt: new Date(),
        })
        .where(eq(bankMutationsTable.id, mutationId));
    } else if (candidateType && candidateId) {
      // Manual approve without existing match record
      await db
        .insert(bankReconciliationMatchesTable)
        .values({
          mutationId,
          candidateType: candidateType as any,
          candidateId,
          matchScore: 100,
          matchReason: "Manual approval oleh admin",
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
    } else {
      // Approve as-is (no match required)
      await db
        .update(bankMutationsTable)
        .set({ status: "approved", updatedAt: new Date() })
        .where(eq(bankMutationsTable.id, mutationId));
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

    await db
      .update(bankMutationsTable)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(eq(bankMutationsTable.id, mutationId));

    await db
      .update(bankReconciliationMatchesTable)
      .set({ status: "rejected" })
      .where(eq(bankReconciliationMatchesTable.mutationId, mutationId));

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Gagal reject" });
  }
});

// DELETE /bank-reconciliation/mutations — hapus semua atau berdasarkan status
router.delete("/bank-reconciliation/mutations", adminMiddleware, async (req, res) => {
  try {
    const { statusFilter } = req.body as { statusFilter?: string[] };
    let deletedCount = 0;
    if (statusFilter && statusFilter.length > 0) {
      const rows = await db
        .select({ id: bankMutationsTable.id })
        .from(bankMutationsTable)
        .where(inArray(bankMutationsTable.status, statusFilter as any));
      const ids = rows.map((r) => r.id);
      if (ids.length > 0) {
        // Hapus matches dulu (foreign key)
        await db.delete(bankReconciliationMatchesTable).where(inArray(bankReconciliationMatchesTable.mutationId, ids));
        await db.delete(bankMutationsTable).where(inArray(bankMutationsTable.id, ids));
        deletedCount = ids.length;
      }
    } else {
      // Hapus semua
      await db.delete(bankReconciliationMatchesTable);
      const rows = await db.delete(bankMutationsTable).returning({ id: bankMutationsTable.id });
      deletedCount = rows.length;
    }
    res.json({ ok: true, deletedCount });
  } catch (err: any) {
    req.log.error({ err }, "Bank reconciliation delete mutations error");
    res.status(500).json({ error: err?.message ?? "Gagal menghapus data mutasi" });
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

// GET /bank-reconciliation/mutations/:id/candidates — enriched candidates with booking/payment details
router.get("/bank-reconciliation/mutations/:id/candidates", adminMiddleware, async (req, res) => {
  try {
    const mutationId = parseInt(req.params.id);
    if (isNaN(mutationId)) { res.status(400).json({ error: "ID tidak valid" }); return; }

    const [mutation] = await db.select().from(bankMutationsTable).where(eq(bankMutationsTable.id, mutationId)).limit(1);
    if (!mutation) { res.status(404).json({ error: "Mutasi tidak ditemukan" }); return; }

    const candidates = await db
      .select()
      .from(bankReconciliationMatchesTable)
      .where(eq(bankReconciliationMatchesTable.mutationId, mutationId))
      .orderBy(desc(bankReconciliationMatchesTable.matchScore));

    // Batch-load related records
    const paymentIds = candidates.filter((c) => c.candidateType === "payment").map((c) => c.candidateId);
    const orderIds = candidates.filter((c) => c.candidateType === "order").map((c) => c.candidateId);

    const payments = paymentIds.length
      ? await db.select({ id: paymentsTable.id, bookingId: paymentsTable.bookingId, amount: paymentsTable.amount, proofUrl: paymentsTable.proofUrl, status: paymentsTable.status, createdAt: paymentsTable.createdAt }).from(paymentsTable).where(inArray(paymentsTable.id, paymentIds))
      : [];
    const paymentMap = new Map(payments.map((p) => [p.id, p]));

    const allBookingIds = [...new Set([...payments.map((p) => p.bookingId).filter((x): x is number => x != null), ...orderIds])];
    const bookings = allBookingIds.length
      ? await db.select({ id: bookingsTable.id, orderNumber: bookingsTable.orderNumber, customerName: bookingsTable.customerName, customerPhone: bookingsTable.customerPhone, customerEmail: bookingsTable.customerEmail, bookingDate: bookingsTable.bookingDate, totalPrice: bookingsTable.totalPrice, grandTotal: bookingsTable.grandTotal, status: bookingsTable.status, facilityId: bookingsTable.facilityId }).from(bookingsTable).where(inArray(bookingsTable.id, allBookingIds))
      : [];
    const bookingMap = new Map(bookings.map((b) => [b.id, b]));

    const facilityIds = [...new Set(bookings.map((b) => b.facilityId).filter((x): x is number => x != null))];
    const facilities = facilityIds.length
      ? await db.select({ id: facilitiesTable.id, name: facilitiesTable.name }).from(facilitiesTable).where(inArray(facilitiesTable.id, facilityIds))
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

    // Audit log
    const user = (req as any).user;
    await db.insert(auditLogsTable).values({ userId: user?.userId, userRole: user?.role, action: "view_candidates", entity: "bank_mutation", entityId: mutationId, ipAddress: req.ip, userAgent: req.headers["user-agent"] as string });

    res.json({ mutation, candidates: enriched });
  } catch (err: any) {
    req.log.error({ err }, "Bank reconciliation get-candidates error");
    res.status(500).json({ error: err?.message ?? "Gagal memuat kandidat" });
  }
});

// POST /bank-reconciliation/mutations/:id/approve-candidate
router.post("/bank-reconciliation/mutations/:id/approve-candidate", adminMiddleware, async (req, res) => {
  try {
    const mutationId = parseInt(req.params.id);
    if (isNaN(mutationId)) { res.status(400).json({ error: "ID tidak valid" }); return; }
    const { candidateType, candidateId, note } = req.body as { candidateType: "payment" | "order"; candidateId: number; note?: string };
    if (!candidateType || !candidateId) { res.status(400).json({ error: "candidateType dan candidateId diperlukan" }); return; }

    const [mutation] = await db.select().from(bankMutationsTable).where(eq(bankMutationsTable.id, mutationId)).limit(1);
    if (!mutation) { res.status(404).json({ error: "Mutasi tidak ditemukan" }); return; }

    // Reject all existing candidates for this mutation
    await db.update(bankReconciliationMatchesTable).set({ status: "rejected" }).where(eq(bankReconciliationMatchesTable.mutationId, mutationId));

    // Find and approve the selected candidate, or create new if manual
    const [existing] = await db.select().from(bankReconciliationMatchesTable).where(and(
      eq(bankReconciliationMatchesTable.mutationId, mutationId),
      eq(bankReconciliationMatchesTable.candidateId, candidateId),
    )).limit(1);

    if (existing) {
      await db.update(bankReconciliationMatchesTable).set({ status: "approved", note: note ?? null }).where(eq(bankReconciliationMatchesTable.id, existing.id));
    } else {
      await db.insert(bankReconciliationMatchesTable).values({
        mutationId,
        candidateType,
        candidateId,
        matchScore: 100,
        matchReason: note ?? "Disetujui manual oleh admin",
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

    // Update mutation status to approved
    await db.update(bankMutationsTable).set({
      status: "approved",
      matchedPaymentId: candidateType === "payment" ? candidateId : null,
      matchedOrderId: candidateType === "order" ? candidateId : null,
      updatedAt: new Date(),
    }).where(eq(bankMutationsTable.id, mutationId));

    // Audit log
    const user = (req as any).user;
    await db.insert(auditLogsTable).values({ userId: user?.userId, userRole: user?.role, action: "approve_candidate", entity: "bank_mutation", entityId: mutationId, after: { candidateType, candidateId, note }, ipAddress: req.ip, userAgent: req.headers["user-agent"] as string });

    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "Bank reconciliation approve-candidate error");
    res.status(500).json({ error: err?.message ?? "Gagal approve kandidat" });
  }
});

// POST /bank-reconciliation/mutations/:id/mark-unmatched
router.post("/bank-reconciliation/mutations/:id/mark-unmatched", adminMiddleware, async (req, res) => {
  try {
    const mutationId = parseInt(req.params.id);
    if (isNaN(mutationId)) { res.status(400).json({ error: "ID tidak valid" }); return; }

    const [mutation] = await db.select().from(bankMutationsTable).where(eq(bankMutationsTable.id, mutationId)).limit(1);
    if (!mutation) { res.status(404).json({ error: "Mutasi tidak ditemukan" }); return; }

    await db.update(bankMutationsTable).set({ status: "unmatched", matchedPaymentId: null, matchedOrderId: null, updatedAt: new Date() }).where(eq(bankMutationsTable.id, mutationId));
    await db.update(bankReconciliationMatchesTable).set({ status: "rejected" }).where(eq(bankReconciliationMatchesTable.mutationId, mutationId));

    const user = (req as any).user;
    await db.insert(auditLogsTable).values({ userId: user?.userId, userRole: user?.role, action: "mark_unmatched", entity: "bank_mutation", entityId: mutationId, ipAddress: req.ip, userAgent: req.headers["user-agent"] as string });

    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "Bank reconciliation mark-unmatched error");
    res.status(500).json({ error: err?.message ?? "Gagal tandai unmatched" });
  }
});

// POST /bank-reconciliation/mutations/:id/mark-duplicate
router.post("/bank-reconciliation/mutations/:id/mark-duplicate", adminMiddleware, async (req, res) => {
  try {
    const mutationId = parseInt(req.params.id);
    if (isNaN(mutationId)) { res.status(400).json({ error: "ID tidak valid" }); return; }

    const [mutation] = await db.select().from(bankMutationsTable).where(eq(bankMutationsTable.id, mutationId)).limit(1);
    if (!mutation) { res.status(404).json({ error: "Mutasi tidak ditemukan" }); return; }

    await db.update(bankMutationsTable).set({ status: "duplicate_need_review", updatedAt: new Date() }).where(eq(bankMutationsTable.id, mutationId));

    const user = (req as any).user;
    await db.insert(auditLogsTable).values({ userId: user?.userId, userRole: user?.role, action: "mark_duplicate", entity: "bank_mutation", entityId: mutationId, ipAddress: req.ip, userAgent: req.headers["user-agent"] as string });

    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "Bank reconciliation mark-duplicate error");
    res.status(500).json({ error: err?.message ?? "Gagal tandai duplikat" });
  }
});

export default router;
