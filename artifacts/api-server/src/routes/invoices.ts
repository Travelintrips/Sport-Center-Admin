import { Router } from "express";
import {
  db,
  bookingsTable,
  bookingGroupsTable,
  facilitiesTable,
  settingsTable,
  taxSettingsTable,
  companyDocumentSettingsTable,
  corporateBookingDocumentationTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import type { InvoiceSession } from "../lib/invoiceTemplate";
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

  // Load both 'invoice' and 'general' in one query; invoice takes priority
  const docRows = await db
    .select()
    .from(companyDocumentSettingsTable)
    .where(inArray(companyDocumentSettingsTable.documentType, ["invoice", "general"]));
  const invoiceDoc = docRows.find(r => r.documentType === "invoice");
  const generalDoc = docRows.find(r => r.documentType === "general");
  // Merge: invoice overrides general, which overrides settings table
  function pick<T>(invoice: T | null | undefined, general: T | null | undefined, fallback: T): T {
    return (invoice !== null && invoice !== undefined && invoice !== "" as unknown as T)
      ? invoice as T
      : (general !== null && general !== undefined && general !== "" as unknown as T)
        ? general as T
        : fallback;
  }

  // Get tax rate from booking or active tax settings
  let ppnRate = booking.ppnRate ? Number(booking.ppnRate) : 0;

  // grandTotal = harga final yang dibayar customer (inclusive PPN)
  const bookingBasePrice = Number(booking.totalPrice ?? 0);
  let grandTotal = booking.grandTotal ? Number(booking.grandTotal) : bookingBasePrice;

  if (!ppnRate) {
    const [taxSetting] = await db
      .select()
      .from(taxSettingsTable)
      .where(
        eq(taxSettingsTable.isActive, true)
      )
      .limit(1);

    ppnRate = taxSetting ? Number(taxSetting.taxRate) : 11;
  }

  // ── DPP Nilai Lain formula — PMK-131/2024 (PPN 12%, berlaku Jan 2025) ───────
  // Harga di DB = inclusive PPN
  // DPP          = grandTotal / (1 + ppnRate/100)      ← ekstrak harga netto
  // DPP Nilai Lain = DPP × (11/12)                     ← dasar pengenaan pajak
  // PPN 12%      = DPP Nilai Lain × 12%                ← PPN terutang
  // TOTAL        = DPP + PPN                            ← ≈ grandTotal, max diff ±1
  let dpp: number;
  let dppNilaiLain: number;
  let ppnAmount: number;

  if (ppnRate > 0) {
    const rate = ppnRate / 100;                              // mis. 0.12 untuk 12%
    dpp = Math.round(grandTotal / (1 + rate));
    dppNilaiLain = Math.round(dpp * 11 / 12);               // dasar pengenaan PMK-131
    ppnAmount = Math.round(dppNilaiLain * 0.12);             // PPN 12% dari DPP Nilai Lain
    // Re-align total agar DPP + PPN selalu konsisten
    grandTotal = dpp + ppnAmount;
  } else {
    dpp = grandTotal;
    dppNilaiLain = 0;
    ppnAmount = 0;
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
    dppNilaiLain,
    ppnRate,
    ppnAmount,
    grandTotal,

    promoCode: booking.promoCode ?? null,
    discountAmount: Number(booking.discountAmount ?? 0),

    centerName: settings?.centerName || "Sport Center Soekarno-Hatta",
    centerAddress: settings?.address || "Kawasan Bandara Soekarno-Hatta, Tangerang 19110",
    centerPhone: settings?.phone || "",
    bankName: pick(invoiceDoc?.bankName, generalDoc?.bankName, settings?.bankName || "Bank Mandiri"),
    bankAccount: pick(invoiceDoc?.bankAccount, generalDoc?.bankAccount, settings?.bankAccount || ""),
    bankAccountName: pick(invoiceDoc?.bankHolder, generalDoc?.bankHolder, settings?.bankAccountName || "Sport Center Soekarno-Hatta"),

    // Dynamic template fields — invoice doc > general doc > settings fallback
    logoUrl: invoiceDoc?.logoUrl ?? generalDoc?.logoUrl ?? (settings as any)?.logoUrl ?? null,
    kopSuratHtml: invoiceDoc?.kopSuratHtml ?? generalDoc?.kopSuratHtml ?? null,
    financeName: pick(invoiceDoc?.financeName, generalDoc?.financeName, ""),
    financeTitle: pick(invoiceDoc?.financeTitle, generalDoc?.financeTitle, "Finance Manager"),
    signatureUrl: invoiceDoc?.signatureUrl ?? generalDoc?.signatureUrl ?? null,
    footerText: invoiceDoc?.footerHtml ?? generalDoc?.footerHtml ?? null,
    invoicePrefix: pick(invoiceDoc?.prefixNumber, generalDoc?.prefixNumber, "INV"),

    // Dokumentasi kegiatan (corporate booking saja)
    documentation: booking.payerType === "company"
      ? await db
          .select({
            fileUrl: corporateBookingDocumentationTable.fileUrl,
            fileName: corporateBookingDocumentationTable.fileName,
            caption: corporateBookingDocumentationTable.caption,
          })
          .from(corporateBookingDocumentationTable)
          .where(eq(corporateBookingDocumentationTable.bookingId, booking.id))
      : undefined,
  };
}

