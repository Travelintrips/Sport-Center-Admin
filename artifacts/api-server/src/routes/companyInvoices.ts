import { Router } from "express";
import { db, usersTable, bookingsTable, companyInvoicesTable } from "@workspace/db";
import { eq, and, gte, lt } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";

const router = Router();

function formatInvoiceNumber(id: number, periodMonth: string) {
  const clean = periodMonth.replace("-", "");
  return `INV-${clean}-${String(id).padStart(4, "0")}`;
}

function mapInvoice(inv: typeof companyInvoicesTable.$inferSelect, companyName?: string, bookings?: any[]) {
  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    companyCustomerId: inv.companyCustomerId,
    companyName: companyName ?? "",
    periodMonth: inv.periodMonth,
    totalAmount: Number(inv.totalAmount),
    ppnAmount: Number(inv.ppnAmount),
    grandTotal: Number(inv.grandTotal),
    status: inv.status,
    paidAt: inv.paidAt ?? null,
    notes: inv.notes ?? null,
    createdAt: inv.createdAt,
    bookings: bookings ?? [],
  };
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

router.post("/company-invoices", adminMiddleware, async (req, res) => {
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

    // Find bookings for this company in the period
    const [year, month] = periodMonth.split("-").map(Number);
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const endMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;

    const companyBookings = await db.select().from(bookingsTable).where(
      and(
        eq(bookingsTable.companyCustomerId, companyCustomerId),
        eq(bookingsTable.billingStatus, "unbilled"),
        gte(bookingsTable.bookingDate, startDate),
        lt(bookingsTable.bookingDate, endMonth)
      )
    );

    const totalAmount = companyBookings.reduce((sum, b) => sum + Number(b.totalPrice), 0);
    const ppnAmount = Math.round(totalAmount * 0.11);
    const grandTotal = totalAmount + ppnAmount;

    // Insert invoice first to get id
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

    // Update invoice number with real id
    const invoiceNumber = formatInvoiceNumber(inv.id, periodMonth);
    const [updated] = await db.update(companyInvoicesTable)
      .set({ invoiceNumber })
      .where(eq(companyInvoicesTable.id, inv.id))
      .returning();

    // Mark bookings as billed
    if (companyBookings.length > 0) {
      for (const b of companyBookings) {
        await db.update(bookingsTable)
          .set({ billingStatus: "billed" })
          .where(eq(bookingsTable.id, b.id));
      }
    }

    res.status(201).json(mapInvoice(updated, company.companyName ?? company.name, companyBookings));
  } catch (err) {
    req.log.error({ err }, "Generate company invoice error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/company-invoices/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [inv] = await db.select().from(companyInvoicesTable).where(eq(companyInvoicesTable.id, id)).limit(1);
    if (!inv) { res.status(404).json({ error: "Not found" }); return; }

    const [company] = await db.select().from(usersTable).where(eq(usersTable.id, inv.companyCustomerId)).limit(1);
    const relatedBookings = await db.select().from(bookingsTable).where(
      and(
        eq(bookingsTable.companyCustomerId, inv.companyCustomerId),
        gte(bookingsTable.bookingDate, inv.periodMonth + "-01"),
      )
    );

    res.json(mapInvoice(inv, company?.companyName ?? company?.name, relatedBookings));
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

    // If marked paid, update billing status of associated bookings
    if (status === "paid") {
      await db.update(bookingsTable)
        .set({ billingStatus: "paid" })
        .where(
          and(
            eq(bookingsTable.companyCustomerId, inv.companyCustomerId),
            eq(bookingsTable.billingStatus, "billed"),
            gte(bookingsTable.bookingDate, inv.periodMonth + "-01"),
          )
        );
    }

    const [company] = await db.select().from(usersTable).where(eq(usersTable.id, updated.companyCustomerId)).limit(1);
    res.json(mapInvoice(updated, company?.companyName ?? company?.name));
  } catch (err) {
    req.log.error({ err }, "Update company invoice error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
