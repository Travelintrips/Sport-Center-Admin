import { Router } from "express";
import {
  db,
  bookingsTable,
  facilitiesTable,
  settingsTable,
  taxSettingsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { logAudit, getClientInfo, getUserFromReq } from "../lib/auditLog";
import { buildInvoiceHtml, type InvoiceData } from "../lib/invoiceTemplate";

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatInvoiceNumber(orderNumber: string, bookingDate: string): string {
  const datePart = bookingDate.replace(/-/g, "").substring(0, 8);
  const seq = orderNumber.replace(/[^0-9]/g, "").slice(-6).padStart(6, "0");
  return `INV/SC/${datePart}/${seq}`;
}

async function resolveInvoiceData(orderNumber: string): Promise<InvoiceData | null> {
  const [booking] = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.orderNumber, orderNumber))
    .limit(1);

  if (!booking) return null;

  const [facility] = await db
    .select()
    .from(facilitiesTable)
    .where(eq(facilitiesTable.id, booking.facilityId))
    .limit(1);

  const [settings] = await db.select().from(settingsTable).limit(1);

  // Get tax rate from booking or active tax settings
  let ppnRate = booking.ppnRate ? Number(booking.ppnRate) : 0;
  let ppnAmount = booking.ppnAmount ? Number(booking.ppnAmount) : 0;
  const dpp = Number(booking.totalPrice ?? 0);
  let grandTotal = booking.grandTotal ? Number(booking.grandTotal) : dpp + ppnAmount;

  if (!ppnRate) {
    // No PPN stored on booking – use active tax setting (default 12%)
    const [taxSetting] = await db
      .select()
      .from(taxSettingsTable)
      .where(
        and(
          eq(taxSettingsTable.appliesTo, "sport_center_booking"),
          eq(taxSettingsTable.isActive, true),
        ),
      )
      .limit(1);

    ppnRate = taxSetting ? Number(taxSetting.taxRate) : 12;
    ppnAmount = Math.round(dpp * (ppnRate / 100));
    grandTotal = dpp + ppnAmount;
  }

  const invoiceNumber = formatInvoiceNumber(booking.orderNumber, booking.bookingDate);

  return {
    invoiceNumber,
    invoiceDate: new Date().toISOString().split("T")[0],
    orderNumber: booking.orderNumber,
    status: booking.status,

    customerName: booking.customerName,
    customerPhone: booking.customerPhone,
    customerEmail: booking.customerEmail,

    facilityName: facility?.name ?? "—",
    bookingDate: booking.bookingDate,
    startTime: booking.startTime,
    endTime: booking.endTime,
    durationHours: booking.durationHours,

    pricePerHour: facility ? Number(facility.pricePerHour) : 0,
    dpp,
    ppnRate,
    ppnAmount,
    grandTotal,

    promoCode: booking.promoCode ?? null,
    discountAmount: Number(booking.discountAmount ?? 0),

    centerName: settings?.centerName ?? "Sport Center Soekarno-Hatta",
    centerAddress:
      settings?.address || "Kawasan Bandara Soekarno-Hatta, Tangerang 19110",
    centerPhone: settings?.phone ?? "",
    bankName: settings?.bankName ?? "Bank Mandiri",
    bankAccount: settings?.bankAccount ?? "",
    bankAccountName:
      settings?.bankAccountName ?? "Sport Center Soekarno-Hatta",
  };
}

// ─── GET /invoices/booking/:orderNumber (JSON) ────────────────────────────────

