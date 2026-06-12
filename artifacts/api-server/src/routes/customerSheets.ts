import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import {
  verifySheetAccess,
  pushCustomersToSheet,
  pullCustomersFromSheet,
} from "../lib/googleSheets";
import { bookingsTable } from "@workspace/db";

const router = Router();

router.post("/customers/sheets/connect", adminMiddleware, async (req, res) => {
  try {
    const { sheetId } = req.body;
    if (!sheetId || typeof sheetId !== "string") {
      res.status(400).json({ error: "sheetId wajib diisi" });
      return;
    }
    const info = await verifySheetAccess(sheetId);
    res.json({ ok: true, title: info.title });
  } catch (err: any) {
    req.log.error({ err }, "Google Sheets connect error");
    res.status(400).json({ error: err?.message ?? "Tidak dapat mengakses sheet. Pastikan Service Account memiliki akses editor." });
  }
});

router.post("/customers/sheets/push", adminMiddleware, async (req, res) => {
  try {
    const { sheetId } = req.body;
    if (!sheetId || typeof sheetId !== "string") {
      res.status(400).json({ error: "sheetId wajib diisi" });
      return;
    }

    const users = await db.select().from(usersTable).where(eq(usersTable.role, "customer"));
    const bookings = await db.select().from(bookingsTable);

    const customers = users.map((u) => {
      const userBookings = bookings.filter(
        (b) => b.customerId === u.id || b.customerEmail === u.email || b.companyCustomerId === u.id
      );
      const totalSpent = userBookings
        .filter((b) => !["cancelled", "expired", "rejected", "refunded"].includes(b.status))
        .reduce((sum, b) => sum + Number(b.totalPrice), 0);
      return {
        id: u.id,
        customerCode: u.customerCode,
        name: u.name,
        email: u.email,
        phone: u.phone,
        accountType: u.accountType ?? "personal",
        companyName: u.companyName,
        picName: u.picName,
        picPhone: u.picPhone,
        picEmail: u.picEmail,
        accountStatus: u.accountStatus ?? "active",
        registrationSource: u.registrationSource ?? "web",
        totalBookings: userBookings.length,
        totalSpent,
        createdAt: u.createdAt,
      };
    });

    const result = await pushCustomersToSheet(sheetId, customers);
    res.json({ ok: true, updatedRows: result.updatedRows });
  } catch (err: any) {
    req.log.error({ err }, "Google Sheets push error");
    res.status(400).json({ error: err?.message ?? "Gagal menulis ke Google Sheet" });
  }
});

router.post("/customers/sheets/pull", adminMiddleware, async (req, res) => {
  try {
    const { sheetId } = req.body;
    if (!sheetId || typeof sheetId !== "string") {
      res.status(400).json({ error: "sheetId wajib diisi" });
      return;
    }

    const updates = await pullCustomersFromSheet(sheetId);
    if (!updates.length) {
      res.json({ ok: true, updatedCount: 0, skippedCount: 0 });
      return;
    }

    let updatedCount = 0;
    let skippedCount = 0;

    for (const u of updates) {
      const [existing] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, u.id))
        .limit(1);

      if (!existing) { skippedCount++; continue; }

      const patch: Partial<typeof usersTable.$inferInsert> = {};
      if (u.name) patch.name = u.name;
      if (u.email !== undefined) patch.email = u.email || null;
      if (u.phone !== undefined) patch.phone = u.phone || null;
      if (u.accountStatus) patch.accountStatus = u.accountStatus;
      if (u.companyName !== undefined) patch.companyName = u.companyName || null;
      if (u.picName !== undefined) patch.picName = u.picName || null;
      if (u.picPhone !== undefined) patch.picPhone = u.picPhone || null;
      if (u.picEmail !== undefined) patch.picEmail = u.picEmail || null;

      if (Object.keys(patch).length > 0) {
        patch.updatedAt = new Date();
        await db.update(usersTable).set(patch).where(eq(usersTable.id, u.id));
        updatedCount++;
      } else {
        skippedCount++;
      }
    }

    res.json({ ok: true, updatedCount, skippedCount });
  } catch (err: any) {
    req.log.error({ err }, "Google Sheets pull error");
    res.status(400).json({ error: err?.message ?? "Gagal membaca dari Google Sheet" });
  }
});

export default router;
