import { Router } from "express";
import { db, notificationTemplatesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { logAudit, getClientInfo, getUserFromReq } from "../lib/auditLog";

const FONNTE_TOKEN = process.env.FONNTE_TOKEN || "";
const ADMIN_WA_PHONES = process.env.ADMIN_WA_PHONES || process.env.FONNTE_ADMIN_WA || "";

const router = Router();

router.get("/notification-templates", adminMiddleware, async (req, res) => {
  try {
    const templates = await db.select().from(notificationTemplatesTable);
    res.json(templates);
  } catch (err) {
    req.log.error({ err }, "List notification templates error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/notification-templates/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [before] = await db.select().from(notificationTemplatesTable).where(eq(notificationTemplatesTable.id, id)).limit(1);
    if (!before) { res.status(404).json({ error: "Not found" }); return; }

    const { name, body, subject, isActive } = req.body;
    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (body !== undefined) updateData.body = body;
    if (subject !== undefined) updateData.subject = subject;
    if (isActive !== undefined) updateData.isActive = isActive;
    updateData.updatedAt = new Date();

    const [updated] = await db.update(notificationTemplatesTable).set(updateData).where(eq(notificationTemplatesTable.id, id)).returning();

    await logAudit({
      ...getUserFromReq(req),
      action: "update_notification_template",
      entity: "notification_template",
      entityId: id,
      before,
      after: updated,
      ...getClientInfo(req),
    });

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Update notification template error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /notification-templates/send — manual WA blast ─────────────────────
router.post("/notification-templates/send", adminMiddleware, async (req, res) => {
  try {
    const { phone, message, target } = req.body;
    if (!FONNTE_TOKEN) {
      res.status(503).json({ error: "Fonnte token tidak dikonfigurasi" });
      return;
    }

    let phones: string[] = [];
    if (target === "admins") {
      phones = ADMIN_WA_PHONES.split(",").map((p) => p.trim()).filter(Boolean);
    } else if (phone) {
      const cleaned = String(phone).replace(/^0/, "62").replace(/\D/g, "");
      if (cleaned.length >= 10) phones = [cleaned];
    }

    if (!phones.length) {
      res.status(400).json({ error: "Nomor tujuan tidak valid" });
      return;
    }
    if (!message?.trim()) {
      res.status(400).json({ error: "Pesan tidak boleh kosong" });
      return;
    }

    const results: { phone: string; status: string; id?: number }[] = [];
    for (const p of phones) {
      try {
        const r = await fetch("https://api.fonnte.com/send", {
          method: "POST",
          headers: { Authorization: FONNTE_TOKEN, "Content-Type": "application/json" },
          body: JSON.stringify({ target: p, message: message.trim() }),
        });
        const data: any = await r.json();
        results.push({ phone: p, status: data.status ? "sent" : "failed", id: data.id?.[0] });
      } catch {
        results.push({ phone: p, status: "error" });
      }
    }

    res.json({ success: true, results });
  } catch (err) {
    req.log.error({ err }, "Send WA error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /notification-templates/fonnte-status ───────────────────────────────
router.get("/notification-templates/fonnte-status", adminMiddleware, async (req, res) => {
  try {
    if (!FONNTE_TOKEN) {
      res.json({ connected: false, error: "Token tidak dikonfigurasi" });
      return;
    }
    const r = await fetch("https://api.fonnte.com/device", {
      method: "POST",
      headers: { Authorization: FONNTE_TOKEN },
    });
    const data: any = await r.json();
    res.json({
      connected: data.status === true,
      device: data.device,
      deviceStatus: data.device_status,
      name: data.name,
      quota: data.quota,
      messages: data.messages,
      package: data.package,
      expired: data.expired,
      adminPhones: ADMIN_WA_PHONES.split(",").map((p) => p.trim()).filter(Boolean),
    });
  } catch (err) {
    res.status(500).json({ connected: false, error: "Gagal cek status Fonnte" });
  }
});

export default router;
