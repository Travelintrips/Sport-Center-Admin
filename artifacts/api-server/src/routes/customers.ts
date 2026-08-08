import { Router } from "express";
import { db, usersTable, bookingsTable } from "@workspace/db";
import { eq, or, ilike, isNull, isNotNull, desc } from "drizzle-orm";
import { adminMiddleware, authMiddleware } from "../lib/auth";
import { createHmac } from "crypto";
import { normalizePhone } from "./bookings";

const router = Router();

async function generateCustomerCode(): Promise<string> {
  const [last] = await db.select({ code: usersTable.customerCode }).from(usersTable)
    .where(isNotNull(usersTable.customerCode)).orderBy(desc(usersTable.customerCode)).limit(1);
  const lastNum = last?.code ? parseInt(last.code.replace("C", "")) || 0 : 0;
  return "C" + String(lastNum + 1).padStart(4, "0");
}

function mapUser(u: typeof usersTable.$inferSelect, userBookings: (typeof bookingsTable.$inferSelect)[]) {
  const totalSpent = userBookings
    .filter((b) => b.status !== "cancelled" && b.status !== "expired" && b.status !== "rejected" && b.status !== "refunded")
    .reduce((sum, b) => sum + (b.grandTotal != null ? Number(b.grandTotal) : Number(b.totalPrice)), 0);
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    customerCode: u.customerCode,
    registrationSource: u.registrationSource ?? "web",
    accountType: u.accountType ?? "personal",
    companyName: u.companyName,
    picName: u.picName,
    picPhone: u.picPhone,
    picEmail: u.picEmail,
    billingAddress: u.billingAddress,
    paymentTermsDays: u.paymentTermsDays,
    monthlyCreditLimit: u.monthlyCreditLimit != null ? Number(u.monthlyCreditLimit) : null,
    allowMonthlyBilling: u.allowMonthlyBilling,
    accountStatus: u.accountStatus ?? "active",
    totalBookings: userBookings.length,
    totalSpent,
    createdAt: u.createdAt,
  };
}

// Endpoint ringan — semua user login bisa akses (untuk dropdown pemilih pemesan)
// Gabungkan registered customers + past bookers dari tabel bookings (deduplikasi by phone)
router.get("/customers/simple", authMiddleware, async (req, res) => {
  try {
    // 1. Registered customers
    const registeredUsers = await db
      .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, phone: usersTable.phone, accountType: usersTable.accountType })
      .from(usersTable)
      .where(eq(usersTable.role, "customer"));

    // 2. Past bookers dari tabel bookings (yang tidak punya akun registered)
    const pastBookings = await db
      .selectDistinctOn([bookingsTable.customerPhone], {
        customerName: bookingsTable.customerName,
        customerEmail: bookingsTable.customerEmail,
        customerPhone: bookingsTable.customerPhone,
      })
      .from(bookingsTable)
      .orderBy(bookingsTable.customerPhone, bookingsTable.createdAt);

    // Gabungkan: registered users mendapat id, past bookers pakai id negatif (agar tidak bentrok)
    const registeredPhones = new Set(registeredUsers.map((u) => u.phone).filter(Boolean));
    const pastCustomers = pastBookings
      .filter((b) => b.customerPhone && !registeredPhones.has(b.customerPhone))
      .map((b, i) => ({
        id: -(i + 1),
        name: b.customerName,
        email: b.customerEmail,
        phone: b.customerPhone,
        accountType: "personal" as const,
      }));

    res.json([...registeredUsers, ...pastCustomers]);
  } catch (err) {
    req.log.error({ err }, "List customers simple error");
    res.status(500).json({ error: "Internal server error" });
  }
});

const INACTIVE = ["cancelled", "expired", "rejected", "refunded"];

