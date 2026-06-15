import { Router } from "express";
import { db, tenantsTable, tenantBookingsTable, tenantPaymentsTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { adminMiddleware, tenantMiddleware, authMiddleware, hashPassword, createToken } from "../lib/auth";

const router = Router();

// ─── Public: Self-register as tenant ────────────────────────────────────────
router.post("/tenant/register", async (req, res) => {
  try {
    const { name, email, password, phone, businessName, ownerName, businessCategory, address } = req.body;
    if (!name || !email || !password || !businessName || !ownerName) {
      res.status(400).json({ error: "name, email, password, businessName, dan ownerName wajib diisi" });
      return;
    }
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existing) {
      res.status(409).json({ error: "Email sudah terdaftar" });
      return;
    }
    const passwordHash = hashPassword(password);
    const [user] = await db.insert(usersTable).values({
      name, email, passwordHash, phone: phone || null, role: "tenant",
    }).returning();

    const [tenant] = await db.insert(tenantsTable).values({
      userId: user.id,
      businessName,
      ownerName,
      phone: phone || null,
      email,
      businessCategory: businessCategory || null,
      address: address || null,
      status: "pending",
    }).returning();

    await db.update(usersTable).set({ tenantId: tenant.id }).where(eq(usersTable.id, user.id));

    const token = createToken(user.id, "tenant", tenant.id);
    res.status(201).json({
      user: { id: user.id, name: user.name, email: user.email, role: "tenant", phone: user.phone, tenantId: tenant.id },
      tenant,
      token,
    });
  } catch (err) {
    req.log.error({ err }, "Tenant self-register error");
    res.status(500).json({ error: "Internal server error" });
  }
});

