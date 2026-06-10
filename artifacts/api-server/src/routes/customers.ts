import { Router } from "express";
import { db, usersTable, bookingsTable } from "@workspace/db";
import { eq, or, ilike } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { createHmac } from "crypto";

const router = Router();

function mapUser(u: typeof usersTable.$inferSelect, userBookings: (typeof bookingsTable.$inferSelect)[]) {
  const totalSpent = userBookings
    .filter((b) => b.status !== "cancelled" && b.status !== "expired" && b.status !== "rejected" && b.status !== "refunded")
    .reduce((sum, b) => sum + Number(b.totalPrice), 0);
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    customerCode: u.customerCode,
    registrationSource: u.registrationSource ?? "web",
    accountType: u.accountType ?? "personal",
    companyName: u.companyName,
    picName: u.picName,
    picPhone: u.picPhone,
    picEmail: u.picEmail,
    billingAddress: u.billingAddress,
    paymentTermsDays: u.paymentTermsDays,
    monthlyCreditLimit: u.monthlyCreditLimit != null ? Number(u.monthlyCreditLimit) : null,
    allowMonthlyBilling: u.allowMonthlyBilling,
    accountStatus: u.accountStatus ?? "active",
    totalBookings: userBookings.length,
    totalSpent,
    createdAt: u.createdAt,
  };
}

router.get("/customers", adminMiddleware, async (req, res) => {
  try {
    const { search, accountType } = req.query;
    let users = await db.select().from(usersTable).where(eq(usersTable.role, "customer"));

    if (accountType === "company") {
      users = users.filter((u) => u.accountType === "company");
    } else if (accountType === "personal") {
      users = users.filter((u) => u.accountType !== "company");
    }

    const bookings = await db.select().from(bookingsTable);

    let result = users.map((u) => {
      const userBookings = bookings.filter((b) => b.customerId === u.id || b.customerEmail === u.email || b.companyCustomerId === u.id);
      return mapUser(u, userBookings);
    });

    if (search) {
      const s = (search as string).toLowerCase();
      result = result.filter(
        (u) =>
          u.name.toLowerCase().includes(s) ||
          (u.email ?? "").toLowerCase().includes(s) ||
          (u.phone ?? "").includes(s) ||
          (u.customerCode ?? "").toLowerCase().includes(s) ||
          (u.companyName ?? "").toLowerCase().includes(s)
      );
    }

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "List customers error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/customers", adminMiddleware, async (req, res) => {
  try {
    const {
      name, email, phone, accountType,
      companyName, picName, picPhone, picEmail, billingAddress,
      paymentTermsDays, monthlyCreditLimit, allowMonthlyBilling, accountStatus
    } = req.body;

    if (!name || !email || !accountType) {
      res.status(400).json({ error: "name, email, accountType required" });
      return;
    }

    const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existing) { res.status(409).json({ error: "Email sudah digunakan" }); return; }

    const sessionSecret = process.env.SESSION_SECRET ?? "default_secret";
    const defaultPassword = "customer123";
    const passwordHash = createHmac("sha256", sessionSecret).update(defaultPassword).digest("hex");

    const [user] = await db.insert(usersTable).values({
      name,
      email,
      phone: phone ?? null,
      passwordHash,
      role: "customer",
      accountType: accountType ?? "personal",
      companyName: companyName ?? null,
      picName: picName ?? null,
      picPhone: picPhone ?? null,
      picEmail: picEmail ?? null,
      billingAddress: billingAddress ?? null,
      paymentTermsDays: paymentTermsDays ?? 30,
      monthlyCreditLimit: monthlyCreditLimit ? String(monthlyCreditLimit) : null,
      allowMonthlyBilling: allowMonthlyBilling ?? false,
      accountStatus: accountStatus ?? "active",
    }).returning();

    res.status(201).json(mapUser(user, []));
  } catch (err) {
    req.log.error({ err }, "Create customer error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/customers/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!user) { res.status(404).json({ error: "Not found" }); return; }
    const userBookings = await db.select().from(bookingsTable).where(
      or(eq(bookingsTable.customerId, id), eq(bookingsTable.companyCustomerId, id))
    );
    res.json(mapUser(user, userBookings));
  } catch (err) {
    req.log.error({ err }, "Get customer error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/customers/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const {
      name, email, phone, accountType,
      companyName, picName, picPhone, picEmail, billingAddress,
      paymentTermsDays, monthlyCreditLimit, allowMonthlyBilling, accountStatus
    } = req.body;

    const updates: Partial<typeof usersTable.$inferInsert> = {};
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email;
    if (phone !== undefined) updates.phone = phone;
    if (accountType !== undefined) updates.accountType = accountType;
    if (companyName !== undefined) updates.companyName = companyName;
    if (picName !== undefined) updates.picName = picName;
    if (picPhone !== undefined) updates.picPhone = picPhone;
    if (picEmail !== undefined) updates.picEmail = picEmail;
    if (billingAddress !== undefined) updates.billingAddress = billingAddress;
    if (paymentTermsDays !== undefined) updates.paymentTermsDays = paymentTermsDays;
    if (monthlyCreditLimit !== undefined) updates.monthlyCreditLimit = monthlyCreditLimit ? String(monthlyCreditLimit) : null;
    if (allowMonthlyBilling !== undefined) updates.allowMonthlyBilling = allowMonthlyBilling;
    if (accountStatus !== undefined) updates.accountStatus = accountStatus;

    const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
    const userBookings = await db.select().from(bookingsTable).where(
      or(eq(bookingsTable.customerId, id), eq(bookingsTable.companyCustomerId, id))
    );
    res.json(mapUser(updated, userBookings));
  } catch (err) {
    req.log.error({ err }, "Update customer error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