router.get("/invoices/booking/:orderNumber", adminMiddleware, async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const data = await resolveInvoiceData(orderNumber);
    if (!data) {
      res.status(404).json({ error: "Booking tidak ditemukan" });
      return;
    }

    const { ipAddress, userAgent } = getClientInfo(req);
    const userInfo = getUserFromReq(req);
    await logAudit({
      ...userInfo,
      action: "INVOICE_TEMPLATE_RENDERED",
      entity: "booking",
      after: {
        orderNumber,
        invoiceNumber: data.invoiceNumber,
        template: "invoice_template_sport_center_v1",
      },
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
// Public-ish: admin auth OR token query param matching orderNumber hmac

router.get("/invoices/booking/:orderNumber/html", adminMiddleware, async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const autoPrint = req.query.print === "1";

    const data = await resolveInvoiceData(orderNumber);
    if (!data) {
      res.status(404).send("<h2>Invoice tidak ditemukan</h2>");
      return;
    }

    const html = buildInvoiceHtml(data, { autoPrint });

    const { ipAddress, userAgent } = getClientInfo(req);
    const userInfo = getUserFromReq(req);
    await logAudit({
      ...userInfo,
      action: "INVOICE_GENERATED_FROM_TEMPLATE",
      entity: "booking",
      after: {
        orderNumber,
        invoiceNumber: data.invoiceNumber,
        template: "invoice_template_sport_center_v1",
        autoPrint,
      },
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

// ─── GET /invoices/booking/:orderNumber/pdf (opens print dialog) ──────────────
// Alias for /html?print=1 — returns same HTML with auto-print injected

router.get("/invoices/booking/:orderNumber/pdf", adminMiddleware, async (req, res) => {
  try {
    const { orderNumber } = req.params;

    const data = await resolveInvoiceData(orderNumber);
    if (!data) {
      res.status(404).send("<h2>Invoice tidak ditemukan</h2>");
      return;
    }

    const html = buildInvoiceHtml(data, { autoPrint: true });

    const { ipAddress, userAgent } = getClientInfo(req);
    const userInfo = getUserFromReq(req);
    await logAudit({
      ...userInfo,
      action: "INVOICE_PDF_CREATED",
      entity: "booking",
      after: {
        orderNumber,
        invoiceNumber: data.invoiceNumber,
        template: "invoice_template_sport_center_v1",
      },
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

// ─── POST /invoices/booking/:orderNumber/send-wa ──────────────────────────────

router.post("/invoices/booking/:orderNumber/send-wa", adminMiddleware, async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const { customMessage } = req.body ?? {};

    const data = await resolveInvoiceData(orderNumber);
    if (!data) {
      res.status(404).json({ error: "Booking tidak ditemukan" });
      return;
    }

    const phone = data.customerPhone.replace(/^\+/, "").replace(/^0/, "62");

    const appUrl =
      process.env.APP_URL ??
      `https://${process.env.REPLIT_DEV_DOMAIN ?? "localhost:5000"}`;

    const invoiceLink = `${appUrl}/admin/invoice/${orderNumber}`;

    const message =
      customMessage ||
      `Halo ${data.customerName},\n\n` +
        `Berikut adalah invoice pemesanan Anda:\n\n` +
        `📋 *No Invoice:* ${data.invoiceNumber}\n` +
        `🏟️ *Fasilitas:* ${data.facilityName}\n` +
        `📅 *Tanggal:* ${data.bookingDate}\n` +
        `⏰ *Jam:* ${data.startTime} – ${data.endTime}\n` +
        `⏱️ *Durasi:* ${data.durationHours} jam\n\n` +
        `💰 *DPP:* Rp ${new Intl.NumberFormat("id-ID").format(data.dpp)}\n` +
        `🧾 *PPN ${data.ppnRate}%:* Rp ${new Intl.NumberFormat("id-ID").format(data.ppnAmount)}\n` +
        `✅ *Total:* Rp ${new Intl.NumberFormat("id-ID").format(data.grandTotal)}\n\n` +
        `🏦 *Pembayaran:*\n` +
        `Bank: ${data.bankName}\n` +
        `No Rek: ${data.bankAccount}\n` +
        `A/N: ${data.bankAccountName}\n\n` +
        `Terima kasih telah memilih Sport Center Soekarno-Hatta. 🙏`;

    const token =
      req.body?.fonnteToken ??
      (await db.select().from(settingsTable).limit(1)
        .then(([s]) => s?.fonnteToken ?? null)) ??
      process.env.FONNTE_TOKEN;

    if (!token) {
      res.status(400).json({ error: "FONNTE_TOKEN tidak dikonfigurasi" });
      return;
    }

    const resp = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
      },
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
        invoiceNumber: data.invoiceNumber,
        phone: data.customerPhone,
        fonnteStatus: result,
      },
      ipAddress,
      userAgent,
    });

    res.json({
      success: true,
      phone: data.customerPhone,
      invoiceNumber: data.invoiceNumber,
      fonnteResponse: result,
    });
  } catch (err) {
    req.log.error({ err }, "Send invoice WA error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /invoices/booking/:orderNumber/send-email ───────────────────────────

router.post("/invoices/booking/:orderNumber/send-email", adminMiddleware, async (req, res) => {
  try {
    const { orderNumber } = req.params;

    const data = await resolveInvoiceData(orderNumber);
    if (!data) {
      res.status(404).json({ error: "Booking tidak ditemukan" });
      return;
    }

    const smtpFrom = process.env.SMTP_FROM?.trim();
    const smtpPass = process.env.SMTP_PASS?.trim();

    if (!smtpFrom || !smtpPass) {
      res.status(400).json({ error: "SMTP belum dikonfigurasi (SMTP_FROM / SMTP_PASS)" });
      return;
    }

    // Build invoice HTML for email
    const html = buildInvoiceHtml(data, { autoPrint: false });

    // Use nodemailer if available, else fail gracefully
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

    await transporter.sendMail({
      from: `"Sport Center Soekarno-Hatta" <${smtpFrom}>`,
      to: data.customerEmail,
      subject: `Invoice ${data.invoiceNumber} – ${data.facilityName}`,
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
        invoiceNumber: data.invoiceNumber,
        to: data.customerEmail,
      },
      ipAddress,
      userAgent,
    });

    res.json({
      success: true,
      to: data.customerEmail,
      invoiceNumber: data.invoiceNumber,
    });
  } catch (err) {
    req.log.error({ err }, "Send invoice email error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
