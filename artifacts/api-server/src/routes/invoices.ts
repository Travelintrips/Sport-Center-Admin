import { Router } from "express";
import { db, bookingsTable, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { logAudit, getClientInfo, getUserFromReq } from "../lib/auditLog";
import { buildInvoiceHtml } from "../lib/invoiceTemplate";
import { resolveInvoiceData, resolveGroupInvoiceData } from "../lib/invoiceResolver";
import { sendInvoiceToCustomer, sendGroupInvoiceToCustomer } from "../lib/invoiceDelivery";
import { getInternalPdfToken } from "../lib/internalPdfToken";
import { logger } from "../lib/logger";

// ─── Internal PDF middleware ───────────────────────────────────────────────────
// Digunakan oleh endpoint yang di-akses puppeteer saat generate PDF.
// Token di-derive dari SESSION_SECRET — tidak perlu auth admin.

function internalPdfMiddleware(req: any, res: any, next: any) {
  const token = req.headers["x-internal-pdf-token"];
  if (token && token === getInternalPdfToken()) return next();
  res.status(401).json({ error: "Unauthorized" });
}

const router = Router();

function redirectToStoredInvoice(res: any, rawUrl: string): void {
  const value = String(rawUrl).trim();
  if (value.startsWith("/") && !value.startsWith("//")) {
    res.redirect(302, value);
    return;
  }

  try {
    const parsed = new URL(value);
    const appHost = process.env.APP_URL ? new URL(process.env.APP_URL).hostname : null;
    const isSupabaseStorage = parsed.protocol === "https:" && parsed.hostname.endsWith(".supabase.co");
    const isConfiguredAppHost = appHost !== null && parsed.protocol === "https:" && parsed.hostname === appHost;
    if (isSupabaseStorage || isConfiguredAppHost) {
      res.redirect(302, parsed.toString());
      return;
    }
  } catch {
    // Fall through to the safe client error below.
  }

  res.status(400).json({ error: "URL invoice tidak valid" });
}

// ─── GET /invoices/internal/:orderNumber/html — puppeteer endpoint (no admin auth) ──
// Di-akses puppeteer dari localhost saat generate PDF.
// Dilindungi X-Internal-Pdf-Token header — bukan untuk akses publik.

router.get("/invoices/internal/:orderNumber/html", internalPdfMiddleware, async (req, res) => {
  try {
    const orderNumber = String(req.params.orderNumber);
    const data = await resolveInvoiceData(orderNumber);
    if (!data) { res.status(404).send("<h2>Invoice tidak ditemukan</h2>"); return; }
    const html = buildInvoiceHtml(data, { autoPrint: false });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(html);
  } catch (err) {
    logger.error({ err }, "Internal invoice HTML error");
    res.status(500).send("<h2>Terjadi kesalahan</h2>");
  }
});

// ─── GET /invoices/internal/group/:groupRef/html — grup invoice puppeteer endpoint ──

router.get("/invoices/internal/group/:groupRef/html", internalPdfMiddleware, async (req, res) => {
  try {
    const groupRef = String(req.params.groupRef);
    const data = await resolveGroupInvoiceData(groupRef);
    if (!data) { res.status(404).send("<h2>Grup booking tidak ditemukan</h2>"); return; }
    const html = buildInvoiceHtml(data, { autoPrint: false });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(html);
  } catch (err) {
    logger.error({ err }, "Internal group invoice HTML error");
    res.status(500).send("<h2>Terjadi kesalahan</h2>");
  }
});

// ─── GET /invoices/booking/:orderNumber (JSON) ────────────────────────────────

router.get("/invoices/booking/:orderNumber", adminMiddleware, async (req, res) => {
  try {
    const orderNumber = String(req.params.orderNumber);
    const data = await resolveInvoiceData(orderNumber);
    if (!data) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }

    const { ipAddress, userAgent } = getClientInfo(req);
    const userInfo = getUserFromReq(req);
    await logAudit({
      ...userInfo,
      action: "INVOICE_TEMPLATE_RENDERED",
      entity: "booking",
      after: { orderNumber, invoiceNumber: data.invoiceNumber, template: "invoice_template_sport_center_v1" },
      ipAddress,
      userAgent,
    });

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Get invoice data error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /invoices/booking/:orderNumber/html ──────────────────────────────────

router.get("/invoices/booking/:orderNumber/html", adminMiddleware, async (req, res) => {
  try {
    const orderNumber = String(req.params.orderNumber);
    const autoPrint = req.query.print === "1";
    const data = await resolveInvoiceData(orderNumber);
    if (!data) { res.status(404).send("<h2>Invoice tidak ditemukan</h2>"); return; }

    const html = buildInvoiceHtml(data, { autoPrint });
    const { ipAddress, userAgent } = getClientInfo(req);
    const userInfo = getUserFromReq(req);
    await logAudit({
      ...userInfo,
      action: "INVOICE_GENERATED_FROM_TEMPLATE",
      entity: "booking",
      after: { orderNumber, invoiceNumber: data.invoiceNumber, template: "invoice_template_sport_center_v1", autoPrint },
      ipAddress,
      userAgent,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    req.log.error({ err }, "Get invoice HTML error");
    res.status(500).send("<h2>Terjadi kesalahan</h2>");
  }
});

// ─── GET /invoices/booking/:orderNumber/pdf (buka print dialog) ───────────────

router.get("/invoices/booking/:orderNumber/pdf", adminMiddleware, async (req, res) => {
  try {
    const orderNumber = String(req.params.orderNumber);
    const data = await resolveInvoiceData(orderNumber);
    if (!data) { res.status(404).send("<h2>Invoice tidak ditemukan</h2>"); return; }

    const html = buildInvoiceHtml(data, { autoPrint: true });
    const { ipAddress, userAgent } = getClientInfo(req);
    const userInfo = getUserFromReq(req);
    await logAudit({
      ...userInfo,
      action: "INVOICE_PDF_CREATED",
      entity: "booking",
      after: { orderNumber, invoiceNumber: data.invoiceNumber, template: "invoice_template_sport_center_v1" },
      ipAddress,
      userAgent,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    req.log.error({ err }, "Get invoice PDF error");
    res.status(500).send("<h2>Terjadi kesalahan</h2>");
  }
});

// ─── POST /invoices/booking/:orderNumber/generate-pdf — generate & simpan PDF ─
// Memicu generate PDF server-side, upload ke storage, kirim ke customer via
// email & WA. Bisa dipanggil manual dari admin atau otomatis setelah pembayaran.

router.post("/invoices/booking/:orderNumber/generate-pdf", adminMiddleware, async (req, res) => {
  try {
    const orderNumber = String(req.params.orderNumber);

    // Validasi booking ada dan statusnya confirmed
    const [booking] = await db
      .select({ status: bookingsTable.status, orderNumber: bookingsTable.orderNumber, groupRef: bookingsTable.groupRef })
      .from(bookingsTable)
      .where(eq(bookingsTable.orderNumber, orderNumber))
      .limit(1);
    if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }

    const { ipAddress, userAgent } = getClientInfo(req);
    const userInfo = getUserFromReq(req);
    const audit = { userId: userInfo.userId, userName: userInfo.userName, ipAddress, userAgent };

    // Jika booking bagian dari grup, generate & kirim invoice gabungan
    const result = booking.groupRef
      ? await sendGroupInvoiceToCustomer(booking.groupRef, audit)
      : await sendInvoiceToCustomer(orderNumber, audit);

    res.json({
      success: true,
      orderNumber,
      groupRef: booking.groupRef ?? undefined,
      pdfUrl: result.pdfUrl,
      emailSent: result.emailSent,
      waSent: result.waSent,
      errors: result.errors,
    });
  } catch (err) {
    logger.error({ err }, "Generate PDF invoice error");
    res.status(500).json({ error: String((err as Error).message) });
  }
});

// ─── GET /public/invoices/:orderNumber/pdf — akses publik PDF invoice ─────────
// Tidak memerlukan auth — digunakan dari link WA / email ke customer.
// Mengembalikan redirect ke URL PDF yang tersimpan, atau 404 jika belum ada.

router.get("/public/invoices/:orderNumber/pdf", async (req, res) => {
  try {
    const orderNumber = String(req.params.orderNumber);
    const [booking] = await db
      .select({ invoicePdfUrl: bookingsTable.invoicePdfUrl, status: bookingsTable.status })
      .from(bookingsTable)
      .where(eq(bookingsTable.orderNumber, orderNumber))
      .limit(1);

    if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }

    if (booking.invoicePdfUrl) {
      // Jika URL sudah ada di storage: redirect ke URL tersebut
      redirectToStoredInvoice(res, booking.invoicePdfUrl);
      return;
    }

    // PDF belum pernah di-generate — generate on-demand (tanpa audit user)
    if (!["confirmed", "completed"].includes(booking.status)) {
      res.status(403).json({ error: "Invoice hanya tersedia setelah booking dikonfirmasi" });
      return;
    }

    logger.info({ orderNumber }, "[InvoiceDelivery] PDF belum ada, generate on-demand");
    const result = await sendInvoiceToCustomer(orderNumber, { userName: "system-on-demand" });

    redirectToStoredInvoice(res, result.pdfUrl);
  } catch (err) {
    logger.error({ err }, "Public invoice PDF error");
    res.status(500).json({ error: "Gagal mengambil invoice PDF" });
  }
});

// ─── GET /public/invoices/group/:groupRef/pdf — akses publik PDF invoice gabungan ─
// Tidak memerlukan auth — digunakan dari link WA / email ke customer.
// Mengembalikan redirect ke URL PDF yang tersimpan, atau generate on-demand.

router.get("/public/invoices/group/:groupRef/pdf", async (req, res) => {
  try {
    const groupRef = String(req.params.groupRef);

    // Ambil salah satu booking dari grup (semua booking dalam grup berbagi invoicePdfUrl yang sama)
    const [booking] = await db
      .select({ invoicePdfUrl: bookingsTable.invoicePdfUrl, status: bookingsTable.status })
      .from(bookingsTable)
      .where(eq(bookingsTable.groupRef, groupRef))
      .limit(1);

    if (!booking) { res.status(404).json({ error: "Grup booking tidak ditemukan" }); return; }

    if (booking.invoicePdfUrl) {
      redirectToStoredInvoice(res, booking.invoicePdfUrl);
      return;
    }

    // PDF belum pernah di-generate — generate on-demand (tanpa audit user)
    if (!["confirmed", "completed"].includes(booking.status)) {
      res.status(403).json({ error: "Invoice hanya tersedia setelah booking dikonfirmasi" });
      return;
    }

    logger.info({ groupRef }, "[InvoiceDelivery] PDF grup belum ada, generate on-demand");
    const result = await sendGroupInvoiceToCustomer(groupRef, { userName: "system-on-demand" });
    redirectToStoredInvoice(res, result.pdfUrl);
  } catch (err) {
    logger.error({ err }, "Public group invoice PDF error");
    res.status(500).json({ error: "Gagal mengambil invoice PDF gabungan" });
  }
});

// ─── GET /invoices/group/:groupRef (JSON) ────────────────────────────────────

router.get("/invoices/group/:groupRef", adminMiddleware, async (req, res) => {
  try {
    const groupRef = String(req.params.groupRef);
    const data = await resolveGroupInvoiceData(groupRef);
    if (!data) { res.status(404).json({ error: "Grup booking tidak ditemukan" }); return; }
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Get group invoice data error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /invoices/group/:groupRef/html ──────────────────────────────────────

router.get("/invoices/group/:groupRef/html", adminMiddleware, async (req, res) => {
  try {
    const groupRef = String(req.params.groupRef);
    const autoPrint = req.query.print === "1";
    const data = await resolveGroupInvoiceData(groupRef);
    if (!data) { res.status(404).send("<h2>Grup booking tidak ditemukan</h2>"); return; }
    const html = buildInvoiceHtml(data, { autoPrint });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    req.log.error({ err }, "Get group invoice HTML error");
    res.status(500).send("<h2>Terjadi kesalahan</h2>");
  }
});

// ─── GET /invoices/group/:groupRef/pdf ───────────────────────────────────────

router.get("/invoices/group/:groupRef/pdf", adminMiddleware, async (req, res) => {
  try {
    const groupRef = String(req.params.groupRef);
    const data = await resolveGroupInvoiceData(groupRef);
    if (!data) { res.status(404).send("<h2>Grup booking tidak ditemukan</h2>"); return; }
    const html = buildInvoiceHtml(data, { autoPrint: true });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    req.log.error({ err }, "Get group invoice PDF error");
    res.status(500).send("<h2>Terjadi kesalahan</h2>");
  }
});

// ─── POST /invoices/booking/:orderNumber/send-wa ──────────────────────────────

router.post("/invoices/booking/:orderNumber/send-wa", adminMiddleware, async (req, res) => {
  try {
    const orderNumber = String(req.params.orderNumber);
    const { customMessage } = req.body ?? {};

    const data = await resolveInvoiceData(orderNumber);
    if (!data) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }

    // Jika booking bagian dari grup, ambil data grup untuk pesan yang lebih lengkap
    const isGroup = !!data.groupRef;
    const groupData = isGroup ? await resolveGroupInvoiceData(data.groupRef!) : null;
    const invoiceData = groupData ?? data;

    // Optional override: admin dapat kirim ke nomor WA berbeda (misal untuk test)
    const overridePhone = (req.body?.overridePhone as string | undefined)?.trim() || undefined;
    const rawPhone = overridePhone || invoiceData.customerPhone;
    const phone = rawPhone.replace(/^\+/, "").replace(/^0/, "62");
    const appUrl =
      process.env.APP_URL ??
      `https://${process.env.REPLIT_DEV_DOMAIN ?? "localhost:5000"}`;

    // Gunakan link PDF grup jika ada groupRef, atau link booking tunggal
    const pdfLink = isGroup
      ? `${appUrl}/api/public/invoices/group/${data.groupRef}/pdf`
      : `${appUrl}/api/public/invoices/${orderNumber}/pdf`;

    const message =
      customMessage ||
      (isGroup && groupData?.sessions?.length
        ? `✅ *Pembayaran Dikonfirmasi!*\n\n` +
          `Halo *${invoiceData.customerName}*,\n\n` +
          `Invoice gabungan booking Anda (${groupData.sessions.length} sesi) sudah siap:\n\n` +
          groupData.sessions.map((s, i) =>
            `${i + 1}. 🏟️ ${s.facilityName} — ${s.bookingDate} ${s.startTime}–${s.endTime}`
          ).join("\n") +
          `\n\n✅ *Total Keseluruhan:* Rp ${new Intl.NumberFormat("id-ID").format(invoiceData.grandTotal)}\n\n` +
          `📄 *Download Invoice PDF Gabungan:*\n${pdfLink}\n\n` +
          `Terima kasih telah memilih Sport Center Soekarno-Hatta! 🙏`
        : `✅ *Pembayaran Dikonfirmasi!*\n\n` +
          `Halo *${invoiceData.customerName}*,\n\n` +
          `Invoice booking Anda sudah siap:\n\n` +
          `🏟️ *Fasilitas:* ${invoiceData.facilityName}\n` +
          `📅 *Tanggal:* ${invoiceData.bookingDate}\n` +
          `⏰ *Jam:* ${invoiceData.startTime} – ${invoiceData.endTime}\n` +
          `⏱️ *Durasi:* ${invoiceData.durationHours} jam\n\n` +
          `✅ *Total:* Rp ${new Intl.NumberFormat("id-ID").format(invoiceData.grandTotal)}\n\n` +
          `📄 *Download Invoice PDF:*\n${pdfLink}\n\n` +
          `Terima kasih telah memilih Sport Center Soekarno-Hatta! 🙏`
      );

    const token =
      req.body?.fonnteToken ??
      (await db.select().from(settingsTable).limit(1).then(([s]) => s?.fonnteToken ?? null)) ??
      process.env.FONNTE_TOKEN;

    if (!token) { res.status(400).json({ error: "FONNTE_TOKEN tidak dikonfigurasi" }); return; }

    const resp = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ target: phone, message }),
    });

    const result = await resp.json().catch(() => ({}));
    const { ipAddress, userAgent } = getClientInfo(req);
    const userInfo = getUserFromReq(req);
    await logAudit({
      ...userInfo,
      action: "INVOICE_WA_SENT",
      entity: "booking",
      after: {
        orderNumber,
        groupRef: data.groupRef ?? undefined,
        invoiceNumber: invoiceData.invoiceNumber,
        phone: rawPhone,
        fonnteStatus: result,
        ...(overridePhone ? { overridePhone, originalPhone: invoiceData.customerPhone } : {}),
      },
      ipAddress,
      userAgent,
    });

    res.json({
      success: true,
      phone: rawPhone,
      invoiceNumber: invoiceData.invoiceNumber,
      groupRef: data.groupRef ?? undefined,
      fonnteResponse: result,
      ...(overridePhone ? { note: "Dikirim ke override phone, bukan nomor customer asli" } : {}),
    });
  } catch (err) {
    req.log.error({ err }, "Send invoice WA error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /invoices/booking/:orderNumber/send-email ───────────────────────────

router.post("/invoices/booking/:orderNumber/send-email", adminMiddleware, async (req, res) => {
  try {
    const orderNumber = String(req.params.orderNumber);
    const data = await resolveInvoiceData(orderNumber);
    if (!data) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }

    // Jika booking bagian dari grup, gunakan data dan HTML invoice gabungan
    const isGroup = !!data.groupRef;
    const groupData = isGroup ? await resolveGroupInvoiceData(data.groupRef!) : null;
    const invoiceData = groupData ?? data;

    const smtpFrom = process.env.SMTP_FROM?.trim();
    const smtpPass = process.env.SMTP_PASS?.trim();
    if (!smtpFrom || !smtpPass) {
      res.status(400).json({ error: "SMTP belum dikonfigurasi (SMTP_FROM / SMTP_PASS)" });
      return;
    }

    // Optional override: admin dapat kirim ke email berbeda (misal untuk test)
    const overrideTo = (req.body?.overrideTo as string | undefined)?.trim() || undefined;
    const recipientEmail = overrideTo || invoiceData.customerEmail;

    if (!recipientEmail) {
      res.status(400).json({ error: "Email tujuan kosong. Gunakan field 'overrideTo' atau pastikan booking memiliki email customer." });
      return;
    }

    const html = buildInvoiceHtml(invoiceData, { autoPrint: false });
    let nodemailer: any;
    try {
      nodemailer = await import("nodemailer");
    } catch {
      res.status(501).json({ error: "nodemailer tidak tersedia. Install dengan: pnpm add nodemailer" });
      return;
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: smtpFrom, pass: smtpPass },
    });

    const subject = isGroup
      ? `Invoice Gabungan ${invoiceData.invoiceNumber} – ${invoiceData.sessions?.length ?? ""} Sesi`
      : `Invoice ${invoiceData.invoiceNumber} – ${invoiceData.facilityName}`;

    await transporter.sendMail({
      from: `"Sport Center Soekarno-Hatta" <${smtpFrom}>`,
      to: recipientEmail,
      subject,
      html,
    });

    const { ipAddress, userAgent } = getClientInfo(req);
    const userInfo = getUserFromReq(req);
    await logAudit({
      ...userInfo,
      action: "INVOICE_EMAIL_SENT",
      entity: "booking",
      after: {
        orderNumber,
        groupRef: data.groupRef ?? undefined,
        invoiceNumber: invoiceData.invoiceNumber,
        to: recipientEmail,
        ...(overrideTo ? { overrideTo, originalEmail: invoiceData.customerEmail } : {}),
      },
      ipAddress,
      userAgent,
    });

    res.json({
      success: true,
      to: recipientEmail,
      invoiceNumber: invoiceData.invoiceNumber,
      groupRef: data.groupRef ?? undefined,
      ...(overrideTo ? { note: "Dikirim ke override email, bukan email customer asli" } : {}),
    });
  } catch (err) {
    req.log.error({ err }, "Send invoice email error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
