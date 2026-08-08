import { Router } from "express";
import {
  db,
  taxTransactionsTable,
  bookingsTable,
  facilitiesTable,
} from "@workspace/db";
import { and, gte, lte, eq } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";

const router = Router();

function parseFilters(query: Record<string, any>) {
  const {
    startDate,
    endDate,
    facilityId,
    customerType,
    paymentStatus,
    company,
  } = query;
  return { startDate, endDate, facilityId, customerType, paymentStatus, companyOnly: company === "true" };
}

async function fetchTaxRows(filters: ReturnType<typeof parseFilters>) {
  const { startDate, endDate, facilityId, customerType, paymentStatus, companyOnly } = filters;

  const conditions = [];
  if (startDate) conditions.push(gte(taxTransactionsTable.transactionDate, startDate as string));
  if (endDate) conditions.push(lte(taxTransactionsTable.transactionDate, endDate as string));

  const rows = await db
    .select({
      id: taxTransactionsTable.id,
      referenceType: taxTransactionsTable.referenceType,
      referenceId: taxTransactionsTable.referenceId,
      referenceNumber: taxTransactionsTable.referenceNumber,
      taxCode: taxTransactionsTable.taxCode,
      taxRate: taxTransactionsTable.taxRate,
      dpp: taxTransactionsTable.dpp,
      taxAmount: taxTransactionsTable.taxAmount,
      transactionDate: taxTransactionsTable.transactionDate,
      status: taxTransactionsTable.status,
      transactionType: taxTransactionsTable.transactionType,
      // booking fields (null for company_invoice ref)
      customerName: bookingsTable.customerName,
      customerType: bookingsTable.customerType,
      payerType: bookingsTable.payerType,
      paymentStatus: bookingsTable.status,
      facilityId: bookingsTable.facilityId,
      facilityName: facilitiesTable.name,
    })
    .from(taxTransactionsTable)
    .leftJoin(
      bookingsTable,
      and(
        eq(taxTransactionsTable.referenceType, "booking"),
        eq(taxTransactionsTable.referenceId, bookingsTable.id),
      ),
    )
    .leftJoin(facilitiesTable, eq(bookingsTable.facilityId, facilitiesTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(taxTransactionsTable.transactionDate);

  return rows.filter((r) => {
    if (facilityId && r.facilityId !== Number(facilityId)) return false;
    if (customerType && r.customerType !== customerType) return false;
    if (paymentStatus && r.paymentStatus !== paymentStatus) return false;
    if (companyOnly && r.payerType !== "company") return false;
    return true;
  });
}

function toNum(v: unknown): number {
  return Math.round(Number(v) * 100) / 100;
}

function buildSummary(rows: Awaited<ReturnType<typeof fetchTaxRows>>) {
  let totalDpp = 0, totalDppNilaiLain = 0, totalTaxAmount = 0, totalGrandTotal = 0;
  const activeRows = rows.filter((r) => r.transactionType === "original" && r.status !== "reversed");
  for (const r of activeRows) {
    const dpp = toNum(r.dpp);
    const tax = toNum(r.taxAmount);
    totalDpp += dpp;
    totalDppNilaiLain += Math.round(dpp * 11 / 12);
    totalTaxAmount += tax;
    totalGrandTotal += dpp + tax;
  }
  return {
    totalDpp: Math.round(totalDpp),
    totalDppNilaiLain: Math.round(totalDppNilaiLain),
    totalTaxAmount: Math.round(totalTaxAmount),
    totalGrandTotal: Math.round(totalGrandTotal),
    totalTransactions: activeRows.length,
  };
}

function buildByPeriod(rows: Awaited<ReturnType<typeof fetchTaxRows>>) {
  const map = new Map<string, { count: number; dpp: number; dppNilaiLain: number; taxAmount: number; grandTotal: number }>();
  for (const r of rows) {
    const period = r.transactionDate.slice(0, 7); // YYYY-MM
    const dpp = toNum(r.dpp);
    const tax = toNum(r.taxAmount);
    const entry = map.get(period) ?? { count: 0, dpp: 0, dppNilaiLain: 0, taxAmount: 0, grandTotal: 0 };
    entry.count++;
    entry.dpp += dpp;
    entry.dppNilaiLain += Math.round(dpp * 11 / 12);
    entry.taxAmount += tax;
    entry.grandTotal += dpp + tax;
    map.set(period, entry);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, v]) => ({
      period,
      count: v.count,
      dpp: Math.round(v.dpp),
      dppNilaiLain: Math.round(v.dppNilaiLain),
      taxAmount: Math.round(v.taxAmount),
      grandTotal: Math.round(v.grandTotal),
    }));
}

