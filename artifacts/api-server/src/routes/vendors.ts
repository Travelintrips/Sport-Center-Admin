import { Router } from "express";
import { db, vendorsTable } from "@workspace/db";
import { eq, asc, desc } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { logAudit, getClientInfo, getUserFromReq } from "../lib/auditLog";

const router = Router();

// GET /api/vendors — public list (active only, for dropdown)
router.get("/vendors", async (_req, res) => {
  try {
    const vendors = await db
      .select({ id: vendorsTable.id, name: vendorsTable.name })
      .from(vendorsTable)
      .where(eq(vendorsTable.isActive, true))
      .orderBy(asc(vendorsTable.name));
    res.json(vendors);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /admin/vendors — admin full list
router.get("/admin/vendors", adminMiddleware, async (_req, res) => {
  try {
    const vendors = await db
      .select()
      .from(vendorsTable)
      .orderBy(desc(vendorsTable.createdAt));
    res.json(vendors);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /admin/vendors
router.post("/admin/vendors", adminMiddleware, async (req, res) => {
  const user = getUserFromReq(req);
  const { ipAddress, userAgent } = getClientInfo(req);
  const { name, contactPerson, phone, email, address, notes, isActive } = req.body;
  if (!name?.trim()) {
    res.status(400).json({ error: "Nama vendor wajib diisi" });
    return;
  }
  const [vendor] = await db
    .insert(vendorsTable)
    .values({ name: name.trim(), contactPerson, phone, email, address, notes, isActive: isActive ?? true })
    .returning();
  await logAudit({
    ...user, action: "VENDOR_CREATED", entity: "vendor", entityId: vendor!.id,
    after: vendor, ipAddress, userAgent,
  });
  res.status(201).json(vendor);
  try {
    const user = getUserFromReq(req);
    const { ipAddress, userAgent } = getClientInfo(req);
    const { name, contactPerson, phone, email, address, notes, isActive } = req.body;
    if (!name?.trim()) {
      res.status(400).json({ error: "Nama vendor wajib diisi" });
      return;
    }
    const [vendor] = await db
      .insert(vendorsTable)
      .values({ name: name.trim(), contactPerson, phone, email, address, notes, isActive: isActive ?? true })
      .returning();
    await logAudit({
      ...user, action: "VENDOR_CREATED", entity: "vendor", entityId: vendor!.id,
      after: vendor, ipAddress, userAgent,
    });
    res.status(201).json(vendor);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /admin/vendors/:id
router.patch("/admin/vendors/:id", adminMiddleware, async (req, res) => {
  const user = getUserFromReq(req);
  const { ipAddress, userAgent } = getClientInfo(req);
  const id = parseInt(req.params.id as string);
  const { name, contactPerson, phone, email, address, notes, isActive } = req.body;

  const [existing] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Vendor tidak ditemukan" }); return; }

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates["name"] = name.trim();
  if (contactPerson !== undefined) updates["contactPerson"] = contactPerson;
  if (phone !== undefined) updates["phone"] = phone;
  if (email !== undefined) updates["email"] = email;
  if (address !== undefined) updates["address"] = address;
  if (notes !== undefined) updates["notes"] = notes;
  if (isActive !== undefined) updates["isActive"] = isActive;
  if (!Object.keys(updates).length) {
    res.status(400).json({ error: "Tidak ada field yang diupdate" });
    return;
  }
  const [vendor] = await db.update(vendorsTable).set(updates).where(eq(vendorsTable.id, id)).returning();

  const auditAction = isActive === false ? "VENDOR_DEACTIVATED" : "VENDOR_UPDATED";
  await logAudit({
    ...user, action: auditAction, entity: "vendor", entityId: id,
    before: existing, after: vendor, ipAddress, userAgent,
  });

  res.json(vendor);
  try {
    const user = getUserFromReq(req);
    const { ipAddress, userAgent } = getClientInfo(req);
    const id = parseInt(req.params["id"]!);
    const { name, contactPerson, phone, email, address, notes, isActive } = req.body;

    const [existing] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Vendor tidak ditemukan" }); return; }

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates["name"] = name.trim();
    if (contactPerson !== undefined) updates["contactPerson"] = contactPerson;
    if (phone !== undefined) updates["phone"] = phone;
    if (email !== undefined) updates["email"] = email;
    if (address !== undefined) updates["address"] = address;
    if (notes !== undefined) updates["notes"] = notes;
    if (isActive !== undefined) updates["isActive"] = isActive;
    if (!Object.keys(updates).length) {
      res.status(400).json({ error: "Tidak ada field yang diupdate" });
      return;
    }
    const [vendor] = await db.update(vendorsTable).set(updates as any).where(eq(vendorsTable.id, id)).returning();

    const auditAction = isActive === false ? "VENDOR_DEACTIVATED" : "VENDOR_UPDATED";
    await logAudit({
      ...user, action: auditAction, entity: "vendor", entityId: id,
      before: existing, after: vendor, ipAddress, userAgent,
    });

    res.json(vendor);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /admin/vendors/:id
router.delete("/admin/vendors/:id", adminMiddleware, async (req, res) => {
  const user = getUserFromReq(req);
  const { ipAddress, userAgent } = getClientInfo(req);
  const id = parseInt(req.params.id as string);
  const [existing] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Vendor tidak ditemukan" }); return; }
  const [deleted] = await db.delete(vendorsTable).where(eq(vendorsTable.id, id)).returning();
  await logAudit({
    ...user, action: "VENDOR_DELETED", entity: "vendor", entityId: id,
    before: deleted, ipAddress, userAgent,
  });
  res.json({ success: true });
  try {
    const user = getUserFromReq(req);
    const { ipAddress, userAgent } = getClientInfo(req);
    const id = parseInt(req.params["id"]!);
    const [existing] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Vendor tidak ditemukan" }); return; }
    await db.delete(vendorsTable).where(eq(vendorsTable.id, id));
    await logAudit({
      ...user, action: "VENDOR_DELETED", entity: "vendor", entityId: id,
      before: existing, ipAddress, userAgent,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
