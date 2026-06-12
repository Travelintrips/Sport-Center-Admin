import { Router } from "express";
import { db, usersTable, bookingsTable, companyInvoicesTable, companyInvoiceItemsTable, facilitiesTable, auditLogsTable } from "@workspace/db";
import { eq, and, gte, lt } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { logAudit, getClientInfo, getUserFromReq } from "../lib/auditLog";

const router = Router();

function formatInvoiceNumber(id: number, periodMonth: string) {
  const clean = periodMonth.replace("-", "");
  return `INV-${clean}-${String(id).padStart(4, "0")}`;
}

function periodDateRange(periodMonth: string) {
  const [year, month] = periodMonth.split("-").map(Number);
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return { startDate, endDate };
}

function mapInvoice(
  inv: typeof companyInvoicesTable.$inferSelect,
  companyName?: string,
  items?: any[],
  company?: typeof usersTable.$inferSelect | null,
) {
  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    companyCustomerId: inv.companyCustomerId,
    companyName: companyName ?? "",
    picName: company?.picName ?? null,
    picPhone: company?.picPhone ?? null,
    picEmail: company?.picEmail ?? null,
    billingAddress: company?.billingAddress ?? null,
    periodMonth: inv.periodMonth,
    totalAmount: Number(inv.totalAmount),
    ppnAmount: Number(inv.ppnAmount),
    grandTotal: Number(inv.grandTotal),
    status: inv.status,
    paidAt: inv.paidAt ?? null,
    notes: inv.notes ?? null,
    createdAt: inv.createdAt,
    items: (items ?? []).map((item: any) => ({
      id: item.id,
      invoiceId: item.invoiceId,
      bookingId: item.bookingId,
      orderNumber: item.orderNumber,
      bookingDate: item.bookingDate,
      facilityName: item.facilityName,
      customerName: item.customerName,
      customerPhone: item.customerPhone,
      startTime: item.startTime,
      endTime: item.endTime,
      durationHours: Number(item.durationHours ?? 0),
      pricePerHour: Number(item.pricePerHour ?? 0),
      subtotal: Number(item.subtotal ?? 0),
      taxAmount: Number(item.taxAmount ?? 0),
      totalAmount: Number(item.totalAmount ?? 0),
    })),
  };
}

async function buildAndInsertItems(invoiceId: number, companyId: number, bookings: any[], facilityMap: Record<number, string>) {
  const items = bookings.map((b) => ({
    invoiceId,
    bookingId: b.id,
    companyId,
    bookingDate: b.bookingDate ?? null,
    facilityName: facilityMap[b.facilityId] ?? "",
    customerName: b.customerName ?? null,
    customerPhone: b.customerPhone ?? null,
    startTime: b.startTime ?? null,
    endTime: b.endTime ?? null,
    durationHours: String(b.durationHours ?? 0),
    pricePerHour: String(b.pricePerHour ?? 0),
    subtotal: String(Number(b.totalPrice ?? 0)),
    taxAmount: String(Number(b.ppnAmount ?? 0)),
    totalAmount: String(Number(b.grandTotal ?? b.totalPrice ?? 0)),
    orderNumber: b.orderNumber ?? null,
  }));
  if (items.length > 0) {
    await db.insert(companyInvoiceItemsTable).values(items);
  }
}

