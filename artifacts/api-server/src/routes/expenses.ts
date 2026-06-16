import { Router } from "express";
import { db, expensesTable, facilitiesTable, usersTable, accountingJournalsTable } from "@workspace/db";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { logAudit, getClientInfo, getUserFromReq } from "../lib/auditLog";

const router = Router();

const EXPENSE_CATEGORIES = [
  "Alat Gym",
  "Bola & Peralatan Olahraga",
  "Perbaikan Lapangan",
  "Maintenance Fasilitas",
  "Listrik & Air",
  "Kebersihan",
  "Gaji / Fee Staff",
  "Sewa / Vendor",
  "Lain-lain",
] as const;

async function generateExpenseNo(): Promise<string> {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const prefix = `EXP-${y}${m}${d}-`;

  const result = await db.execute(sql`SELECT nextval('sport_center.expense_no_seq') as val`);
  const row = (result as any).rows?.[0] ?? (result as any)[0];
  const seq = String(row?.val ?? 1).padStart(6, "0");
  return `${prefix}${seq}`;
}

router.get("/admin/expenses", adminMiddleware, async (req, res) => {
  try {
    const { startDate, endDate, category, status, vendorName, facilityId } = req.query as Record<string, string>;

    const conditions = [];
    if (startDate) conditions.push(gte(expensesTable.expenseDate, startDate));
    if (endDate) conditions.push(lte(expensesTable.expenseDate, endDate));
    if (category) conditions.push(eq(expensesTable.category, category as any));
    if (status) conditions.push(eq(expensesTable.paymentStatus, status as any));
    if (facilityId) conditions.push(eq(expensesTable.facilityId, Number(facilityId)));

    const expenses = await db
      .select()
      .from(expensesTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(expensesTable.createdAt));

    const facilities = await db.select({ id: facilitiesTable.id, name: facilitiesTable.name }).from(facilitiesTable);
    const facilityMap = Object.fromEntries(facilities.map((f) => [f.id, f.name]));

    const filtered = vendorName
      ? expenses.filter((e) => e.vendorName?.toLowerCase().includes((vendorName as string).toLowerCase()))
      : expenses;

    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const summary = {
      totalThisMonth: filtered
        .filter((e) => e.expenseDate.startsWith(thisMonth) && !["cancelled", "rejected"].includes(e.paymentStatus))
        .reduce((s, e) => s + Number(e.totalAmount), 0),
      pendingApproval: filtered.filter((e) => e.paymentStatus === "pending_approval").length,
      paid: filtered
        .filter((e) => e.paymentStatus === "paid")
        .reduce((s, e) => s + Number(e.totalAmount), 0),
      unpaid: filtered
        .filter((e) => ["approved"].includes(e.paymentStatus))
        .reduce((s, e) => s + Number(e.totalAmount), 0),
    };

    res.json({
      expenses: filtered.map((e) => ({
        ...e,
        amount: Number(e.amount),
        ppnAmount: Number(e.ppnAmount),
        totalAmount: Number(e.totalAmount),
        facilityName: e.facilityId ? facilityMap[e.facilityId] ?? null : null,
      })),
      summary,
      categories: EXPENSE_CATEGORIES,
    });
  } catch (err) {
    req.log.error({ err }, "List expenses error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/expenses/:id", adminMiddleware, async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    const [expense] = await db.select().from(expensesTable).where(eq(expensesTable.id, id)).limit(1);
    if (!expense) {
      res.status(404).json({ error: "Expense not found" });
      return;
    }

    const facilities = await db.select({ id: facilitiesTable.id, name: facilitiesTable.name }).from(facilitiesTable);
    const facilityMap = Object.fromEntries(facilities.map((f) => [f.id, f.name]));

    let createdByName: string | null = null;
    let approvedByName: string | null = null;
    if (expense.createdBy) {
      const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, expense.createdBy)).limit(1);
      createdByName = u?.name ?? null;
    }
    if (expense.approvedBy) {
      const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, expense.approvedBy)).limit(1);
      approvedByName = u?.name ?? null;
    }

    res.json({
      ...expense,
      amount: Number(expense.amount),
      ppnAmount: Number(expense.ppnAmount),
      totalAmount: Number(expense.totalAmount),
      facilityName: expense.facilityId ? facilityMap[expense.facilityId] ?? null : null,
      createdByName,
      approvedByName,
    });
  } catch (err) {
    req.log.error({ err }, "Get expense error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/expenses", adminMiddleware, async (req, res) => {
  try {
    const user = getUserFromReq(req);
    const { ipAddress, userAgent } = getClientInfo(req);
    const {
      expenseDate, category, description, vendorName, facilityId,
      amount, ppnAmount = 0, paymentMethod, paymentAccount, receiptUrl, notes,
    } = req.body;

    if (!expenseDate || !category || !description || !amount) {
      res.status(400).json({ error: "expenseDate, category, description, amount wajib diisi" });
      return;
    }

    const amountNum = Number(amount);
    const ppnNum = Number(ppnAmount);
    const totalNum = amountNum + ppnNum;

    const expenseNo = await generateExpenseNo();

    const [expense] = await db.insert(expensesTable).values({
      expenseNo,
      expenseDate,
      category,
      description,
      vendorName: vendorName || null,
      facilityId: facilityId ? Number(facilityId) : null,
      amount: String(amountNum),
      ppnAmount: String(ppnNum),
      totalAmount: String(totalNum),
      paymentMethod: paymentMethod || null,
      paymentAccount: paymentAccount || null,
      paymentStatus: "draft",
      receiptUrl: receiptUrl || null,
      notes: notes || null,
      createdBy: user.userId ?? null,
    }).returning();

    await logAudit({
      ...user, action: "EXPENSE_CREATED", entity: "expense", entityId: expense!.id,
      after: expense, ipAddress, userAgent,
    });

    res.status(201).json({ ...expense!, amount: Number(expense!.amount), ppnAmount: Number(expense!.ppnAmount), totalAmount: Number(expense!.totalAmount) });
  } catch (err) {
    req.log.error({ err }, "Create expense error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/expenses/:id", adminMiddleware, async (req, res) => {
  try {
    const user = getUserFromReq(req);
    const { ipAddress, userAgent } = getClientInfo(req);
    const id = Number(req.params["id"]);

    const [existing] = await db.select().from(expensesTable).where(eq(expensesTable.id, id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Expense not found" });
      return;
    }
    if (!["draft", "rejected"].includes(existing.paymentStatus)) {
      res.status(409).json({ error: "Hanya expense dengan status draft/rejected yang bisa diedit" });
      return;
    }

    const {
      expenseDate, category, description, vendorName, facilityId,
      amount, ppnAmount, paymentMethod, paymentAccount, receiptUrl, notes,
    } = req.body;

    const amountNum = amount !== undefined ? Number(amount) : Number(existing.amount);
    const ppnNum = ppnAmount !== undefined ? Number(ppnAmount) : Number(existing.ppnAmount);
    const totalNum = amountNum + ppnNum;

    const [updated] = await db.update(expensesTable).set({
      expenseDate: expenseDate ?? existing.expenseDate,
      category: category ?? existing.category,
      description: description ?? existing.description,
      vendorName: vendorName !== undefined ? vendorName || null : existing.vendorName,
      facilityId: facilityId !== undefined ? (facilityId ? Number(facilityId) : null) : existing.facilityId,
      amount: String(amountNum),
      ppnAmount: String(ppnNum),
      totalAmount: String(totalNum),
      paymentMethod: paymentMethod !== undefined ? paymentMethod || null : existing.paymentMethod,
      paymentAccount: paymentAccount !== undefined ? paymentAccount || null : existing.paymentAccount,
      receiptUrl: receiptUrl !== undefined ? receiptUrl || null : existing.receiptUrl,
      notes: notes !== undefined ? notes || null : existing.notes,
    }).where(eq(expensesTable.id, id)).returning();

    await logAudit({
      ...user, action: "EXPENSE_UPDATED", entity: "expense", entityId: id,
      before: existing, after: updated, ipAddress, userAgent,
    });

    res.json({ ...updated!, amount: Number(updated!.amount), ppnAmount: Number(updated!.ppnAmount), totalAmount: Number(updated!.totalAmount) });
  } catch (err) {
    req.log.error({ err }, "Update expense error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/expenses/:id/status", adminMiddleware, async (req, res) => {
  try {
    const user = getUserFromReq(req);
    const { ipAddress, userAgent } = getClientInfo(req);
    const id = Number(req.params["id"]);
    const { action, rejectedReason } = req.body;

    const [existing] = await db.select().from(expensesTable).where(eq(expensesTable.id, id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Expense not found" });
      return;
    }

    const allowedTransitions: Record<string, string[]> = {
      submit: ["draft", "rejected"],
      approve: ["pending_approval"],
      reject: ["pending_approval", "approved"],
      pay: ["approved"],
      cancel: ["draft", "pending_approval", "approved"],
    };

    if (!allowedTransitions[action]?.includes(existing.paymentStatus)) {
      res.status(409).json({ error: `Aksi '${action}' tidak valid untuk status '${existing.paymentStatus}'` });
      return;
    }

    const newStatusMap: Record<string, string> = {
      submit: "pending_approval",
      approve: "approved",
      reject: "rejected",
      pay: "paid",
      cancel: "cancelled",
    };

    const auditActions: Record<string, string> = {
      submit: "EXPENSE_SUBMITTED",
      approve: "EXPENSE_APPROVED",
      reject: "EXPENSE_REJECTED",
      pay: "EXPENSE_PAID",
      cancel: "EXPENSE_CANCELLED",
    };

    const updateData: Record<string, unknown> = {
      paymentStatus: newStatusMap[action],
    };

    if (action === "approve") {
      updateData["approvedBy"] = user.userId ?? null;
      updateData["approvedAt"] = new Date();
    }
    if (action === "pay") {
      updateData["paidAt"] = new Date();
    }
    if (action === "reject" && rejectedReason) {
      updateData["rejectedReason"] = rejectedReason;
    }

    const [updated] = await db.update(expensesTable)
      .set(updateData as any)
      .where(eq(expensesTable.id, id))
      .returning();

    if (action === "pay") {
      try {
        const today = new Date().toISOString().split("T")[0]!;
        const amountNum = Number(existing.amount);
        const ppnNum = Number(existing.ppnAmount);
        const totalNum = Number(existing.totalAmount);

        const journalRow: Record<string, unknown> = {
          bookingId: null,
          orderNumber: existing.expenseNo,
          journalType: "expense_paid",
          debitAccount: existing.category,
          debitAmount: String(ppnNum > 0 ? amountNum : totalNum),
          creditRevenueAccount: `Kas/Bank (${existing.paymentMethod ?? "Transfer"})`,
          creditRevenueAmount: String(totalNum),
          creditPpnAccount: "PPN Masukan",
          creditPpnAmount: String(ppnNum),
          journalDate: today,
          isReversal: false,
          notes: `Pengeluaran ${existing.expenseNo}: ${existing.description}`,
        };

        const [journal] = await db.insert(accountingJournalsTable).values(journalRow as any).returning();
        await db.update(expensesTable).set({ journalId: `JRN-${journal!.id}` }).where(eq(expensesTable.id, id));
      } catch (journalErr) {
        req.log.warn({ journalErr }, "Failed to create expense journal (non-fatal)");
      }
    }

    await logAudit({
      ...user, action: auditActions[action]!, entity: "expense", entityId: id,
      before: { status: existing.paymentStatus },
      after: { status: newStatusMap[action], rejectedReason },
      ipAddress, userAgent,
    });

    res.json({ ...updated!, amount: Number(updated!.amount), ppnAmount: Number(updated!.ppnAmount), totalAmount: Number(updated!.totalAmount) });
  } catch (err) {
    req.log.error({ err }, "Expense status update error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/admin/expenses/:id", adminMiddleware, async (req, res) => {
  try {
    const user = getUserFromReq(req);
    const { ipAddress, userAgent } = getClientInfo(req);
    const id = Number(req.params["id"]);

    const [existing] = await db.select().from(expensesTable).where(eq(expensesTable.id, id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Expense not found" });
      return;
    }
    if (existing.paymentStatus !== "draft") {
      res.status(409).json({ error: `Hanya expense berstatus draft yang bisa dihapus. Status saat ini: ${existing.paymentStatus}` });
      return;
    }

    await db.delete(expensesTable).where(eq(expensesTable.id, id));

    await logAudit({
      ...user, action: "EXPENSE_DELETED", entity: "expense", entityId: id,
      before: existing, ipAddress, userAgent,
    });

    res.json({ message: "Expense berhasil dihapus", expenseNo: existing.expenseNo });
  } catch (err) {
    req.log.error({ err }, "Delete expense error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