// ─── Group invoice resolver ───────────────────────────────────────────────────

async function resolveGroupInvoiceData(groupRef: string): Promise<InvoiceData | null> {
  const [group] = await db
    .select()
    .from(bookingGroupsTable)
    .where(eq(bookingGroupsTable.groupRef, groupRef))
    .limit(1);
  if (!group) return null;

  // Ambil semua booking dalam grup, urutkan berdasarkan tanggal
  const groupBookings = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.groupRef, groupRef));

  if (!groupBookings.length) return null;

  groupBookings.sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));

  const firstBooking = groupBookings[0]!;

  const [facility] = await db
    .select()
    .from(facilitiesTable)
    .where(eq(facilitiesTable.id, firstBooking.facilityId))
    .limit(1);

  const [settings] = await db.select().from(settingsTable).limit(1);

  const docRows = await db
    .select()
    .from(companyDocumentSettingsTable)
    .where(inArray(companyDocumentSettingsTable.documentType, ["invoice", "general"]));
  const invoiceDoc = docRows.find(r => r.documentType === "invoice");
  const generalDoc = docRows.find(r => r.documentType === "general");

  function pick<T>(invoice: T | null | undefined, general: T | null | undefined, fallback: T): T {
    return (invoice !== null && invoice !== undefined && invoice !== "" as unknown as T)
      ? invoice as T
      : (general !== null && general !== undefined && general !== "" as unknown as T)
        ? general as T
        : fallback;
  }

  // Hitung total dari semua sesi (grandTotal masing-masing sesi)
  const totalGrandTotal = groupBookings.reduce((sum, b) => {
    const gt = b.grandTotal != null ? Number(b.grandTotal) : Number(b.totalPrice);
    return sum + gt;
  }, 0);

  // Tax rate dari booking pertama atau settings
  let ppnRate = firstBooking.ppnRate ? Number(firstBooking.ppnRate) : 0;
  if (!ppnRate) {
    const [taxSetting] = await db
      .select()
      .from(taxSettingsTable)
      .where(eq(taxSettingsTable.isActive, true))
      .limit(1);
    ppnRate = taxSetting ? Number(taxSetting.taxRate) : 11;
  }

  // DPP Nilai Lain formula (PMK-131/2024) pada total grup
  let dpp: number;
  let dppNilaiLain: number;
  let ppnAmount: number;
  let grandTotal = totalGrandTotal;

  if (ppnRate > 0) {
    const rate = ppnRate / 100;
    dpp = Math.round(grandTotal / (1 + rate));
    dppNilaiLain = Math.round(dpp * 11 / 12);
    ppnAmount = Math.round(dppNilaiLain * 0.12);
    grandTotal = dpp + ppnAmount;
  } else {
    dpp = grandTotal;
    dppNilaiLain = 0;
    ppnAmount = 0;
  }

  // Buat sessions array untuk ditampilkan di template
  const facilityNames: Record<number, string> = {};
  const facilityIds = [...new Set(groupBookings.map(b => b.facilityId))];
  if (facilityIds.length > 1) {
    const facilities = await db.select({ id: facilitiesTable.id, name: facilitiesTable.name })
      .from(facilitiesTable)
      .where(inArray(facilitiesTable.id, facilityIds));
    for (const f of facilities) facilityNames[f.id] = f.name;
  } else {
    facilityNames[firstBooking.facilityId] = facility?.name ?? "—";
  }

  const sessions: InvoiceSession[] = groupBookings.map(b => {
    const discountAmt = Number(b.discountAmount ?? 0);
    const grandTotalVal = b.grandTotal != null ? Number(b.grandTotal) : Number(b.totalPrice);
    // basePrice: harga asli sebelum diskon
    const basePriceVal = b.basePrice != null
      ? Number(b.basePrice)
      : (discountAmt > 0 ? Number(b.totalPrice) + discountAmt : grandTotalVal);
    return {
      orderNumber: b.orderNumber,
      facilityName: facilityNames[b.facilityId] ?? facility?.name ?? "—",
      bookingDate: b.bookingDate,
      startTime: b.startTime,
      endTime: b.endTime,
      durationHours: b.durationHours,
      basePrice: basePriceVal,
      grandTotal: grandTotalVal,
      discountAmount: discountAmt,
      status: b.status,
    };
  });

  const totalDiscount = sessions.reduce((sum, s) => sum + (s.discountAmount ?? 0), 0);

  // Nomor invoice grup
  const datePart = firstBooking.bookingDate.replace(/-/g, "").substring(0, 8);
  const groupSeq = groupRef.replace(/[^0-9]/g, "").padStart(6, "0");
  const invoiceNumber = `INV/SC/GRP/${datePart}/${groupSeq}`;

  return {
    invoiceNumber,
    invoiceDate: new Date().toISOString().split("T")[0]!,
    orderNumber: groupRef,
    status: firstBooking.status,

    customerName: firstBooking.customerName,
    customerPhone: firstBooking.customerPhone,
    customerEmail: firstBooking.customerEmail ?? "",

    facilityName: facility?.name ?? "—",
    bookingDate: firstBooking.bookingDate,
    startTime: firstBooking.startTime,
    endTime: firstBooking.endTime,
    durationHours: firstBooking.durationHours,

    pricePerHour: facility ? Number(facility.pricePerHour) : 0,
    dpp,
    dppNilaiLain,
    ppnRate,
    ppnAmount,
    grandTotal,

    promoCode: firstBooking.promoCode ?? null,
    discountAmount: totalDiscount,

    groupRef,
    sessions,

    centerName: settings?.centerName || "Sport Center Soekarno-Hatta",
    centerAddress: settings?.address || "Kawasan Bandara Soekarno-Hatta, Tangerang 19110",
    centerPhone: settings?.phone || "",
    bankName: pick(invoiceDoc?.bankName, generalDoc?.bankName, settings?.bankName || "Bank Mandiri"),
    bankAccount: pick(invoiceDoc?.bankAccount, generalDoc?.bankAccount, settings?.bankAccount || ""),
    bankAccountName: pick(invoiceDoc?.bankHolder, generalDoc?.bankHolder, settings?.bankAccountName || "Sport Center Soekarno-Hatta"),

    logoUrl: invoiceDoc?.logoUrl ?? generalDoc?.logoUrl ?? (settings as any)?.logoUrl ?? null,
    kopSuratHtml: invoiceDoc?.kopSuratHtml ?? generalDoc?.kopSuratHtml ?? null,
    financeName: pick(invoiceDoc?.financeName, generalDoc?.financeName, ""),
    financeTitle: pick(invoiceDoc?.financeTitle, generalDoc?.financeTitle, "Finance Manager"),
    signatureUrl: invoiceDoc?.signatureUrl ?? generalDoc?.signatureUrl ?? null,
    footerText: invoiceDoc?.footerHtml ?? generalDoc?.footerHtml ?? null,
    invoicePrefix: pick(invoiceDoc?.prefixNumber, generalDoc?.prefixNumber, "INV"),
  };
}

// ─── GET /invoices/booking/:orderNumber (JSON) ────────────────────────────────

router.get("/invoices/booking/:orderNumber", adminMiddleware, async (req, res) => {
  try {
    const orderNumber = String(req.params.orderNumber);
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
    const orderNumber = String(req.params.orderNumber);
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
    const orderNumber = String(req.params.orderNumber);

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

// ─── GET /invoices/group/:groupRef (JSON) ────────────────────────────────────

router.get("/invoices/group/:groupRef", adminMiddleware, async (req, res) => {
  try {
    const groupRef = String(req.params.groupRef);
    const data = await resolveGroupInvoiceData(groupRef);
    if (!data) {
      res.status(404).json({ error: "Grup booking tidak ditemukan" });
      return;
    }
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
    if (!data) {
      res.status(404).send("<h2>Grup booking tidak ditemukan</h2>");
      return;
    }

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
    if (!data) {
      res.status(404).send("<h2>Grup booking tidak ditemukan</h2>");
      return;
    }
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
    const orderNumber = String(req.params.orderNumber);

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
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      nodemailer = await import("nodemailer" as string);
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
