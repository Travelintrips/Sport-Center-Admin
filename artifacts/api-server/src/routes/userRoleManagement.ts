import { Router } from "express";
import { db, usersTable, auditLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { authMiddleware } from "../lib/auth";
import { canEditRole } from "../lib/roleAuthorization";

const router = Router();
const roles = ["customer", "staff", "admin_booking", "admin", "finance", "super_admin"] as const;
type Role = typeof roles[number];

router.get("/admin/user-roles", authMiddleware, async (req, res) => {
  try {
    const actorId = (req as any).user.userId as number;
    const [actor] = await db.select({ role: usersTable.role, status: usersTable.accountStatus }).from(usersTable).where(eq(usersTable.id, actorId)).limit(1);
    if (!actor || actor.status !== "active" || !["owner", "super_admin"].includes(actor.role)) {
      res.status(403).json({ error: "Hanya Owner atau Super Admin" }); return;
    }
    const users = await db.select({
      id: usersTable.id, name: usersTable.name, email: usersTable.email,
      role: usersTable.role, accountStatus: usersTable.accountStatus,
    }).from(usersTable).orderBy(usersTable.name).limit(1000);
    res.json({ users, actorRole: actor.role });
  } catch (error) {
    req.log.error({ error }, "List user roles failed");
    res.status(500).json({ error: "Gagal memuat pengguna" });
  }
});

router.patch("/admin/user-roles/:id", authMiddleware, async (req, res) => {
  const targetId = Number(req.params.id);
  const role = req.body?.role;
  const actorId = (req as any).user.userId as number;
  if (!Number.isSafeInteger(targetId) || targetId < 1 || typeof role !== "string" || !roles.includes(role as Role)) {
    res.status(400).json({ error: "Data jabatan tidak valid" }); return;
  }
  if (actorId === targetId) { res.status(403).json({ error: "Tidak dapat mengubah jabatan sendiri" }); return; }
  try {
    const result = await db.transaction(async (tx) => {
      const [actor] = await tx.select().from(usersTable).where(eq(usersTable.id, actorId)).for("update").limit(1);
      if (!actor || actor.accountStatus !== "active" || !["owner", "super_admin"].includes(actor.role)) {
        return { status: 403, error: "Akses ditolak" };
      }
      const [target] = await tx.select().from(usersTable).where(eq(usersTable.id, targetId)).for("update").limit(1);
      if (!target) return { status: 404, error: "Pengguna tidak ditemukan" };
      if (!canEditRole({ id: actor.id, role: actor.role, status: actor.accountStatus ?? "" }, { id: target.id, role: target.role }, role)) {
        return { status: 403, error: "Perubahan jabatan ini tidak diizinkan" };
      }
      if (target.role === role) return { status: 200, role, changed: false };
      const [updated] = await tx.update(usersTable)
        .set({ role: role as Role, updatedAt: new Date() })
        .where(eq(usersTable.id, targetId)).returning({ role: usersTable.role });
      await tx.insert(auditLogsTable).values({
        userId: actorId, userName: actor.name, userRole: actor.role,
        action: "user_role_changed", entity: "user", entityId: target.id,
        before: { role: target.role }, after: { role: updated.role },
        ipAddress: req.ip ?? null, userAgent: req.get("user-agent") ?? null,
      });
      return { status: 200, role: updated.role, changed: true };
    });
    if (result.status !== 200) { res.status(result.status).json({ error: result.error }); return; }
    res.json({ success: true, role: result.role, changed: result.changed });
  } catch (error) {
    req.log.error({ error }, "Role update failed");
    res.status(500).json({ error: "Gagal mengubah jabatan" });
  }
});

export default router;
