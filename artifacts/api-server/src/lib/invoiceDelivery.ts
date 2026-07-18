/**
 * invoiceDelivery.ts
 * Orkestrasi pengiriman invoice PDF ke customer:
 *   1. Resolve data invoice dari DB
 *   2. Generate PDF via puppeteer
 *   3. Upload ke storage & simpan URL di bookings.invoicePdfUrl
 *   4. Kirim email dengan lampiran PDF
 *   5. Kirim WA dengan link PDF
 *   6. Catat audit log setiap langkah
 *
 * Dipanggil dari:
 *   - routes/payments.ts  → setelah pembayaran dikonfirmasi admin
 *   - routes/bookings.ts  → setelah admin override status ke confirmed
 *   - routes/invoices.ts  → endpoint manual trigger
 */

import { db, bookingsTable, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { buildInvoiceHtml } from "./invoiceTemplate";
import { resolveInvoiceData } from "./invoiceResolver";
import { generateAndStorePdf } from "./pdfGenerator";
import { logAudit } from "./auditLog";
import { logger } from "./logger";
import { getBaseUrl } from "./appUrl";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getEmailConfig() {
  const smtpFrom = (process.env.SMTP_FROM ?? "").trim();
  const smtpPass = (process.env.SMTP_PASS ?? "").trim();
  return { smtpFrom, smtpPass, configured: Boolean(smtpFrom && smtpPass) };
}

async function getFonnteToken(): Promise<string | null> {
  try {
    const [s] = await db.select({ fonnteToken: settingsTable.fonnteToken }).from(settingsTable).limit(1);
    return s?.fonnteToken || process.env.FONNTE_TOKEN || null;
  } catch {
    return process.env.FONNTE_TOKEN || null;
  }
}

function cleanPhone(raw: string): string {
  if (!raw) return "";
  let p = raw.replace(/\D/g, "");
  if (p.startsWith("0")) p = "62" + p.slice(1);
  else if (p && !p.startsWith("62")) p = "62" + p;
  return p;
}

function fmt(n: number) {
  return new Intl.NumberFormat("id-ID").format(n);
}

// ─── sendInvoicePdfEmail ──────────────────────────────────────────────────────

async function sendInvoicePdfEmail(params: {
  toEmail: string;
  customerName: string;
  invoiceNumber: string;
  facilityName: string;
  grandTotal: number;
  pdfBuffer: Buffer;
  pdfUrl: string;
  orderNumber: string;
}): Promise<void> {
  const { smtpFrom, smtpPass, configured } = await getEmailConfig();
  if (!configured) {
    logger.warn({ orderNumber: params.orderNumber }, "[InvoiceDelivery] SMTP belum dikonfigurasi — email tidak dikirim");
    return;
  }
  if (!params.toEmail) {
    logger.warn({ orderNumber: params.orderNumber }, "[InvoiceDelivery] Email customer kosong — email tidak dikirim");
    return;
  }

  let nodemailer: any;
  try {
    nodemailer = await import("nodemailer");
  } catch {
    logger.warn("[InvoiceDelivery] nodemailer tidak tersedia — email tidak dikirim");
    return;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: smtpFrom, pass: smtpPass },
  });

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <div style="background:linear-gradient(135deg,#ea580c,#dc2626);padding:30px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="color:white;margin:0;font-size:24px">Sport Center Soekarno-Hatta</h1>
        <p style="color:#fed7aa;margin:8px 0 0">Invoice Booking</p>
      </div>
      <div style="background:#fff;padding:30px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
        <p style="color:#374151">Halo <strong>${params.customerName}</strong>,</p>
        <p style="color:#374151">Terima kasih telah melakukan pembayaran. Berikut adalah invoice booking Anda yang telah <strong>dikonfirmasi</strong>.</p>
        
        <table style="width:100%;border-collapse:collapse;margin:20px 0">
          <tr style="background:#f9fafb">
            <td style="padding:10px;border:1px solid #e5e7eb;font-weight:bold;color:#6b7280;font-size:13px">No Invoice</td>
            <td style="padding:10px;border:1px solid #e5e7eb;color:#111827;font-weight:600">${params.invoiceNumber}</td>
          </tr>
          <tr>
            <td style="padding:10px;border:1px solid #e5e7eb;font-weight:bold;color:#6b7280;font-size:13px">Fasilitas</td>
            <td style="padding:10px;border:1px solid #e5e7eb;color:#111827">${params.facilityName}</td>
          </tr>
          <tr style="background:#f9fafb">
            <td style="padding:10px;border:1px solid #e5e7eb;font-weight:bold;color:#6b7280;font-size:13px">Total Pembayaran</td>
            <td style="padding:10px;border:1px solid #e5e7eb;color:#16a34a;font-weight:700;font-size:16px">Rp ${fmt(params.grandTotal)}</td>
          </tr>
        </table>

        <div style="text-align:center;margin:24px 0">
          <a href="${params.pdfUrl}" 
             style="display:inline-block;background:#ea580c;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px">
            📄 Lihat Invoice PDF
          </a>
        </div>

        <p style="color:#6b7280;font-size:13px">Invoice PDF juga terlampir pada email ini untuk kemudahan pengarsipan.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
        <p style="color:#9ca3af;font-size:12px;text-align:center">
          Sport Center Soekarno-Hatta · Kawasan Bandara Soekarno-Hatta, Tangerang 19110
        </p>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: `"Sport Center Soekarno-Hatta" <${smtpFrom}>`,
    to: params.toEmail,
    subject: `Invoice ${params.invoiceNumber} – ${params.facilityName} [Terkonfirmasi]`,
    html: htmlBody,
    attachments: [
      {
        filename: `Invoice-${params.invoiceNumber.replace(/\//g, "-")}.pdf`,
        content: params.pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });

  logger.info({ to: params.toEmail, invoiceNumber: params.invoiceNumber }, "[InvoiceDelivery] Email invoice terkirim");
}

