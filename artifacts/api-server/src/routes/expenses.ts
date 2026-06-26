import { Router } from "express";
import { db, expensesTable, facilitiesTable, usersTable, publicExpensesTable, coaAccountsTable, vendorsTable } from "@workspace/db";
import { eq, desc, and, gte, lte, sql, asc, inArray } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { logAudit, getClientInfo, getUserFromReq } from "../lib/auditLog";
import { createExpenseJournalEntry } from "../lib/accounting";

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

async function getFacilityName(facilityId: number | null): Promise<string | null> {
  if (!facilityId) return null;
  const [f] = await db.select({ name: facilitiesTable.name }).from(facilitiesTable).where(eq(facilitiesTable.id, facilityId)).limit(1);
  return f?.name ?? null;
}

async function getVendor(vendorId: number | null) {
  if (!vendorId) return null;
  const [v] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, vendorId)).limit(1);
  return v ?? null;
}

async function getCoaAccount(coaAccountId: number | null) {
  if (!coaAccountId) return null;
  const [a] = await db.select().from(coaAccountsTable).where(eq(coaAccountsTable.id, coaAccountId)).limit(1);
  return a ?? null;
}

async function getVendorById(vendorId: number | null): Promise<{ id: number; name: string } | null> {
  if (!vendorId) return null;
  const [v] = await db.select({ id: vendorsTable.id, name: vendorsTable.name }).from(vendorsTable).where(eq(vendorsTable.id, vendorId)).limit(1);
  return v ?? null;
}

async function syncToPublic(expense: typeof expensesTable.$inferSelect, facilityName: string | null) {
  try {
    await db
      .insert(publicExpensesTable)
      .values({
        sourceId: expense.id,
        expenseNo: expense.expenseNo,
        expenseDate: expense.expenseDate,
        category: expense.category,
        description: expense.description,
        vendorName: expense.vendorName,
        facilityId: expense.facilityId,
        facilityName,
        amount: expense.amount,
        ppnAmount: expense.ppnAmount,
        totalAmount: expense.totalAmount,
        paymentMethod: expense.paymentMethod,
        paymentAccount: expense.paymentAccount,
        paymentStatus: expense.paymentStatus,
        receiptUrl: expense.receiptUrl,
        receiptUrls: expense.receiptUrls ?? [],
        notes: expense.notes,
        rejectedReason: expense.rejectedReason,
        journalId: expense.journalId,
        source: "sport_center",
        createdAt: expense.createdAt,
        updatedAt: expense.updatedAt,
      })
      .onConflictDoUpdate({
        target: publicExpensesTable.expenseNo,
        set: {
          sourceId: expense.id,
          expenseDate: expense.expenseDate,
          category: expense.category,
          description: expense.description,
          vendorName: expense.vendorName,
          facilityId: expense.facilityId,
          facilityName,
          amount: expense.amount,
          ppnAmount: expense.ppnAmount,
          totalAmount: expense.totalAmount,
          paymentMethod: expense.paymentMethod,
          paymentAccount: expense.paymentAccount,
          paymentStatus: expense.paymentStatus,
          receiptUrl: expense.receiptUrl,
          receiptUrls: expense.receiptUrls ?? [],
          notes: expense.notes,
          rejectedReason: expense.rejectedReason,
          journalId: expense.journalId,
          updatedAt: expense.updatedAt,
        },
      });
  } catch (err) {
    console.warn("[sync-public-expenses] Non-fatal sync error:", err);
  }
}

async function deleteFromPublic(expenseNo: string) {
  try {
    await db.delete(publicExpensesTable).where(eq(publicExpensesTable.expenseNo, expenseNo));
  } catch (err) {
    console.warn("[sync-public-expenses] Non-fatal delete error:", err);
  }
}

