import { Router } from "express";
import { db, usersTable, bookingsTable, facilitiesTable } from "@workspace/db";
import { eq, isNotNull, ilike, or } from "drizzle-orm";
import { createToken, hashPassword, verifyPassword, authMiddleware } from "../lib/auth";

async function generateCustomerCode(): Promise<string> {
  const rows = await db.select({ customerCode: usersTable.customerCode }).from(usersTable).where(isNotNull(usersTable.customerCode));
  let maxNum = 0;
  for (const row of rows) {
    const match = row.customerCode?.match(/^SC-CUST-(\d+)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  return `SC-CUST-${String(maxNum + 1).padStart(6, "0")}`;
}

const router = Router();

router.post("/auth/login", async (req, res) => {
  try {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    if (!email || !password) {
      res.status(400).json({ error: "Email and password required" });
      return;
    }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (!user || !user.passwordHash) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const { valid, legacy } = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    // Lazy migration: rehash with bcrypt if still on old HMAC scheme
    if (legacy) {
      const newHash = await hashPassword(password);
      await db.update(usersTable).set({ passwordHash: newHash }).where(eq(usersTable.id, user.id));
    }
    let tenantId: number | null = null;
    if (user.role === "tenant") {
      const { tenantsTable } = await import("@workspace/db");
      const { eq } = await import("drizzle-orm");
      const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.userId, user.id)).limit(1);
      tenantId = tenant?.id ?? null;
    }
    const token = createToken(user.id, user.role, tenantId);
    res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone, tenantId, createdAt: user.createdAt },
      token,
    });
  } catch (err) {
    req.log.error({ err }, "Login error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/register", async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    if (!name || !email || !password) {
      res.status(400).json({ error: "Name, email and password required" });
      return;
    }
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existing) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }
    const passwordHash = await hashPassword(password);
    const customerCode = await generateCustomerCode();
    const [user] = await db.insert(usersTable).values({
      name, email, passwordHash, phone: phone || null, role: "customer", customerCode, registrationSource: "web",
    }).returning();
    const token = createToken(user.id, user.role);
    res.status(201).json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone, customerCode: user.customerCode, createdAt: user.createdAt },
      token,
    });
  } catch (err) {
    req.log.error({ err }, "Register error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/setup-admin", async (req, res) => {
  try {
    const key = req.headers["x-setup-key"] as string;
    const PORTAL_ADMIN_KEY = process.env.PORTAL_ADMIN_KEY || "";
    if (!PORTAL_ADMIN_KEY || key !== PORTAL_ADMIN_KEY) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const { email, name, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: "email and password required" });
      return;
    }
    const passwordHash = await hashPassword(password);
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existing) {
      const [updated] = await db.update(usersTable).set({ role: "admin", passwordHash }).where(eq(usersTable.email, email)).returning();
      res.json({ action: "updated", id: updated.id, email: updated.email, role: updated.role });
    } else {
      const [created] = await db.insert(usersTable).values({ name: name ?? email, email, passwordHash, role: "admin", registrationSource: "web" }).returning();
      res.json({ action: "created", id: created.id, email: created.email, role: created.role });
    }
  } catch (err) {
    req.log.error({ err }, "Setup admin error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/admin-login", async (req, res) => {
  try {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    if (!email || !password) {
      res.status(400).json({ error: "Email dan password wajib diisi" });
      return;
    }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (!user || !user.passwordHash) {
      res.status(401).json({ error: "Email atau password salah" });
      return;
    }
    const { valid, legacy } = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Email atau password salah" });
      return;
    }
    // Lazy migration: rehash with bcrypt if still on old HMAC scheme
    if (legacy) {
      const newHash = await hashPassword(password);
      await db.update(usersTable).set({ passwordHash: newHash }).where(eq(usersTable.id, user.id));
    }
    if (user.role !== "admin" && user.role !== "super_admin" && user.role !== "admin_booking") {
      res.status(403).json({ error: "Akses ditolak. Akun ini bukan akun admin/operator." });
      return;
    }
    const token = createToken(user.id, user.role, null);
    res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone, tenantId: null, createdAt: user.createdAt },
      token,
    });
  } catch (err) {
    req.log.error({ err }, "Admin login error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/logout", (_req, res) => {
  res.json({ message: "Logged out" });
});

router.get("/auth/me", authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }
    res.json({
      id: user.id, name: user.name, email: user.email, role: user.role,
      phone: user.phone, tenantId: user.tenantId ?? null, createdAt: user.createdAt,
      googleId: (user as any).googleId ?? null,
      hasPassword: !!(user as any).passwordHash,
    });
  } catch (err) {
    req.log.error({ err }, "Get me error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/my-bookings", authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) { res.status(401).json({ error: "User not found" }); return; }

    // Cocokkan via customerId ATAU bookedByUserId ATAU customerEmail (case-insensitive)
    const bookings = await db.select().from(bookingsTable).where(
      or(
        eq(bookingsTable.customerId, userId),
        eq(bookingsTable.bookedByUserId, userId),
        user.email ? ilike(bookingsTable.customerEmail, user.email) : undefined,
      )
    );
    const facilities = await db.select().from(facilitiesTable);

    const result = bookings.map((b) => {
      const facility = facilities.find((f) => f.id === b.facilityId);
      return {
        ...b,
        totalPrice: Number(b.totalPrice),
        facilityName: facility?.name ?? "",
        facilityCategory: facility?.category ?? "",
        payment: null,
      };
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "My bookings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
