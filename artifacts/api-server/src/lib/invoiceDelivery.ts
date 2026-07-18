/**
 * invoiceDelivery.ts
 * Orkestrasi pengiriman invoice PDF ke customer:
 *   1. Puppeteer navigate ke endpoint internal server — identik 100% dengan admin portal
 *   2. Generate PDF buffer (font Inter, gambar, semua CSS ter-render sempurna)
 *   3. Upload ke Supabase storage & simpan URL di bookings.invoicePdfUrl
 *   4. Kirim email dengan lampiran PDF
 *   5. Kirim WA dengan link PDF
 *   6. Catat audit log setiap langkah
 *
 * Dipanggil dari:
 *   - routes/payments.ts  → setelah pembayaran dikonfirmasi admin
 *   - routes/bookings.ts  → setelah admin override status ke confirmed
 *   - routes/invoices.ts  → endpoint manual trigger
 */

import { db, bookingsTable, settingsTable, facilitiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generatePdfBufferFromUrl } from "./pdfGenerator";
import { uploadFile } from "./storage";
import { getInternalPdfToken } from "./internalPdfToken";
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

/** URL internal server (puppeteer akses via localhost — bukan domain publik) */
function getLocalServerUrl(): string {
  const port = process.env.PORT ?? "8080";
  return `http://127.0.0.1:${port}`;
}

// ─── sendInvoicePdfEmail ──────────────────────────────────────────────────────