// ─── GET COA accounts for expense form ────────────────────────────────────────
router.get("/admin/expenses/coa-accounts", adminMiddleware, async (req, res) => {
  try {
    const accounts = await db
      .select()
      .from(coaAccountsTable)
      .where(
        and(
          eq(coaAccountsTable.isActive, true),
          inArray(coaAccountsTable.accountType, ["asset", "liability", "expense"]),
        ),
      )
      .orderBy(asc(coaAccountsTable.sortOrder), asc(coaAccountsTable.code));
    res.json(accounts);
  } catch (err) {
    req.log.error({ err }, "List COA accounts error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET expenses list ─────────────────────────────────────────────────────────
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

    // Fetch all COA accounts referenced by these expenses
    const coaIds = [...new Set(expenses.map((e) => e.coaAccountId).filter(Boolean))] as number[];
    const coaAccounts = coaIds.length
      ? await db.select().from(coaAccountsTable).where(inArray(coaAccountsTable.id, coaIds))
      : [];
    const coaMap = Object.fromEntries(coaAccounts.map((a) => [a.id, a]));

    // Fetch all vendors referenced by these expenses
    const vendorIds = [...new Set(expenses.map((e) => (e as any).vendorId).filter(Boolean))] as number[];
    const vendors = vendorIds.length
      ? await db.select().from(vendorsTable).where(inArray(vendorsTable.id, vendorIds))
      : [];
    const vendorMap = Object.fromEntries(vendors.map((v) => [v.id, v]));

    const filtered = vendorName
      ? expenses.filter((e) => {
          const vName = (e as any).vendorId ? vendorMap[(e as any).vendorId]?.name ?? e.vendorName : e.vendorName;
          return vName?.toLowerCase().includes((vendorName as string).toLowerCase());
        })
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
      expenses: filtered.map((e) => {
        const vendorId = (e as any).vendorId as number | null;
        const vendor = vendorId ? vendorMap[vendorId] ?? null : null;
        return {
          ...e,
          amount: Number(e.amount),
          ppnAmount: Number(e.ppnAmount),
          totalAmount: Number(e.totalAmount),
          facilityName: e.facilityId ? facilityMap[e.facilityId] ?? null : null,
          coaAccount: e.coaAccountId ? coaMap[e.coaAccountId] ?? null : null,
          vendor,
          vendorName: vendor?.name ?? e.vendorName ?? null,
        };
      }),
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

    const coaAccount = await getCoaAccount(expense.coaAccountId);
    const vendor = await getVendor((expense as any).vendorId ?? null);

    res.json({
      ...expense,
      amount: Number(expense.amount),
      ppnAmount: Number(expense.ppnAmount),
      totalAmount: Number(expense.totalAmount),
      facilityName: expense.facilityId ? facilityMap[expense.facilityId] ?? null : null,
      createdByName,
      approvedByName,
      coaAccount,
      vendor,
      vendorName: vendor?.name ?? expense.vendorName ?? null,
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
      expenseDate, category, coaAccountId, description, vendorId, vendorName, facilityId,
      amount, ppnAmount = 0, paymentMethod, paymentAccount, receiptUrl, receiptUrls, notes,
    } = req.body;

    if (!expenseDate || !description || !amount) {
      res.status(400).json({ error: "expenseDate, description, amount wajib diisi" });
      return;
    }

    if (!coaAccountId && !category) {
      res.status(400).json({ error: "Akun COA wajib dipilih" });
      return;
    }

    // Lookup COA account to derive category if not provided
    let resolvedCategory = category;
    if (coaAccountId && !category) {
      const coaAcc = await getCoaAccount(Number(coaAccountId));
      resolvedCategory = coaAcc?.name ?? "Lain-lain";
    }
    if (!resolvedCategory) resolvedCategory = "Lain-lain";

    // Resolve vendor name snapshot from vendor master
    const resolvedVendorId = vendorId ? Number(vendorId) : null;
    let resolvedVendorName = vendorName || null;
    if (resolvedVendorId && !resolvedVendorName) {
      const v = await getVendorById(resolvedVendorId);
      resolvedVendorName = v?.name ?? null;
    }

    const amountNum = Number(amount);
    const ppnNum = Number(ppnAmount);
    const totalNum = amountNum + ppnNum;

    const expenseNo = await generateExpenseNo();

    const [expense] = await db.insert(expensesTable).values({
      expenseNo,
      expenseDate,
      category: resolvedCategory,
      coaAccountId: coaAccountId ? Number(coaAccountId) : null,
      description,
      vendorId: resolvedVendorId,
      vendorName: resolvedVendorName,
      facilityId: facilityId ? Number(facilityId) : null,
      amount: String(amountNum),
      ppnAmount: String(ppnNum),
      totalAmount: String(totalNum),
      paymentMethod: paymentMethod || null,
      paymentAccount: paymentAccount || null,
      paymentStatus: "draft",
      receiptUrl: receiptUrl || null,
      receiptUrls: Array.isArray(receiptUrls) ? receiptUrls : [],
      notes: notes || null,
      createdBy: user.userId ?? null,
    } as any).returning();

    await logAudit({
      ...user, action: "EXPENSE_CREATED", entity: "expense", entityId: expense!.id,
      after: { ...expense, vendorId: resolvedVendorId, vendorName: resolvedVendorName },
      ipAddress, userAgent,
    });

    if (resolvedVendorId) {
      await logAudit({
        ...user, action: "EXPENSE_VENDOR_SELECTED", entity: "expense", entityId: expense!.id,
        after: { vendorId: resolvedVendorId, vendorName: resolvedVendorName, expenseNo: expense!.expenseNo },
        ipAddress, userAgent,
      });
    }

    const facilityName = await getFacilityName(expense!.facilityId);
    await syncToPublic(expense!, facilityName);

    const coaAccount = await getCoaAccount(expense!.coaAccountId);
    const vendor = await getVendor(resolvedVendorId);
    res.status(201).json({
      ...expense!,
      amount: Number(expense!.amount),
      ppnAmount: Number(expense!.ppnAmount),
      totalAmount: Number(expense!.totalAmount),
      coaAccount,
      vendor,
      vendorName: vendor?.name ?? resolvedVendorName,
    });
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
      expenseDate, category, coaAccountId, description, vendorId, vendorName, facilityId,
      amount, ppnAmount, paymentMethod, paymentAccount, receiptUrl, receiptUrls, notes,
    } = req.body;

    // Resolve category from COA if provided
    let resolvedCategory = category ?? existing.category;
    const newCoaId = coaAccountId !== undefined ? (coaAccountId ? Number(coaAccountId) : null) : existing.coaAccountId;
    if (coaAccountId && !category) {
      const coaAcc = await getCoaAccount(Number(coaAccountId));
      if (coaAcc) resolvedCategory = coaAcc.name;
    }

    // Resolve vendor
    const existingVendorId = (existing as any).vendorId ?? null;
    const newVendorId = vendorId !== undefined ? (vendorId ? Number(vendorId) : null) : existingVendorId;
    let newVendorName = vendorName !== undefined ? vendorName || null : existing.vendorName;
    if (newVendorId && vendorId !== undefined && !vendorName) {
      const v = await getVendorById(newVendorId);
      newVendorName = v?.name ?? null;
    }

    const amountNum = amount !== undefined ? Number(amount) : Number(existing.amount);
    const ppnNum = ppnAmount !== undefined ? Number(ppnAmount) : Number(existing.ppnAmount);
    const totalNum = amountNum + ppnNum;

    const [updated] = await db.update(expensesTable).set({
      expenseDate: expenseDate ?? existing.expenseDate,
      category: resolvedCategory,
      coaAccountId: newCoaId,
      description: description ?? existing.description,
      vendorId: newVendorId,
      vendorName: newVendorName,
      facilityId: facilityId !== undefined ? (facilityId ? Number(facilityId) : null) : existing.facilityId,
      amount: String(amountNum),
      ppnAmount: String(ppnNum),
      totalAmount: String(totalNum),
      paymentMethod: paymentMethod !== undefined ? paymentMethod || null : existing.paymentMethod,
      paymentAccount: paymentAccount !== undefined ? paymentAccount || null : existing.paymentAccount,
      receiptUrl: receiptUrl !== undefined ? receiptUrl || null : existing.receiptUrl,
      receiptUrls: receiptUrls !== undefined ? (Array.isArray(receiptUrls) ? receiptUrls : []) : (existing.receiptUrls ?? []),
      notes: notes !== undefined ? notes || null : existing.notes,
    } as any).where(eq(expensesTable.id, id)).returning();

    await logAudit({
      ...user, action: "EXPENSE_UPDATED", entity: "expense", entityId: id,
      before: existing, after: updated, ipAddress, userAgent,
    });

    if (newVendorId && newVendorId !== existingVendorId) {
      await logAudit({
        ...user, action: "EXPENSE_VENDOR_SELECTED", entity: "expense", entityId: id,
        after: { vendorId: newVendorId, vendorName: newVendorName, expenseNo: existing.expenseNo },
        ipAddress, userAgent,
      });
    }

    const facilityName = await getFacilityName(updated!.facilityId);
    await syncToPublic(updated!, facilityName);
    const coaAccount = await getCoaAccount(updated!.coaAccountId);
    const vendor = await getVendor(newVendorId);

    res.json({
      ...updated!,
      amount: Number(updated!.amount),
      ppnAmount: Number(updated!.ppnAmount),
      totalAmount: Number(updated!.totalAmount),
      coaAccount,
      vendor,
      vendorName: vendor?.name ?? newVendorName,
    });
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

        // Fetch COA account details for correct journal posting
        const coaAccount = await getCoaAccount(existing.coaAccountId);

        const journalId = await createExpenseJournalEntry(
          existing.expenseNo,
          existing.category,
          amountNum,
          ppnNum,
          totalNum,
          existing.paymentMethod ?? "Transfer",
          existing.description,
          today,
          coaAccount?.code,
          coaAccount?.name,
          coaAccount?.accountType,
        );
        if (journalId) {
          await db.update(expensesTable).set({ journalId: `JRN-${journalId}` }).where(eq(expensesTable.id, id));
          updated!.journalId = `JRN-${journalId}`;
        }
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

    const facilityName = await getFacilityName(updated!.facilityId);
    await syncToPublic(updated!, facilityName);

    res.json({
      ...updated!,
      amount: Number(updated!.amount),
      ppnAmount: Number(updated!.ppnAmount),
      totalAmount: Number(updated!.totalAmount),
    });
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
    await deleteFromPublic(existing.expenseNo);

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