// ─── sendInvoicePdfWA ─────────────────────────────────────────────────────────

async function sendInvoicePdfWA(params: {
  customerPhone: string;
  customerName: string;
  invoiceNumber: string;
  facilityName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  grandTotal: number;
  pdfUrl: string;
  orderNumber: string;
}): Promise<void> {
  const phone = cleanPhone(params.customerPhone);
  if (!phone) {
    logger.warn({ orderNumber: params.orderNumber }, "[InvoiceDelivery] Nomor HP customer kosong — WA tidak dikirim");
    return;
  }

  const token = await getFonnteToken();
  if (!token) {
    logger.warn({ orderNumber: params.orderNumber }, "[InvoiceDelivery] FONNTE_TOKEN tidak tersedia — WA tidak dikirim");
    return;
  }

  const message =
    `✅ *Pembayaran Dikonfirmasi!*\n\n` +
    `Halo *${params.customerName}*,\n\n` +
    `Invoice booking Anda sudah siap:\n\n` +
    `📋 *No Invoice:* ${params.invoiceNumber}\n` +
    `🏟️ *Fasilitas:* ${params.facilityName}\n` +
    `📅 *Tanggal:* ${params.bookingDate}\n` +
    `⏰ *Jam:* ${params.startTime} – ${params.endTime}\n` +
    `💰 *Total:* Rp ${fmt(params.grandTotal)}\n\n` +
    `📄 *Download Invoice PDF:*\n${params.pdfUrl}\n\n` +
    `Terima kasih telah memilih Sport Center Soekarno-Hatta! 🙏`;

  const resp = await fetch("https://api.fonnte.com/send", {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ target: phone, message }),
  });

  const body = await resp.json().catch(() => ({}));
  if (!resp.ok || (body as any).status === false) {
    logger.error({ phone, response: body }, "[InvoiceDelivery] Fonnte gagal kirim WA invoice");
    throw new Error(`Fonnte error: ${JSON.stringify(body)}`);
  }

  logger.info({ phone, invoiceNumber: params.invoiceNumber }, "[InvoiceDelivery] WA invoice terkirim");
}

// ─── sendInvoiceToCustomer — fungsi utama ─────────────────────────────────────

export interface InvoiceDeliveryResult {
  pdfUrl: string;
  emailSent: boolean;
  waSent: boolean;
  errors: string[];
}