router.get("/company-invoices", adminMiddleware, async (req, res) => {
  try {
    const { companyCustomerId, status } = req.query;
    let invoices = await db.select().from(companyInvoicesTable);

    if (companyCustomerId) {
      invoices = invoices.filter((i) => i.companyCustomerId === parseInt(String(companyCustomerId)));
    }
    if (status) {
      invoices = invoices.filter((i) => i.status === status);
    }

    const companies = await db.select({ id: usersTable.id, name: usersTable.name, companyName: usersTable.companyName }).from(usersTable);
    const companyMap = Object.fromEntries(companies.map((c) => [c.id, c.companyName ?? c.name]));

    const result = invoices.map((inv) => mapInvoice(inv, companyMap[inv.companyCustomerId]));
    res.json(result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
  } catch (err) {
    req.log.error({ err }, "List company invoices error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/company-invoices/preview", adminMiddleware, async (req, res) => {
  try {
    const { companyCustomerId, periodMonth } = req.query;
    if (!companyCustomerId || !periodMonth) {
      res.status(400).json({ error: "companyCustomerId dan periodMonth wajib diisi" });
      return;
    }
    const compId = parseInt(String(companyCustomerId));
    const [company] = await db.select().from(usersTable).where(eq(usersTable.id, compId)).limit(1);
    if (!company || company.accountType !== "company") {
      res.status(404).json({ error: "Company customer tidak ditemukan" });
      return;
    }

    const { startDate, endDate } = periodDateRange(String(periodMonth));

    const unbilledBookings = await db.select().from(bookingsTable).where(
      and(
        eq(bookingsTable.companyCustomerId, compId),
        eq(bookingsTable.billingStatus, "unbilled"),
        gte(bookingsTable.bookingDate, startDate),
        lt(bookingsTable.bookingDate, endDate),
      )
    );

    const facilities = await db.select({ id: facilitiesTable.id, name: facilitiesTable.name }).from(facilitiesTable);
    const facilityMap = Object.fromEntries(facilities.map((f) => [f.id, f.name]));

    const bookingList = unbilledBookings.map((b) => ({
      id: b.id,
      orderNumber: b.orderNumber,
      facilityName: facilityMap[b.facilityId] ?? "",
      bookingDate: b.bookingDate,
      startTime: b.startTime,
      endTime: b.endTime,
      durationHours: b.durationHours,
      customerName: b.customerName,
      customerPhone: b.customerPhone,
      pricePerHour: Number(b.pricePerHour ?? 0),
      totalPrice: Number(b.totalPrice ?? 0),
      ppnAmount: b.ppnAmount == null ? null : Number(b.ppnAmount),
      grandTotal: b.grandTotal == null ? null : Number(b.grandTotal),
    }));

    const subtotal = bookingList.reduce((s, b) => s + b.totalPrice, 0);
    const ppnAmount = bookingList.reduce((s, b) => s + (b.ppnAmount ?? 0), 0);
    const grandTotal = subtotal + ppnAmount;

    // Check if invoice already exists for this company + period
    const [existingInvoice] = await db.select().from(companyInvoicesTable).where(
      and(
        eq(companyInvoicesTable.companyCustomerId, compId),
        eq(companyInvoicesTable.periodMonth, String(periodMonth))
      )
    ).limit(1);

    res.json({
      companyName: company.companyName ?? company.name,
      picName: company.picName,
      periodMonth: String(periodMonth),
      bookingCount: bookingList.length,
      subtotal,
      ppnAmount,
      grandTotal,
      bookings: bookingList,
      existingInvoice: existingInvoice ? {
        id: existingInvoice.id,
        invoiceNumber: existingInvoice.invoiceNumber,
        status: existingInvoice.status,
      } : null,
    });
  } catch (err) {
    req.log.error({ err }, "Preview company invoice error");
    res.status(500).json({ error: "Internal server error" });
  }
});

async function handleGenerateInvoice(req: any, res: any) {
  try {
    const { companyCustomerId, periodMonth, notes } = req.body;
    if (!companyCustomerId || !periodMonth) {
      res.status(400).json({ error: "companyCustomerId dan periodMonth wajib diisi" });
      return;
    }

    const [company] = await db.select().from(usersTable).where(eq(usersTable.id, companyCustomerId)).limit(1);
    if (!company || company.accountType !== "company") {
      res.status(404).json({ error: "Company customer tidak ditemukan" });
      return;
    }

    const { startDate, endDate } = periodDateRange(periodMonth);

    const unbilledBookings = await db.select().from(bookingsTable).where(
      and(
        eq(bookingsTable.companyCustomerId, companyCustomerId),
        eq(bookingsTable.billingStatus, "unbilled"),
        gte(bookingsTable.bookingDate, startDate),
        lt(bookingsTable.bookingDate, endDate),
      )
    );

    const facilities = await db.select({ id: facilitiesTable.id, name: facilitiesTable.name }).from(facilitiesTable);
    const facilityMap = Object.fromEntries(facilities.map((f) => [f.id, f.name]));

    // Check for existing invoice
    const [existingInvoice] = await db.select().from(companyInvoicesTable).where(
      and(
        eq(companyInvoicesTable.companyCustomerId, companyCustomerId),
        eq(companyInvoicesTable.periodMonth, periodMonth)
      )
    ).limit(1);

    const { ipAddress, userAgent } = getClientInfo(req);
    const userInfo = getUserFromReq(req);

    if (existingInvoice) {
      if (existingInvoice.status === "paid") {
        res.status(409).json({
          error: `Invoice periode ini sudah ada dan sudah lunas: ${existingInvoice.invoiceNumber}`,
          existingInvoice: {
            id: existingInvoice.id,
            invoiceNumber: existingInvoice.invoiceNumber,
            status: existingInvoice.status,
          },
        });
        return;
      }

      // Invoice exists and unpaid — add new unbilled bookings to it
      if (unbilledBookings.length === 0) {
        res.status(409).json({
          error: `Invoice periode ini sudah ada: ${existingInvoice.invoiceNumber}. Tidak ada booking baru untuk ditambahkan.`,
          existingInvoice: {
            id: existingInvoice.id,
            invoiceNumber: existingInvoice.invoiceNumber,
            status: existingInvoice.status,
          },
        });
        return;
      }

      // Add new bookings as items and recalculate totals
      await buildAndInsertItems(existingInvoice.id, companyCustomerId, unbilledBookings, facilityMap);

      // Get all items to recalculate totals
      const allItems = await db.select().from(companyInvoiceItemsTable).where(
        eq(companyInvoiceItemsTable.invoiceId, existingInvoice.id)
      );
      const newSubtotal = allItems.reduce((s, i) => s + Number(i.subtotal ?? 0), 0);
      const newPpn = allItems.reduce((s, i) => s + Number(i.taxAmount ?? 0), 0);
      const newGrandTotal = newSubtotal + newPpn;

      const [updated] = await db.update(companyInvoicesTable)
        .set({
          totalAmount: String(newSubtotal),
          ppnAmount: String(newPpn),
          grandTotal: String(newGrandTotal),
          ...(notes ? { notes } : {}),
        })
        .where(eq(companyInvoicesTable.id, existingInvoice.id))
        .returning();

      // Mark new bookings as billed
      for (const b of unbilledBookings) {
        await db.update(bookingsTable)
          .set({ billingStatus: "billed", companyInvoiceId: existingInvoice.id })
          .where(eq(bookingsTable.id, b.id));
      }

      await logAudit({
        ...userInfo,
        action: "COMPANY_INVOICE_ITEM_ADDED",
        entity: "company_invoice",
        entityId: existingInvoice.id,
        after: { addedBookings: unbilledBookings.length, invoiceNumber: existingInvoice.invoiceNumber },
        ipAddress,
        userAgent,
      });

      const updatedItems = await db.select().from(companyInvoiceItemsTable).where(
        eq(companyInvoiceItemsTable.invoiceId, existingInvoice.id)
      );
      return res.status(200).json({
        ...mapInvoice(updated, company.companyName ?? company.name, updatedItems, company),
        message: `${unbilledBookings.length} booking baru ditambahkan ke invoice existing ${existingInvoice.invoiceNumber}`,
      });
    }

    // No existing invoice — create new one
    const totalAmount = unbilledBookings.reduce((sum, b) => sum + Number(b.totalPrice), 0);
    const ppnAmount = unbilledBookings.reduce((sum, b) => sum + Number(b.ppnAmount ?? 0), 0);
    const grandTotal = totalAmount + ppnAmount;

    const [inv] = await db.insert(companyInvoicesTable).values({
      invoiceNumber: "TEMP",
      companyCustomerId,
      periodMonth,
      totalAmount: String(totalAmount),
      ppnAmount: String(ppnAmount),
      grandTotal: String(grandTotal),
      status: "unpaid",
      notes: notes ?? null,
    }).returning();

    const invoiceNumber = formatInvoiceNumber(inv.id, periodMonth);
    const [updated] = await db.update(companyInvoicesTable)
      .set({ invoiceNumber })
      .where(eq(companyInvoicesTable.id, inv.id))
      .returning();

    // Insert line items
    await buildAndInsertItems(inv.id, companyCustomerId, unbilledBookings, facilityMap);

    // Mark bookings as billed
    for (const b of unbilledBookings) {
      await db.update(bookingsTable)
        .set({ billingStatus: "billed", companyInvoiceId: inv.id })
        .where(eq(bookingsTable.id, b.id));
    }

    await logAudit({
      ...userInfo,
      action: "COMPANY_INVOICE_GENERATED",
      entity: "company_invoice",
      entityId: inv.id,
      after: { invoiceNumber, companyId: companyCustomerId, periodMonth, bookingCount: unbilledBookings.length, grandTotal },
      ipAddress,
      userAgent,
    });

    const items = await db.select().from(companyInvoiceItemsTable).where(
      eq(companyInvoiceItemsTable.invoiceId, inv.id)
    );
    res.status(201).json(mapInvoice(updated, company.companyName ?? company.name, items, company));
  } catch (err) {
    req.log.error({ err }, "Generate company invoice error");
    res.status(500).json({ error: "Internal server error" });
  }
}

router.post("/company-invoices/generate", adminMiddleware, handleGenerateInvoice);
router.post("/company-invoices", adminMiddleware, handleGenerateInvoice);

router.get("/company-invoices/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [inv] = await db.select().from(companyInvoicesTable).where(eq(companyInvoicesTable.id, id)).limit(1);
    if (!inv) { res.status(404).json({ error: "Not found" }); return; }

    const [company] = await db.select().from(usersTable).where(eq(usersTable.id, inv.companyCustomerId)).limit(1);

    // Get line items (prefer items table, fallback to bookings)
    let items = await db.select().from(companyInvoiceItemsTable).where(
      eq(companyInvoiceItemsTable.invoiceId, id)
    );

    // Backfill: if no items yet, build from linked bookings
    if (items.length === 0) {
      const relatedBookings = await db.select().from(bookingsTable).where(eq(bookingsTable.companyInvoiceId, id));
      if (relatedBookings.length > 0) {
        const facilities = await db.select({ id: facilitiesTable.id, name: facilitiesTable.name }).from(facilitiesTable);
        const facilityMap = Object.fromEntries(facilities.map((f) => [f.id, f.name]));
        await buildAndInsertItems(id, inv.companyCustomerId, relatedBookings, facilityMap);
        items = await db.select().from(companyInvoiceItemsTable).where(eq(companyInvoiceItemsTable.invoiceId, id));
      }
    }

    res.json(mapInvoice(inv, company?.companyName ?? company?.name, items, company));
  } catch (err) {
    req.log.error({ err }, "Get company invoice error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/company-invoices/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [inv] = await db.select().from(companyInvoicesTable).where(eq(companyInvoicesTable.id, id)).limit(1);
    if (!inv) { res.status(404).json({ error: "Not found" }); return; }

    const { status, notes } = req.body;
    const updates: Partial<typeof companyInvoicesTable.$inferInsert> = {};
    if (status !== undefined) updates.status = status;
    if (notes !== undefined) updates.notes = notes;
    if (status === "paid" && inv.status !== "paid") {
      updates.paidAt = new Date();
    }

    const [updated] = await db.update(companyInvoicesTable).set(updates).where(eq(companyInvoicesTable.id, id)).returning();

    if (status === "paid") {
      await db.update(bookingsTable)
        .set({ billingStatus: "paid", status: "completed" })
        .where(eq(bookingsTable.companyInvoiceId, id));

      const { ipAddress, userAgent } = getClientInfo(req);
      const userInfo = getUserFromReq(req);
      await logAudit({
        ...userInfo,
        action: "COMPANY_INVOICE_PAID",
        entity: "company_invoice",
        entityId: id,
        before: { status: inv.status },
        after: { status: "paid", invoiceNumber: inv.invoiceNumber },
        ipAddress,
        userAgent,
      });
    }

    const [company] = await db.select().from(usersTable).where(eq(usersTable.id, updated.companyCustomerId)).limit(1);
    const items = await db.select().from(companyInvoiceItemsTable).where(eq(companyInvoiceItemsTable.invoiceId, id));
    res.json(mapInvoice(updated, company?.companyName ?? company?.name, items, company));
  } catch (err) {
    req.log.error({ err }, "Update company invoice error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Send WhatsApp to PIC
router.post("/company-invoices/:id/send-wa", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [inv] = await db.select().from(companyInvoicesTable).where(eq(companyInvoicesTable.id, id)).limit(1);
    if (!inv) { res.status(404).json({ error: "Not found" }); return; }

    const [company] = await db.select().from(usersTable).where(eq(usersTable.id, inv.companyCustomerId)).limit(1);
    const picPhone = company?.picPhone;
    if (!picPhone) {
      res.status(400).json({ error: "Nomor WA PIC perusahaan belum diisi" });
      return;
    }

    const [year, month] = inv.periodMonth.split("-").map(Number);
    const periodLabel = new Date(year, month - 1, 1).toLocaleDateString("id-ID", { year: "numeric", month: "long" });

    const message = encodeURIComponent(
      `Halo ${company?.picName ?? company?.companyName ?? ""},\n\n` +
      `Berikut tagihan perusahaan Anda:\n` +
      `• No Invoice: *${inv.invoiceNumber}*\n` +
      `• Periode: *${periodLabel}*\n` +
      `• DPP: Rp ${Number(inv.totalAmount).toLocaleString("id-ID")}\n` +
      `• PPN 11%: Rp ${Number(inv.ppnAmount).toLocaleString("id-ID")}\n` +
      `• *Grand Total: Rp ${Number(inv.grandTotal).toLocaleString("id-ID")}*\n\n` +
      `Mohon segera melakukan pembayaran. Terima kasih.\n\n` +
      `Sport Center Soekarno-Hatta`
    );

    const token = process.env.FONNTE_TOKEN;
    if (token) {
      const phone = picPhone.replace(/^\+/, "").replace(/^0/, "62");
      await fetch("https://api.fonnte.com/send", {
        method: "POST",
        headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify({ target: phone, message: decodeURIComponent(message) }),
      });
    }

    const { ipAddress, userAgent } = getClientInfo(req);
    const userInfo = getUserFromReq(req);
    await logAudit({
      ...userInfo,
      action: "COMPANY_INVOICE_WA_SENT",
      entity: "company_invoice",
      entityId: id,
      after: { invoiceNumber: inv.invoiceNumber, picPhone },
      ipAddress,
      userAgent,
    });

    res.json({ success: true, phone: picPhone, message: `Pesan WA berhasil dikirim ke ${picPhone}` });
  } catch (err) {
    req.log.error({ err }, "Send WA company invoice error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