async function generateTenantOrderNumber(): Promise<string> {
  const rows = await db.select({ orderNumber: tenantBookingsTable.orderNumber }).from(tenantBookingsTable);
  let maxNum = 0;
  for (const row of rows) {
    const match = row.orderNumber.match(/^TN-(\d+)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  return `TN-${String(maxNum + 1).padStart(4, "0")}`;
}

// ─── Tenant Portal ──────────────────────────────────────────────────────────

router.get("/tenant/me", tenantMiddleware, async (req, res) => {
  try {
    const tenantId = (req as any).user.tenantId;
    if (!tenantId) { res.status(404).json({ error: "Tenant profile not found" }); return; }
    const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1);
    if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }
    res.json(tenant);
  } catch (err) {
    req.log.error({ err }, "Get tenant me error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/tenant/bookings", tenantMiddleware, async (req, res) => {
  try {
    const tenantId = (req as any).user.tenantId;
    if (!tenantId) { res.status(404).json({ error: "Tenant profile not found" }); return; }
    const bookings = await db.select().from(tenantBookingsTable)
      .where(eq(tenantBookingsTable.tenantId, tenantId))
      .orderBy(desc(tenantBookingsTable.createdAt));
    const withPayments = await Promise.all(bookings.map(async (b) => {
      const payments = await db.select().from(tenantPaymentsTable)
        .where(eq(tenantPaymentsTable.tenantBookingId, b.id));
      return { ...b, price: Number(b.price), payments: payments.map(p => ({ ...p, amount: Number(p.amount) })) };
    }));
    res.json(withPayments);
  } catch (err) {
    req.log.error({ err }, "Get tenant bookings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/tenant/bookings", tenantMiddleware, async (req, res) => {
  try {
    const tenantId = (req as any).user.tenantId;
    const userId = (req as any).user.userId;
    if (!tenantId) { res.status(404).json({ error: "Tenant profile not found" }); return; }

    const {
      bookingType,
      paymentPeriodType,
      periodStartMonth, periodStartYear,
      periodEndMonth, periodEndYear,
      requestedArea, description,
      // legacy fields
      startDate, endDate, durationMonths,
    } = req.body;

    if (!bookingType) {
      res.status(400).json({ error: "bookingType required" });
      return;
    }

    // Period-based validation
    if (periodStartMonth !== undefined) {
      if (!periodStartMonth || !periodStartYear || !periodEndMonth || !periodEndYear) {
        res.status(400).json({ error: "periodStartMonth, periodStartYear, periodEndMonth, periodEndYear required" });
        return;
      }
      const endAfterStart =
        periodEndYear > periodStartYear ||
        (periodEndYear === periodStartYear && periodEndMonth >= periodStartMonth);
      if (!endAfterStart) {
        res.status(400).json({ error: "Period end must not be before period start" });
        return;
      }
      const totalMonths = (periodEndYear - periodStartYear) * 12 + (periodEndMonth - periodStartMonth + 1);
      if (paymentPeriodType === "yearly" && totalMonths < 12) {
        res.status(400).json({ error: "Yearly payment requires minimum 12 months" });
        return;
      }
      const orderNumber = await generateTenantOrderNumber();
      // Compute start/end date from period for legacy compat
      const computedStartDate = `${periodStartYear}-${String(periodStartMonth).padStart(2, "0")}-01`;
      const lastDayOfEndMonth = new Date(periodEndYear, periodEndMonth, 0).getDate();
      const computedEndDate = `${periodEndYear}-${String(periodEndMonth).padStart(2, "0")}-${lastDayOfEndMonth}`;

      const [booking] = await db.insert(tenantBookingsTable).values({
        orderNumber,
        tenantId,
        userId,
        bookingType: bookingType as "booth" | "event_space" | "advertising_space" | "renewal",
        periodStartMonth: Number(periodStartMonth),
        periodStartYear: Number(periodStartYear),
        periodEndMonth: Number(periodEndMonth),
        periodEndYear: Number(periodEndYear),
        totalMonths,
        startDate: computedStartDate,
        endDate: computedEndDate,
        durationMonths: totalMonths,
        requestedArea: requestedArea ?? null,
        description: description ?? null,
        price: "0",
        paymentStatus: "pending",
        status: "pending",
      }).returning();
      res.status(201).json({ ...booking, price: Number(booking.price) });
      return;
    }

    // Legacy date-based booking
    if (!startDate || !endDate) {
      res.status(400).json({ error: "bookingType and either period fields or startDate/endDate required" });
      return;
    }
    const orderNumber = await generateTenantOrderNumber();
    const [booking] = await db.insert(tenantBookingsTable).values({
      orderNumber,
      tenantId,
      userId,
      bookingType: bookingType as "booth" | "event_space" | "advertising_space" | "renewal",
      startDate,
      endDate,
      durationMonths: durationMonths ?? null,
      requestedArea: requestedArea ?? null,
      description: description ?? null,
      price: "0",
      paymentStatus: "pending",
      status: "pending",
    }).returning();
    res.status(201).json({ ...booking, price: Number(booking.price) });
  } catch (err) {
    req.log.error({ err }, "Create tenant booking error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/tenant/bookings/:orderNumber", tenantMiddleware, async (req, res) => {
  try {
    const tenantId = (req as any).user.tenantId;
    const [booking] = await db.select().from(tenantBookingsTable)
      .where(eq(tenantBookingsTable.orderNumber, String(req.params.orderNumber))).limit(1);
    if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
    if (booking.tenantId !== tenantId) { res.status(403).json({ error: "Forbidden" }); return; }
    const payments = await db.select().from(tenantPaymentsTable)
      .where(eq(tenantPaymentsTable.tenantBookingId, booking.id));
    res.json({ ...booking, price: Number(booking.price), payments: payments.map(p => ({ ...p, amount: Number(p.amount) })) });
  } catch (err) {
    req.log.error({ err }, "Get tenant booking detail error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/tenant/payments", tenantMiddleware, async (req, res) => {
  try {
    const tenantId = (req as any).user.tenantId;
    const { tenantBookingId, proofImageUrl, amount, notes } = req.body;
    if (!tenantBookingId || !amount) {
      res.status(400).json({ error: "tenantBookingId and amount required" });
      return;
    }
    const [booking] = await db.select().from(tenantBookingsTable)
      .where(eq(tenantBookingsTable.id, tenantBookingId)).limit(1);
    if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
    if (booking.tenantId !== tenantId) { res.status(403).json({ error: "Forbidden" }); return; }

    const [payment] = await db.insert(tenantPaymentsTable).values({
      tenantBookingId,
      proofImageUrl: proofImageUrl ?? null,
      amount: String(amount),
      notes: notes ?? null,
      status: "pending",
    }).returning();

    await db.update(tenantBookingsTable)
      .set({ paymentStatus: "uploaded" })
      .where(eq(tenantBookingsTable.id, tenantBookingId));

    res.status(201).json({ ...payment, amount: Number(payment.amount) });
  } catch (err) {
    req.log.error({ err }, "Create tenant payment error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Admin Tenant Management ────────────────────────────────────────────────

router.get("/admin/tenants", adminMiddleware, async (req, res) => {
  try {
    const tenants = await db.select().from(tenantsTable).orderBy(desc(tenantsTable.createdAt));
    const result = await Promise.all(tenants.map(async (t) => {
      const bookings = await db.select().from(tenantBookingsTable)
        .where(eq(tenantBookingsTable.tenantId, t.id));
      return { ...t, bookingCount: bookings.length };
    }));
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Admin list tenants error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/tenants/:id", adminMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, id)).limit(1);
    if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }
    const bookings = await db.select().from(tenantBookingsTable)
      .where(eq(tenantBookingsTable.tenantId, id)).orderBy(desc(tenantBookingsTable.createdAt));
    res.json({ ...tenant, bookings: bookings.map(b => ({ ...b, price: Number(b.price) })) });
  } catch (err) {
    req.log.error({ err }, "Admin get tenant error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/admin/tenants/:id/status", adminMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body;
    if (!["pending", "active", "inactive"].includes(status)) {
      res.status(400).json({ error: "Invalid status" }); return;
    }
    const [updated] = await db.update(tenantsTable).set({ status }).where(eq(tenantsTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Tenant not found" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Admin update tenant status error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/tenant-bookings", adminMiddleware, async (req, res) => {
  try {
    const { status, tenantId } = req.query;
    let bookings = await db.select().from(tenantBookingsTable).orderBy(desc(tenantBookingsTable.createdAt));
    if (status) bookings = bookings.filter(b => b.status === status);
    if (tenantId) bookings = bookings.filter(b => b.tenantId === Number(tenantId));

    const tenants = await db.select().from(tenantsTable);
    const result = await Promise.all(bookings.map(async (b) => {
      const tenant = tenants.find(t => t.id === b.tenantId);
      const payments = await db.select().from(tenantPaymentsTable)
        .where(eq(tenantPaymentsTable.tenantBookingId, b.id));
      return {
        ...b,
        price: Number(b.price),
        businessName: tenant?.businessName ?? "",
        ownerName: tenant?.ownerName ?? "",
        payments: payments.map(p => ({ ...p, amount: Number(p.amount) })),
      };
    }));
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Admin list tenant bookings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/admin/tenant-bookings/:id", adminMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status, price, adminNotes } = req.body;
    const updates: Record<string, unknown> = {};
    if (status) updates.status = status;
    if (price !== undefined) updates.price = String(price);
    if (adminNotes !== undefined) updates.adminNotes = adminNotes;

    const [updated] = await db.update(tenantBookingsTable)
      .set(updates).where(eq(tenantBookingsTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Booking not found" }); return; }
    res.json({ ...updated, price: Number(updated.price) });
  } catch (err) {
    req.log.error({ err }, "Admin update tenant booking error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/admin/tenant-payments/:id/verify", adminMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { notes } = req.body;
    const [payment] = await db.update(tenantPaymentsTable)
      .set({ status: "verified", notes: notes ?? null })
      .where(eq(tenantPaymentsTable.id, id)).returning();
    if (!payment) { res.status(404).json({ error: "Payment not found" }); return; }

    await db.update(tenantBookingsTable)
      .set({ paymentStatus: "verified" })
      .where(eq(tenantBookingsTable.id, payment.tenantBookingId));

    res.json({ ...payment, amount: Number(payment.amount) });
  } catch (err) {
    req.log.error({ err }, "Admin verify tenant payment error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/admin/tenant-payments/:id/reject", adminMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { notes } = req.body;
    const [payment] = await db.update(tenantPaymentsTable)
      .set({ status: "rejected", notes: notes ?? null })
      .where(eq(tenantPaymentsTable.id, id)).returning();
    if (!payment) { res.status(404).json({ error: "Payment not found" }); return; }

    await db.update(tenantBookingsTable)
      .set({ paymentStatus: "rejected" })
      .where(eq(tenantBookingsTable.id, payment.tenantBookingId));

    res.json({ ...payment, amount: Number(payment.amount) });
  } catch (err) {
    req.log.error({ err }, "Admin reject tenant payment error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Admin: create tenant user account
router.post("/admin/tenants", adminMiddleware, async (req, res) => {
  try {
    const { name, email, password, phone, businessName, ownerName, businessCategory, address } = req.body;
    if (!name || !email || !password || !businessName || !ownerName) {
      res.status(400).json({ error: "name, email, password, businessName, ownerName required" }); return;
    }
    const { hashPassword, createToken } = await import("../lib/auth");
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existing) { res.status(409).json({ error: "Email already registered" }); return; }

    const passwordHash = hashPassword(password);
    const [user] = await db.insert(usersTable).values({
      name, email, passwordHash, phone: phone ?? null, role: "tenant",
    }).returning();

    const [tenant] = await db.insert(tenantsTable).values({
      userId: user.id,
      businessName,
      ownerName,
      phone: phone ?? null,
      email,
      businessCategory: businessCategory ?? null,
      address: address ?? null,
      status: "active",
    }).returning();

    await db.update(usersTable).set({ tenantId: tenant.id }).where(eq(usersTable.id, user.id));

    res.status(201).json({ user: { ...user, tenantId: tenant.id }, tenant });
  } catch (err) {
    req.log.error({ err }, "Admin create tenant error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
