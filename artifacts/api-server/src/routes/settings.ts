import { Router } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";

const router = Router();

async function getOrCreateSettings() {
  const [settings] = await db.select().from(settingsTable).limit(1);
  if (settings) return settings;
  const [newSettings] = await db.insert(settingsTable).values({
    centerName: "Sport Center",
    address: "Jl. Sport Center No. 1, Jakarta",
    phone: "+62 21 1234567",
    whatsapp: "6281234567890",
    email: "info@sportcenter.com",
    openHour: "06:00",
    closeHour: "22:00",
    bankName: "BCA",
    bankAccount: "1234567890",
    bankAccountName: "PT Sport Center",
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
    await db.update(settingsTable).set(req.body).where(eq(settingsTable.id, settings.id));
    const [updated] = await db.select().from(settingsTable).where(eq(settingsTable.id, settings.id)).limit(1);
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Update settings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