function buildSptMasa(rows: Awaited<ReturnType<typeof fetchTaxRows>>) {
  const active = rows.filter((r) => r.transactionType === "original" && r.status !== "reversed");
  const map = new Map<string, {
    count: number; dpp: number; ppnKeluaran: number;
    items: any[];
  }>();
  for (const r of active) {
    const masaPajak = r.transactionDate.slice(0, 7);
    const dpp = toNum(r.dpp);
    const ppn = toNum(r.taxAmount);
    const entry = map.get(masaPajak) ?? { count: 0, dpp: 0, ppnKeluaran: 0, items: [] };
    entry.count++;
    entry.dpp += dpp;
    entry.ppnKeluaran += ppn;
    entry.items.push({
      nomorInvoice: r.referenceNumber,
      tanggalPajak: r.transactionDate,
      customer: r.customerName ?? r.referenceNumber,
      npwp: null,
      npwpKeterangan: r.payerType === "company" ? "Perusahaan" : "Retail/Non-NPWP",
      dpp: Math.round(dpp),
      dppNilaiLain: Math.round(dpp * 11 / 12),
      ppnKeluaran: Math.round(ppn),
      taxCode: r.taxCode,
    });
    map.set(masaPajak, entry);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([masaPajak, v]) => ({
      masaPajak,
      count: v.count,
      dpp: Math.round(v.dpp),
      ppnKeluaran: Math.round(v.ppnKeluaran),
      items: v.items,
    }));
}

function formatTransactions(rows: Awaited<ReturnType<typeof fetchTaxRows>>) {
  return rows.map((r) => {
    const dpp = toNum(r.dpp);
    const tax = toNum(r.taxAmount);
    return {
      id: r.id,
      referenceNumber: r.referenceNumber,
      referenceType: r.referenceType,
      customerName: r.customerName ?? null,
      facilityName: r.facilityName ?? null,
      customerType: r.customerType ?? null,
      payerType: r.payerType ?? "personal",
      paymentStatus: r.paymentStatus ?? null,
      taxCode: r.taxCode,
      taxRate: Number(r.taxRate),
      dpp: Math.round(dpp),
      dppNilaiLain: Math.round(dpp * 11 / 12),
      taxAmount: Math.round(tax),
      grandTotal: Math.round(dpp + tax),
      transactionDate: r.transactionDate,
      status: r.status,
      transactionType: r.transactionType,
    };
  });
}

// ── GET /admin/tax-report ─────────────────────────────────────────────────────
router.get("/admin/tax-report", adminMiddleware, async (req, res) => {
  try {
    const filters = parseFilters(req.query as any);
    const rows = await fetchTaxRows(filters);
    res.json({
      summary: buildSummary(rows),
      byPeriod: buildByPeriod(rows),
      sptMasa: buildSptMasa(rows),
      transactions: formatTransactions(rows),
    });
  } catch (err) {
    req.log.error({ err }, "Tax report error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /admin/tax-report/export/csv ─────────────────────────────────────────
router.get("/admin/tax-report/export/csv", adminMiddleware, async (req, res) => {
  try {
    const filters = parseFilters(req.query as any);
    const rows = await fetchTaxRows(filters);
    const txns = formatTransactions(rows);

    const headers = [
      "No", "Nomor Invoice", "Tipe Ref", "Customer", "Fasilitas",
      "Tipe Customer", "Tipe Pembayar", "Status Pembayaran",
      "Kode Pajak", "Tarif PPN (%)", "DPP (Rp)", "DPP Nilai Lain (Rp)", "PPN (Rp)",
      "Grand Total (Rp)", "Tanggal Transaksi", "Status Pajak", "Tipe Transaksi",
    ];

    const csvLines = [
      headers.join(","),
      ...txns.map((t, i) =>
        [
          i + 1,
          `"${t.referenceNumber}"`,
          t.referenceType,
          `"${t.customerName ?? ""}"`,
          `"${t.facilityName ?? ""}"`,
          t.customerType ?? "",
          t.payerType ?? "personal",
          t.paymentStatus ?? "",
          t.taxCode,
          t.taxRate,
          t.dpp,
          t.dppNilaiLain,
          t.taxAmount,
          t.grandTotal,
          t.transactionDate,
          t.status,
          t.transactionType,
        ].join(","),
      ),
    ];

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="laporan-ppn.csv"`);
    res.send("\uFEFF" + csvLines.join("\r\n"));
  } catch (err) {
    req.log.error({ err }, "Tax CSV export error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /admin/tax-report/export/spt-masa ────────────────────────────────────
router.get("/admin/tax-report/export/spt-masa", adminMiddleware, async (req, res) => {
  try {
    const filters = parseFilters(req.query as any);
    const rows = await fetchTaxRows(filters);
    const spt = buildSptMasa(rows);

    const headers = [
      "Masa Pajak", "Nomor Invoice", "Tanggal", "Customer",
      "NPWP", "Keterangan", "DPP (Rp)", "DPP Nilai Lain (Rp)", "PPN Keluaran (Rp)", "Kode Pajak",
    ];

    const csvLines = [headers.join(",")];
    for (const masa of spt) {
      for (const item of masa.items) {
        csvLines.push([
          masa.masaPajak,
          `"${item.nomorInvoice}"`,
          item.tanggalPajak,
          `"${item.customer}"`,
          item.npwp ?? "",
          `"${item.npwpKeterangan}"`,
          item.dpp,
          item.dppNilaiLain,
          item.ppnKeluaran,
          item.taxCode,
        ].join(","));
      }
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="spt-masa-ppn.csv"`);
    res.send("\uFEFF" + csvLines.join("\r\n"));
  } catch (err) {
    req.log.error({ err }, "SPT CSV export error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
