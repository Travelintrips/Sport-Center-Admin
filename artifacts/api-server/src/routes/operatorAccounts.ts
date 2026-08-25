import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import crypto from "crypto";

const router = Router();

function hashPassword(password: string): string {
  return crypto.createHmac("sha256", process.env.SESSION_SECRET ?? "").update(password).digest("hex");
}

router.get("/operator-accounts", adminMiddleware, async (req, res) => {
  try {
    const operators = await db
      .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, phone: usersTable.phone, accountStatus: usersTable.accountStatus, createdAt: usersTable.createdAt })
      .from(usersTable)
      .where(eq(usersTable.role, "admin_booking"))
      .orderBy(usersTable.createdAt);
    res.json(operators);
  } catch (err) {
    req.log.error({ err }, "List operator accounts error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/operator-accounts", adminMiddleware, async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    if (!name || !email || !password) {
      res.status(400).json({ error: "name, email, dan password wajib diisi" });
      return;
    }
    const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: "Email sudah digunakan" });
      return;
    }
    const [created] = await db.insert(usersTable).values({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone?.trim() || null,
      role: "admin_booking",
      passwordHash: hashPassword(password),
      accountStatus: "active",
    }).returning({ id: usersTable.id, name: usersTable.name, email: usersTable.email, phone: usersTable.phone, accountStatus: usersTable.accountStatus, createdAt: usersTable.createdAt });
    res.status(201).json(created);
  } catch (err) {
    req.log.error({ err }, "Create operator account error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/operator-accounts/:id", adminMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, email, phone, password, accountStatus } = req.body;
    const updates: Record<string, any> = {};
    if (name) updates.name = name.trim();
    if (email) updates.email = email.trim().toLowerCase();
    if (phone !== undefined) updates.phone = phone?.trim() || null;
    if (password) updates.passwordHash = hashPassword(password);
    if (accountStatus) updates.accountStatus = accountStatus;
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "Tidak ada field yang diubah" });
      return;
    }
    const [updated] = await db.update(usersTable).set(updates).where(and(eq(usersTable.id, id), eq(usersTable.role, "admin_booking"))).returning({ id: usersTable.id, name: usersTable.name, email: usersTable.email, phone: usersTable.phone, accountStatus: usersTable.accountStatus, createdAt: usersTable.createdAt });
    if (!updated) { res.status(404).json({ error: "Akun tidak ditemukan" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Update operator account error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/operator-accounts/:id", adminMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [deleted] = await db.delete(usersTable).where(and(eq(usersTable.id, id), eq(usersTable.role, "admin_booking"))).returning({ id: usersTable.id });
    if (!deleted) { res.status(404).json({ error: "Akun tidak ditemukan" }); return; }
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete operator account error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
