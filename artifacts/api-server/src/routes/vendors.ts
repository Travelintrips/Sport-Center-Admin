import { Router } from "express";
import { db, vendorsTable } from "@workspace/db";
import { eq, asc, desc } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";

const router = Router();

// GET /api/vendors — public list (active only, for dropdown)
router.get("/vendors", async (_req, res) => {
  const vendors = await db
    .select({ id: vendorsTable.id, name: vendorsTable.name })
    .from(vendorsTable)
    .where(eq(vendorsTable.isActive, true))
    .orderBy(asc(vendorsTable.name));
  res.json(vendors);
});

// GET /admin/vendors — admin full list
router.get("/admin/vendors", adminMiddleware, async (_req, res) => {
  const vendors = await db
    .select()
    .from(vendorsTable)
    .orderBy(desc(vendorsTable.createdAt));
  res.json(vendors);
});

// POST /admin/vendors
router.post("/admin/vendors", adminMiddleware, async (req, res) => {
  const { name, contactPerson, phone, email, address, notes, isActive } = req.body;
  if (!name?.trim()) {
    res.status(400).json({ error: "Nama vendor wajib diisi" });
    return;
  }
  const [vendor] = await db
    .insert(vendorsTable)
    .values({ name: name.trim(), contactPerson, phone, email, address, notes, isActive: isActive ?? true })
    .returning();
  res.status(201).json(vendor);
});

// PATCH /admin/vendors/:id
router.patch("/admin/vendors/:id", adminMiddleware, async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, contactPerson, phone, email, address, notes, isActive } = req.body;
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name.trim();
  if (contactPerson !== undefined) updates.contactPerson = contactPerson;
  if (phone !== undefined) updates.phone = phone;
  if (email !== undefined) updates.email = email;
  if (address !== undefined) updates.address = address;
  if (notes !== undefined) updates.notes = notes;
  if (isActive !== undefined) updates.isActive = isActive;
  if (!Object.keys(updates).length) {
    res.status(400).json({ error: "Tidak ada field yang diupdate" });
    return;
  }
  const [vendor] = await db.update(vendorsTable).set(updates).where(eq(vendorsTable.id, id)).returning();
  if (!vendor) { res.status(404).json({ error: "Vendor tidak ditemukan" }); return; }
  res.json(vendor);
});

// DELETE /admin/vendors/:id
router.delete("/admin/vendors/:id", adminMiddleware, async (req, res) => {
  const id = parseInt(req.params.id);
  const [deleted] = await db.delete(vendorsTable).where(eq(vendorsTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Vendor tidak ditemukan" }); return; }
  res.json({ success: true });
});

export default router;