export interface AuditContext {
  userId?: number | null;
  userName?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function sendInvoiceToCustomer(
  orderNumber: string,
  audit?: AuditContext,
): Promise<InvoiceDeliveryResult> {
  const errors: string[] = [];
  let emailSent = false;
  let waSent = false;

  // ── 1. Resolve data invoice ──────────────────────────────────────────────
  const data = await resolveInvoiceData(orderNumber);
  if (!data) throw new Error(`Invoice data tidak ditemukan untuk order: ${orderNumber}`);

  // ── 2. Build HTML & Generate PDF ─────────────────────────────────────────
  const html = buildInvoiceHtml(data, { autoPrint: false });
  const safeFilename = `invoice-${orderNumber.replace(/[^a-zA-Z0-9-]/g, "-")}`;

  logger.info({ orderNumber }, "[InvoiceDelivery] Mulai generate dan simpan PDF invoice");
  const pdfUrl = await generateAndStorePdf(html, safeFilename);

  // ── 3. Simpan pdfUrl ke database ─────────────────────────────────────────
  await db
    .update(bookingsTable)
    .set({ invoicePdfUrl: pdfUrl, updatedAt: new Date() })
    .where(eq(bookingsTable.orderNumber, orderNumber));

  await logAudit({
    userId: audit?.userId,
    userName: audit?.userName ?? "system",
    action: "INVOICE_PDF_GENERATED",
    entity: "booking",
    after: { orderNumber, invoiceNumber: data.invoiceNumber, pdfUrl },
    ipAddress: audit?.ipAddress,
    userAgent: audit?.userAgent,
  });

  // ── 4. Generate PDF buffer (untuk lampiran email) ─────────────────────────
  // PDF sudah dibuat di generateAndStorePdf — re-generate buffer untuk attachment email
  // (agar tidak perlu fetch ulang dari storage)
  let pdfBuffer: Buffer | null = null;
  try {
    const { generatePdfBuffer } = await import("./pdfGenerator");
    pdfBuffer = await generatePdfBuffer(html);
  } catch (err) {
    logger.warn({ err }, "[InvoiceDelivery] Gagal buat buffer PDF untuk email — kirim tanpa lampiran");
    errors.push(`Buffer PDF gagal: ${(err as Error).message}`);
  }

  // URL publik untuk customer (link di WA / tombol di email)
  const appUrl = await getBaseUrl();
  const publicPdfLink = `${appUrl}/api/public/invoices/${orderNumber}/pdf`;

  // ── 5. Kirim Email ────────────────────────────────────────────────────────
  try {
    await sendInvoicePdfEmail({
      toEmail: data.customerEmail,
      customerName: data.customerName,
      invoiceNumber: data.invoiceNumber,
      facilityName: data.facilityName,
      grandTotal: data.grandTotal,
      pdfBuffer: pdfBuffer ?? Buffer.alloc(0),
      pdfUrl: publicPdfLink,
      orderNumber,
    });
    emailSent = true;
    await logAudit({
      userId: audit?.userId,
      userName: audit?.userName ?? "system",
      action: "INVOICE_PDF_SENT_EMAIL",
      entity: "booking",
      after: { orderNumber, invoiceNumber: data.invoiceNumber, to: data.customerEmail },
      ipAddress: audit?.ipAddress,
      userAgent: audit?.userAgent,
    });
  } catch (err) {
    const msg = `Email gagal: ${(err as Error).message}`;
    errors.push(msg);
    logger.error({ err, orderNumber }, "[InvoiceDelivery] Gagal kirim email invoice");
  }

  // ── 6. Kirim WhatsApp ─────────────────────────────────────────────────────
  try {
    await sendInvoicePdfWA({
      customerPhone: data.customerPhone,
      customerName: data.customerName,
      invoiceNumber: data.invoiceNumber,
      facilityName: data.facilityName,
      bookingDate: data.bookingDate,
      startTime: data.startTime,
      endTime: data.endTime,
      grandTotal: data.grandTotal,
      pdfUrl: publicPdfLink,
      orderNumber,
    });
    waSent = true;
    await logAudit({
      userId: audit?.userId,
      userName: audit?.userName ?? "system",
      action: "INVOICE_PDF_SENT_WA",
      entity: "booking",
      after: { orderNumber, invoiceNumber: data.invoiceNumber, phone: data.customerPhone },
      ipAddress: audit?.ipAddress,
      userAgent: audit?.userAgent,
    });
  } catch (err) {
    const msg = `WA gagal: ${(err as Error).message}`;
    errors.push(msg);
    logger.error({ err, orderNumber }, "[InvoiceDelivery] Gagal kirim WA invoice");
  }

  logger.info({ orderNumber, pdfUrl, emailSent, waSent, errors }, "[InvoiceDelivery] Selesai");
  return { pdfUrl, emailSent, waSent, errors };
}
