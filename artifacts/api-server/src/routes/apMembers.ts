import { Router } from "express";
import { db, apMembersTable } from "@workspace/db";
import { eq, or, ilike } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";

const router = Router();

router.get("/ap-members", adminMiddleware, async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    let rows = await db.select().from(apMembersTable).orderBy(apMembersTable.name);
    if (search) {
      const matches = await db.select().from(apMembersTable).where(
        or(
          ilike(apMembersTable.name, `%${search}%`),
          ilike(apMembersTable.idCardNumber, `%${search}%`),
        )
      );
      rows = matches;
    }
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "List AP members error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/ap-members", adminMiddleware, async (req, res) => {
  try {
    const { name, phone, email, isActive } = req.body;
    const idCardNumber = String(req.body?.idCardNumber || "").trim().toUpperCase();
    if (!name || !idCardNumber) {
      res.status(400).json({ error: "Nama dan nomor ID Card wajib diisi" });
      return;
    }
    const [existing] = await db.select().from(apMembersTable)
      .where(eq(apMembersTable.idCardNumber, idCardNumber)).limit(1);
    if (existing) {
      res.status(409).json({ error: "Nomor ID Card sudah terdaftar" });
      return;
    }
    const [created] = await db.insert(apMembersTable).values({
      name,
      phone: phone || null,
      email: email || null,
      idCardNumber,
      isActive: isActive === undefined ? true : !!isActive,
    }).returning();
    res.status(201).json(created);
  } catch (err) {
    req.log.error({ err }, "Create AP member error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/ap-members/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const { name, phone, email, idCardNumber, isActive } = req.body;
    const patch: Record<string, unknown> = {};
    if (name !== undefined) patch.name = name;
    if (phone !== undefined) patch.phone = phone || null;
    if (email !== undefined) patch.email = email || null;
    if (idCardNumber !== undefined) patch.idCardNumber = String(idCardNumber || "").trim().toUpperCase();
    if (isActive !== undefined) patch.isActive = !!isActive;
    if (Object.keys(patch).length > 0) {
      await db.update(apMembersTable).set(patch).where(eq(apMembersTable.id, id));
    }
    const [updated] = await db.select().from(apMembersTable).where(eq(apMembersTable.id, id)).limit(1);
    if (!updated) { res.status(404).json({ error: "Member tidak ditemukan" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Update AP member error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/ap-members/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [existing] = await db.select().from(apMembersTable).where(eq(apMembersTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Member tidak ditemukan" }); return; }
    await db.delete(apMembersTable).where(eq(apMembersTable.id, id));
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Delete AP member error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
