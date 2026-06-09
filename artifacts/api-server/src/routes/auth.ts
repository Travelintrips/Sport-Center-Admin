import { Router } from "express";
import { db, usersTable, bookingsTable, facilitiesTable } from "@workspace/db";
import { eq, isNotNull } from "drizzle-orm";
import { createToken, hashPassword, authMiddleware } from "../lib/auth";

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
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: "Email and password required" });
      return;
    }
    const passwordHash = hashPassword(password);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (!user || user.passwordHash !== passwordHash) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
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
    const passwordHash = hashPassword(password);
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

router.post("/auth/admin-login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: "Email dan password wajib diisi" });
      return;
    }
    const passwordHash = hashPassword(password);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (!user || user.passwordHash !== passwordHash) {
      res.status(401).json({ error: "Email atau password salah" });
      return;
    }
    if (user.role !== "admin") {
      res.status(403).json({ error: "Akses ditolak. Halaman ini hanya untuk admin." });
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
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone, tenantId: user.tenantId ?? null, createdAt: user.createdAt });
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

    const bookings = await db.select().from(bookingsTable).where(eq(bookingsTable.customerEmail, user.email));
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
