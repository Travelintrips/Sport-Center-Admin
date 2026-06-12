import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { createHmac } from "crypto";
import {
  verifySheetAccess,
  pushCustomersToSheet,
  pullCustomersFromSheet,
} from "../lib/googleSheets";
import { bookingsTable } from "@workspace/db";

async function generateCustomerCode(): Promise<string> {
  const allCodes = await db.select({ code: usersTable.customerCode }).from(usersTable);
  let max = 0;
  for (const r of allCodes) {
    const m = (r.code ?? "").match(/^SC-CUST-(\d+)$/);
    if (m) { const n = parseInt(m[1]); if (n > max) max = n; }
    const m2 = (r.code ?? "").match(/^C(\d+)$/);
    if (m2) { const n = parseInt(m2[1]); if (n > max) max = n; }
  }
  return `SC-CUST-${String(max + 1).padStart(6, "0")}`;
}

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
      res.json({ ok: true, updatedCount: 0, skippedCount: 0, createdCount: 0 });
      return;
    }

    let updatedCount = 0;
    let skippedCount = 0;
    let createdCount = 0;
    const sessionSecret = process.env.SESSION_SECRET ?? "";

    for (const u of updates) {
      // Cari user yang sudah ada: 1) by ID, 2) by email, 3) by phone
      let existing: { id: number } | undefined;

      if (u.id) {
        const [r] = await db.select({ id: usersTable.id }).from(usersTable)
          .where(eq(usersTable.id, u.id)).limit(1);
        existing = r;
      }

      if (!existing && u.email) {
        const [r] = await db.select({ id: usersTable.id }).from(usersTable)
          .where(eq(usersTable.email, u.email)).limit(1);
        existing = r;
      }

      if (!existing && u.phone) {
        const [r] = await db.select({ id: usersTable.id }).from(usersTable)
          .where(eq(usersTable.phone, u.phone)).limit(1);
        existing = r;
      }

      if (existing) {
        const patch: Partial<typeof usersTable.$inferInsert> = {};
        if (u.name) patch.name = u.name;
        if (u.email !== undefined) patch.email = u.email || null;
        if (u.phone !== undefined) patch.phone = u.phone || null;
        if (u.accountStatus) patch.accountStatus = u.accountStatus;
        if (u.companyName !== undefined) patch.companyName = u.companyName || null;
        if (u.picName !== undefined) patch.picName = u.picName || null;
        if (u.picPhone !== undefined) patch.picPhone = u.picPhone || null;
        if (u.picEmail !== undefined) patch.picEmail = u.picEmail || null;
        if (u.accountType) patch.accountType = u.accountType as "personal" | "company";

        if (Object.keys(patch).length > 0) {
          patch.updatedAt = new Date();
          await db.update(usersTable).set(patch).where(eq(usersTable.id, existing.id));
          updatedCount++;
        } else {
          skippedCount++;
        }
        continue;
      }

      // Tidak ada match sama sekali → buat customer baru
      if (!u.name && !u.email && !u.phone) { skippedCount++; continue; }

      try {
        const customerCode = await generateCustomerCode();
        const randomPwd = Math.random().toString(36).slice(2, 12);
        const passwordHash = createHmac("sha256", sessionSecret).update(randomPwd).digest("hex");
        const acType = (u.accountType === "company" ? "company" : "personal") as "personal" | "company";

        await db.insert(usersTable).values({
          name: u.name ?? u.email ?? u.phone ?? "Customer",
          email: u.email || null,
          phone: u.phone || null,
          passwordHash,
          role: "customer",
          accountType: acType,
          accountStatus: u.accountStatus ?? "active",
          registrationSource: "sheet_import",
          customerCode,
          companyName: u.companyName ?? null,
          picName: u.picName ?? null,
          picPhone: u.picPhone ?? null,
          picEmail: u.picEmail ?? null,
        });
        createdCount++;
      } catch {
        skippedCount++;
      }
    }

    res.json({ ok: true, updatedCount, skippedCount, createdCount });
  } catch (err: any) {
    req.log.error({ err }, "Google Sheets pull error");
    res.status(400).json({ error: err?.message ?? "Gagal membaca dari Google Sheet" });
  }
});

export default router;