async function sendInvoicePdfEmail(params: {
  toEmail: string;
  customerName: string;
  invoiceNumber: string;
  facilityName: string;
  grandTotal: number;
  pdfBuffer: Buffer;
  publicPdfLink: string;
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
          <a href="${params.publicPdfLink}"
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

  const mailOptions: any = {
    from: `"Sport Center Soekarno-Hatta" <${smtpFrom}>`,
    to: params.toEmail,
    subject: `Invoice ${params.invoiceNumber} – ${params.facilityName} [Terkonfirmasi]`,
    html: htmlBody,
  };

  if (params.pdfBuffer.length > 0) {
    mailOptions.attachments = [
      {
        filename: `Invoice-${params.invoiceNumber.replace(/\//g, "-")}.pdf`,
        content: params.pdfBuffer,
        contentType: "application/pdf",
      },
    ];
  }

  await transporter.sendMail(mailOptions);
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
  publicPdfLink: string;
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
    `📄 *Download Invoice PDF:*\n${params.publicPdfLink}\n\n` +
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

  // ── 1. Siapkan URL internal server untuk puppeteer ───────────────────────
  const localBase = getLocalServerUrl();
  const internalToken = getInternalPdfToken();
  const internalUrl = `${localBase}/api/invoices/internal/${encodeURIComponent(orderNumber)}/html`;
  const headers = { "x-internal-pdf-token": internalToken };

  // ── 2. Generate PDF buffer via puppeteer → navigate ke URL internal ──────
  // Hasilnya identik 100% dengan tampilan admin portal (font, logo, CSS sama)
  logger.info({ orderNumber, internalUrl }, "[InvoiceDelivery] Generate PDF via URL internal server");
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await generatePdfBufferFromUrl(internalUrl, headers);
  } catch (err) {
    logger.error({ err, orderNumber }, "[InvoiceDelivery] Puppeteer gagal — fallback ke HTML setContent");
    // Fallback: resolve data dari DB dan generate dari HTML string
    const { resolveInvoiceData } = await import("./invoiceResolver");
    const { buildInvoiceHtml } = await import("./invoiceTemplate");
    const { generatePdfBufferFromHtml } = await import("./pdfGenerator");
    const data = await resolveInvoiceData(orderNumber);
    if (!data) throw new Error(`Invoice data tidak ditemukan untuk order: ${orderNumber}`);
    const html = buildInvoiceHtml(data, { autoPrint: false });
    pdfBuffer = await generatePdfBufferFromHtml(html);
  }

  // ── 3. Upload ke storage ─────────────────────────────────────────────────
  const safeFilename = `invoice-${orderNumber.replace(/[^a-zA-Z0-9-]/g, "-")}.pdf`;
  logger.info({ orderNumber, sizeBytes: pdfBuffer.length }, "[InvoiceDelivery] Upload PDF ke storage");
  const pdfStorageUrl = await uploadFile("invoice-pdfs", safeFilename, pdfBuffer, "application/pdf");

  // ── 4. Simpan URL ke database ────────────────────────────────────────────
  await db
    .update(bookingsTable)
    .set({ invoicePdfUrl: pdfStorageUrl, updatedAt: new Date() })
    .where(eq(bookingsTable.orderNumber, orderNumber));

  // URL publik untuk customer — melalui endpoint publik server (bukan Supabase langsung)
  const appBase = await getBaseUrl();
  const publicPdfLink = `${appBase}/api/public/invoices/${orderNumber}/pdf`;

  // Ambil data booking + nama fasilitas untuk email/WA params
  const rows = await db
    .select({
      customerName: bookingsTable.customerName,
      customerPhone: bookingsTable.customerPhone,
      customerEmail: bookingsTable.customerEmail,
      facilityId: bookingsTable.facilityId,
      facilityName: facilitiesTable.name,
      bookingDate: bookingsTable.bookingDate,
      startTime: bookingsTable.startTime,
      endTime: bookingsTable.endTime,
      grandTotal: bookingsTable.grandTotal,
      totalPrice: bookingsTable.totalPrice,
    })
    .from(bookingsTable)
    .leftJoin(facilitiesTable, eq(bookingsTable.facilityId, facilitiesTable.id))
    .where(eq(bookingsTable.orderNumber, orderNumber))
    .limit(1);
  const booking = rows[0];

  // Resolve invoice number for audit/email
  let invoiceNumber = orderNumber;
  let facilityName = "";
  let grandTotal = 0;
  let customerName = "";
  let customerPhone = "";
  let customerEmail = "";
  let bookingDate = "";
  let startTime = "";
  let endTime = "";

  if (booking) {
    customerName = booking.customerName;
    customerPhone = booking.customerPhone;
    customerEmail = booking.customerEmail ?? "";
    facilityName = (booking as any).facilityName ?? "";
    bookingDate = booking.bookingDate;
    startTime = booking.startTime;
    endTime = booking.endTime;
    grandTotal = booking.grandTotal != null ? Number(booking.grandTotal) : Number(booking.totalPrice ?? 0);

    // Build invoice number
    const datePart = bookingDate.replace(/-/g, "").substring(0, 8);
    const seq = orderNumber.replace(/[^0-9]/g, "").slice(-6).padStart(6, "0");
    invoiceNumber = `INV/SC/${datePart}/${seq}`;
  }

  await logAudit({
    userId: audit?.userId,
    userName: audit?.userName ?? "system",
    action: "INVOICE_PDF_GENERATED",
    entity: "booking",
    after: { orderNumber, invoiceNumber, pdfStorageUrl, publicPdfLink },
    ipAddress: audit?.ipAddress,
    userAgent: audit?.userAgent,
  });

  // ── 5. Kirim Email ────────────────────────────────────────────────────────
  try {
    await sendInvoicePdfEmail({
      toEmail: customerEmail,
      customerName,
      invoiceNumber,
      facilityName,
      grandTotal,
      pdfBuffer,
      publicPdfLink,
      orderNumber,
    });
    emailSent = true;
    await logAudit({
      userId: audit?.userId,
      userName: audit?.userName ?? "system",
      action: "INVOICE_PDF_SENT_EMAIL",
      entity: "booking",
      after: { orderNumber, invoiceNumber, to: customerEmail },
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
      customerPhone,
      customerName,
      invoiceNumber,
      facilityName,
      bookingDate,
      startTime,
      endTime,
      grandTotal,
      publicPdfLink,
      orderNumber,
    });
    waSent = true;
    await logAudit({
      userId: audit?.userId,
      userName: audit?.userName ?? "system",
      action: "INVOICE_PDF_SENT_WA",
      entity: "booking",
      after: { orderNumber, invoiceNumber, phone: customerPhone },
      ipAddress: audit?.ipAddress,
      userAgent: audit?.userAgent,
    });
  } catch (err) {
    const msg = `WA gagal: ${(err as Error).message}`;
    errors.push(msg);
    logger.error({ err, orderNumber }, "[InvoiceDelivery] Gagal kirim WA invoice");
  }

  logger.info({ orderNumber, pdfStorageUrl, emailSent, waSent, errors }, "[InvoiceDelivery] Selesai");
  return { pdfUrl: pdfStorageUrl, emailSent, waSent, errors };
}