router.get("/customers", adminMiddleware, async (req, res) => {
  try {
    const { search, accountType } = req.query;
    let users = await db.select().from(usersTable).where(eq(usersTable.role, "customer"));

    if (accountType === "company") {
      users = users.filter((u) => u.accountType === "company");
    } else if (accountType === "personal") {
      users = users.filter((u) => u.accountType !== "company");
    }

    const bookings = await db.select().from(bookingsTable);

    let result: ReturnType<typeof mapUser>[] = users.map((u) => {
      const userBookings = bookings.filter((b) => b.customerId === u.id || b.customerEmail === u.email || b.companyCustomerId === u.id);
      return mapUser(u, userBookings);
    });

    // Untuk tab personal: tambahkan guest bookers
    // Guest = booking tanpa customerId ATAU customerId mengarah ke user bukan role "customer"
    if (accountType !== "company") {
      const customerUserIds = new Set(users.map((u) => u.id));
      const registeredPhones = new Set(users.map((u) => u.phone).filter(Boolean));
      const seenPhones = new Set<string>();
      const guestEntries: ReturnType<typeof mapUser>[] = [];

      for (const b of bookings) {
        const phone = b.customerPhone;
        // Linked ke real customer → skip
        const linkedToRealCustomer = b.customerId != null && customerUserIds.has(b.customerId);
        if (!phone || seenPhones.has(phone) || registeredPhones.has(phone) || linkedToRealCustomer) continue;
        seenPhones.add(phone);
        const guestBookings = bookings.filter((bk) => bk.customerPhone === phone);
        const totalSpent = guestBookings
          .filter((bk) => !INACTIVE.includes(bk.status))
          .reduce((sum, bk) => sum + (bk.grandTotal != null ? Number(bk.grandTotal) : Number(bk.totalPrice)), 0);
        guestEntries.push({
          id: -(guestEntries.length + 1),
          name: b.customerName,
          email: b.customerEmail,
          phone,
          customerCode: null,
          registrationSource: "guest",
          accountType: "personal",
          companyName: null, picName: null, picPhone: null, picEmail: null,
          billingAddress: null, paymentTermsDays: null, monthlyCreditLimit: null,
          allowMonthlyBilling: false, accountStatus: "active",
          totalBookings: guestBookings.length,
          totalSpent,
          createdAt: b.createdAt,
        } as any);
      }
      result = [...result, ...guestEntries];
    }

    if (search) {
      const s = (search as string).toLowerCase();
      result = result.filter(
        (u) =>
          u.name.toLowerCase().includes(s) ||
          (u.email ?? "").toLowerCase().includes(s) ||
          (u.phone ?? "").includes(s) ||
          (u.customerCode ?? "").toLowerCase().includes(s) ||
          (u.companyName ?? "").toLowerCase().includes(s)
      );
    }

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "List customers error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/customers", adminMiddleware, async (req, res) => {
  try {
    const {
      name, email, phone, accountType,
      companyName, picName, picPhone, picEmail, billingAddress,
      paymentTermsDays, monthlyCreditLimit, allowMonthlyBilling, accountStatus
    } = req.body;

    if (!name || !email || !accountType) {
      res.status(400).json({ error: "name, email, accountType required" });
      return;
    }

    const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existing) { res.status(409).json({ error: "Email sudah digunakan" }); return; }

    const sessionSecret = process.env.SESSION_SECRET;
    if (!sessionSecret) {
      req.log.error("SESSION_SECRET env var tidak tersedia — tidak bisa membuat akun customer");
      res.status(500).json({ error: "Server configuration error: SESSION_SECRET not set" });
      return;
    }
    const randomPassword = name.trim().split(/\s+/)[0].toLowerCase() + "123";
    const passwordHash = createHmac("sha256", sessionSecret).update(randomPassword).digest("hex");

    const [user] = await db.insert(usersTable).values({
      name,
      email,
      phone: phone ?? null,
      passwordHash,
      role: "customer",
      accountType: accountType ?? "personal",
      companyName: companyName ?? null,
      picName: picName ?? null,
      picPhone: picPhone ?? null,
      picEmail: picEmail ?? null,
      billingAddress: billingAddress ?? null,
      paymentTermsDays: paymentTermsDays ?? 30,
      monthlyCreditLimit: monthlyCreditLimit ? String(monthlyCreditLimit) : null,
      allowMonthlyBilling: allowMonthlyBilling ?? false,
      accountStatus: accountStatus ?? "active",
    }).returning();

    res.status(201).json({ ...mapUser(user, []), tempPassword: randomPassword });
  } catch (err) {
    req.log.error({ err }, "Create customer error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Migrasi SEMUA booking lama (tanpa customerId) → buat akun customer otomatis
router.post("/customers/migrate-all-guests", adminMiddleware, async (req, res) => {
  try {
    const sessionSecret = process.env.SESSION_SECRET ?? "";
    // Ambil booking yang customerId null ATAU linked ke non-customer user (misal admin_booking)
    const allUsersRaw = await db.select({ id: usersTable.id, email: usersTable.email, phone: usersTable.phone, role: usersTable.role }).from(usersTable);
    const customerIds = new Set(allUsersRaw.filter(u => u.role === "customer").map(u => u.id));
    const allBookingsRaw = await db.select().from(bookingsTable);
    const allBookings = allBookingsRaw.filter(b => b.customerId == null || !customerIds.has(b.customerId));
    const allUsers = allUsersRaw;

    // Hanya index user dengan role="customer" untuk pencocokan
    const registeredEmails = new Map(allUsers.filter(u => u.email && u.role === "customer").map(u => [u.email!, u.id]));
    const registeredPhones = new Map(allUsers.filter(u => u.phone && u.role === "customer").map(u => [u.phone!, u.id]));

    // Group by phone (primary) atau email (fallback)
    const groups = new Map<string, typeof allBookings>();
    for (const b of allBookings) {
      const phone = b.customerPhone ? normalizePhone(b.customerPhone) : null;
      const key = phone ?? b.customerEmail;
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(b);
    }

    let created = 0, linked = 0, skipped = 0;

    for (const [key, bookings] of groups) {
      // Ambil data dari booking terbaru
      const latest = bookings.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())[0];
      const phone = latest.customerPhone ? normalizePhone(latest.customerPhone) : null;
      const email = latest.customerEmail || null;

      // Cari user yang sudah ada by phone atau email
      let existingId = (phone && registeredPhones.get(phone)) ?? (email && registeredEmails.get(email)) ?? null;

      if (existingId) {
        // Link semua booking ke user yang sudah ada
        for (const b of bookings) {
          await db.update(bookingsTable).set({ customerId: existingId }).where(eq(bookingsTable.id, b.id));
        }
        linked += bookings.length;
      } else {
        // Buat user baru
        try {
          // Hitung code customer
          const allCodes = await db.select({ code: usersTable.customerCode }).from(usersTable);
          let max = 0;
          for (const r of allCodes) {
            const m = (r.code ?? "").match(/^C(\d+)$/);
            if (m) { const n = parseInt(m[1]); if (n > max) max = n; }
          }
          const code = `C${String(max + 1).padStart(5, "0")}`;

          const randomPwd = Math.random().toString(36).slice(2, 10);
          const passwordHash = createHmac("sha256", sessionSecret).update(randomPwd).digest("hex");

          const [newUser] = await db.insert(usersTable).values({
            name: latest.customerName,
            email: email ?? null,
            phone: phone ?? null,
            passwordHash,
            role: "customer",
            accountType: "personal",
            accountStatus: "active",
            registrationSource: "booking_form",
            customerCode: code,
          }).returning();

          // Update registeredPhones/Emails agar group berikutnya tidak duplikat
          if (phone) registeredPhones.set(phone, newUser.id);
          if (email) registeredEmails.set(email, newUser.id);

          for (const b of bookings) {
            await db.update(bookingsTable).set({ customerId: newUser.id }).where(eq(bookingsTable.id, b.id));
          }
          created++;
        } catch {
          skipped++;
        }
      }
    }

    res.json({ created, linked, skipped, total: groups.size });
  } catch (err) {
    req.log.error({ err }, "Migrate all guests error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Konversi guest booker → akun customer terdaftar
router.post("/customers/from-guest", adminMiddleware, async (req, res) => {
  try {
    const { phone, name, email } = req.body;
    if (!phone) { res.status(400).json({ error: "phone required" }); return; }

    // Cek duplikat phone
    const [existingByPhone] = await db.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.phone, String(phone))).limit(1);
    if (existingByPhone) { res.status(409).json({ error: "Nomor HP sudah terdaftar sebagai akun customer" }); return; }

    if (email) {
      const [existingByEmail] = await db.select({ id: usersTable.id }).from(usersTable)
        .where(eq(usersTable.email, String(email))).limit(1);
      if (existingByEmail) { res.status(409).json({ error: "Email sudah digunakan" }); return; }
    }

    // Ambil data dari booking terbaru
    const [latestBooking] = await db.select().from(bookingsTable)
      .where(eq(bookingsTable.customerPhone, String(phone)))
      .orderBy(desc(bookingsTable.createdAt)).limit(1);
    if (!latestBooking) { res.status(404).json({ error: "Tidak ada booking dengan nomor ini" }); return; }

    const resolvedName = name || latestBooking.customerName;
    const resolvedEmail = email || latestBooking.customerEmail;

    if (!resolvedEmail) { res.status(400).json({ error: "email required — guest tidak memiliki email, harap isi manual" }); return; }

    const code = await generateCustomerCode();

    const sessionSecret = process.env.SESSION_SECRET ?? "";
    const randomPassword = resolvedName.trim().split(/\s+/)[0].toLowerCase() + "123";
    const passwordHash = createHmac("sha256", sessionSecret).update(randomPassword).digest("hex");

    const [newUser] = await db.insert(usersTable).values({
      name: resolvedName,
      email: resolvedEmail,
      phone: String(phone),
      passwordHash,
      role: "customer",
      accountType: "personal",
      accountStatus: "active",
      registrationSource: "guest_converted",
      customerCode: code,
    }).returning();

    // Link semua booking dengan phone ini ke akun baru
    await db.update(bookingsTable)
      .set({ customerId: newUser.id })
      .where(eq(bookingsTable.customerPhone, String(phone)));

    const allBookings = await db.select().from(bookingsTable).where(eq(bookingsTable.customerId, newUser.id));
    res.status(201).json({ ...mapUser(newUser, allBookings), tempPassword: randomPassword });
  } catch (err) {
    req.log.error({ err }, "Convert guest to customer error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/customers/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!user) { res.status(404).json({ error: "Not found" }); return; }
    const userBookings = await db.select().from(bookingsTable).where(
      or(eq(bookingsTable.customerId, id), eq(bookingsTable.companyCustomerId, id))
    );
    res.json(mapUser(user, userBookings));
  } catch (err) {
    req.log.error({ err }, "Get customer error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/customers/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    await db.delete(usersTable).where(eq(usersTable.id, id));
    res.json({ message: "Customer berhasil dihapus" });
  } catch (err) {
    req.log.error({ err }, "Delete customer error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/customers/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const {
      name, email, phone, accountType,
      companyName, picName, picPhone, picEmail, billingAddress,
      paymentTermsDays, monthlyCreditLimit, allowMonthlyBilling, accountStatus
    } = req.body;

    const updates: Partial<typeof usersTable.$inferInsert> = {};
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email;
    if (phone !== undefined) updates.phone = phone;
    if (accountType !== undefined) updates.accountType = accountType;
    if (companyName !== undefined) updates.companyName = companyName;
    if (picName !== undefined) updates.picName = picName;
    if (picPhone !== undefined) updates.picPhone = picPhone;
    if (picEmail !== undefined) updates.picEmail = picEmail;
    if (billingAddress !== undefined) updates.billingAddress = billingAddress;
    if (paymentTermsDays !== undefined) updates.paymentTermsDays = paymentTermsDays;
    if (monthlyCreditLimit !== undefined) updates.monthlyCreditLimit = monthlyCreditLimit ? String(monthlyCreditLimit) : null;
    if (allowMonthlyBilling !== undefined) updates.allowMonthlyBilling = allowMonthlyBilling;
    if (accountStatus !== undefined) updates.accountStatus = accountStatus;

    const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
    const userBookings = await db.select().from(bookingsTable).where(
      or(eq(bookingsTable.customerId, id), eq(bookingsTable.companyCustomerId, id))
    );
    res.json(mapUser(updated, userBookings));
  } catch (err) {
    req.log.error({ err }, "Update customer error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/customers/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [existing] = await db.select({ id: usersTable.id, role: usersTable.role })
      .from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.role === "admin") { res.status(403).json({ error: "Tidak bisa menghapus akun admin" }); return; }
    await db.update(bookingsTable).set({ customerId: null }).where(eq(bookingsTable.customerId, id));
    await db.delete(usersTable).where(eq(usersTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Delete customer error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
