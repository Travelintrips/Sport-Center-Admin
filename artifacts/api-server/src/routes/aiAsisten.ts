import { Router } from "express";
import { adminMiddleware } from "../lib/auth";
import { db, taxTransactionsTable, paymentsTable, bookingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();
const CHAT_URL = "https://mcp.cstlogistic.co.id/api/ai/core-chat/messages";

router.post("/admin/ai-asisten/chat", adminMiddleware, async (req, res) => {
  const message = req.body?.message;
  if (typeof message !== "string" || !message.trim() || message.length > 2000) { res.status(400).json({ error: "Pesan tidak valid." }); return; }
  const secret = process.env.AI_CORE_CHAT_CONNECTOR_KEY?.trim();
  if (!secret) { res.status(503).json({ error: "Koneksi AI Core belum dikonfigurasi di backend." }); return; }
  try {
    const upstream = await fetch(CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ai-core-connector-key": secret },
      body: JSON.stringify({
        message: "Anda adalah AI Asisten admin Sport Center CST. Berikan jawaban informatif dalam bahasa Indonesia. Jangan menjalankan tindakan, mengubah data, mengarang angka pajak, atau mengklaim akses BizPortal/Coretax tanpa bukti. Pertanyaan: " + message.trim(),
        mode: "ask", modelPolicy: "smart", projectName: "Sport Center Admin - AI Asisten", source: "text"
      }),
      signal: AbortSignal.timeout(25000)
    });
    if (!upstream.ok) { res.status(502).json({ error: "AI Core tidak menerima permintaan. HTTP " + upstream.status }); return; }
    const body: unknown = await upstream.json();
    const result = body as Record<string, unknown> | null;
    const reply = result && typeof result.reply === "string" ? result.reply.trim() : "";
    if (!reply) { res.status(502).json({ error: "AI Core tidak mengembalikan jawaban yang valid." }); return; }
    res.json({ reply, source: "ai-core", mode: "ask" });
  } catch {
    res.status(503).json({ error: "AI Core sementara tidak dapat dihubungi." });
  }
});

/** Narrow, authenticated, read-only trace. Does not fetch or expose proof files or contact PII. */
router.get("/admin/ai-asisten/tax-trace/:reference", adminMiddleware, async (req, res) => {
  const reference = String(req.params.reference || "").trim().toUpperCase();
  if (!/^(?:SC-\\d+|SCPAY-SC-\\d+)$/.test(reference)) {
    res.status(400).json({ error: "Referensi tidak valid." }); return;
  }
  try {
    const records = await db.select().from(taxTransactionsTable).where(eq(taxTransactionsTable.referenceNumber, reference));
    if (!records.length) { res.status(404).json({ error: "Catatan pajak tidak ditemukan." }); return; }
    const items = [];
    for (const tax of records) {
      const paymentId = /^SCPAY-SC-(\\d+)$/.exec(reference)?.[1];
      const canTracePayment = !!paymentId && tax.referenceId === Number(paymentId) && /payment/i.test(tax.referenceType);
      const isBooking = /booking/i.test(tax.referenceType);
      const payment = canTracePayment ? (await db.select().from(paymentsTable).where(eq(paymentsTable.id, tax.referenceId)).limit(1))[0] : null;
      const bookingId = payment?.bookingId ?? (isBooking ? tax.referenceId : null);
      const booking = bookingId ? (await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId)).limit(1))[0] : null;
      items.push({
        tax: { id: tax.id, referenceType: tax.referenceType, referenceId: tax.referenceId, referenceNumber: tax.referenceNumber, transactionDate: tax.transactionDate, status: tax.status, transactionType: tax.transactionType, taxCode: tax.taxCode, taxRate: Number(tax.taxRate), dpp: Number(tax.dpp), dppNilaiLain: tax.dppNilaiLain === null ? null : Number(tax.dppNilaiLain), taxAmount: Number(tax.taxAmount), grandTotal: tax.grandTotal === null ? null : Number(tax.grandTotal) },
        payment: payment ? { id: payment.id, bookingId: payment.bookingId, amount: Number(payment.amount), status: payment.status, paymentMethod: payment.paymentMethod, paymentType: payment.paymentType, confirmedAt: payment.confirmedAt, proofExists: !!payment.proofUrl } : null,
        booking: booking ? { id: booking.id, orderNumber: booking.orderNumber, customerName: booking.customerName, payerType: booking.payerType, status: booking.status, bookingDate: booking.bookingDate, totalPrice: Number(booking.totalPrice), grandTotal: booking.grandTotal === null ? null : Number(booking.grandTotal), billingStatus: booking.billingStatus } : null,
        traceStatus: booking ? "booking-linked" : payment ? "payment-only" : "unlinked",
        limitations: ["Invoice PDF dan isi bukti pembayaran tidak diperiksa.", "Catatan pajak tidak membuktikan perlakuan PPN final."]
      });
    }
    res.json({ reference, items, readOnly: true });
  } catch (err) {
    req.log.error({ err }, "AI Asisten source trace failed");
    res.status(500).json({ error: "Penelusuran sumber transaksi gagal." });
  }
});

export default router;
