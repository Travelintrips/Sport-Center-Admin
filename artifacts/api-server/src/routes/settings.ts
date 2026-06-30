import { Router } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import multer from "multer";
import path from "path";
import { randomUUID } from "crypto";
import { deleteFromStorage } from "../lib/supabaseStorage";
import { uploadFile, BUCKETS } from "../lib/storage";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files allowed"));
  },
});

async function getOrCreateSettings() {
  const [settings] = await db.select().from(settingsTable).limit(1);
  if (settings) return settings;
  const [newSettings] = await db.insert(settingsTable).values({
    centerName: "PT Cahaya Sejati Teknologi",
    address: "Cabang Soekarno Hatta",
    phone: "+62 21 1234567",
    whatsapp: "6281234567890",
    email: "info@sportcenter.com",
    openHour: "06:00",
    closeHour: "22:00",
    bankName: "BCA",
    bankAccount: "1234567890",
    bankAccountName: "PT Cahaya Sejati Teknologi",
    paymentDeadlineHours: "24",
  }).returning();
  return newSettings;
}

router.get("/settings", async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    res.json(settings);
  } catch (err) {
    req.log.error({ err }, "Get settings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/settings", adminMiddleware, async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    const allowed = [
      "centerName","address","phone","whatsapp","email",
      "openHour","closeHour","logoUrl","bankName","bankAccount","bankAccountName",
      "fonnteToken","fonnteAdminWa","adminWaPhones","appUrl","paymentDeadlineHours",
    ];
    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        patch[key] = req.body[key] ?? null;
      }
    }
    if (Object.keys(patch).length > 0) {
      await db.update(settingsTable).set(patch).where(eq(settingsTable.id, settings.id));
    }
    const [updated] = await db.select().from(settingsTable).where(eq(settingsTable.id, settings.id)).limit(1);
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Update settings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/settings/qris", adminMiddleware, upload.single("qris"), async (req, res) => {
  try {
    if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
    const settings = await getOrCreateSettings();
    if (settings.qrisImageUrl) {
      await deleteFromStorage(settings.qrisImageUrl);
    }
    const ext = path.extname(req.file.originalname).toLowerCase() || ".png";
    const objectPath = `qris/qris-${randomUUID()}${ext}`;
    const qrisImageUrl = await uploadFile(
      BUCKETS.facility,
      objectPath,
      req.file.buffer,
      req.file.mimetype,
    );
    await db.update(settingsTable).set({ qrisImageUrl }).where(eq(settingsTable.id, settings.id));
    res.json({ qrisImageUrl });
  } catch (err) {
    req.log.error({ err }, "Upload QRIS error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/settings/qris", adminMiddleware, async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    if (settings.qrisImageUrl) {
      await deleteFromStorage(settings.qrisImageUrl);
    }
    await db.update(settingsTable).set({ qrisImageUrl: null }).where(eq(settingsTable.id, settings.id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete QRIS error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
