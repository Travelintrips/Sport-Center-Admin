import { Router } from "express";
import { db, usersTable, bookingsTable } from "@workspace/db";
import { eq, or, ilike } from "drizzle-orm";
import { adminMiddleware, authMiddleware } from "../lib/auth";
import { createHmac } from "crypto";

const router = Router();

function mapUser(u: typeof usersTable.$inferSelect, userBookings: (typeof bookingsTable.$inferSelect)[]) {
  const totalSpent = userBookings
    .filter((b) => b.status !== "cancelled" && b.status !== "expired" && b.status !== "rejected" && b.status !== "refunded")
    .reduce((sum, b) => sum + Number(b.totalPrice), 0);
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
      .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, phone: usersTable.phone })
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

    // Untuk tab personal: tambahkan guest bookers (tidak punya akun & phone tidak terdaftar)
    if (accountType !== "company") {
      const registeredPhones = new Set(users.map((u) => u.phone).filter(Boolean));
      const seenPhones = new Set<string>();
      const guestEntries: ReturnType<typeof mapUser>[] = [];

      for (const b of bookings) {
        const phone = b.customerPhone;
        if (!phone || seenPhones.has(phone) || registeredPhones.has(phone) || b.customerId) continue;
        seenPhones.add(phone);
        const guestBookings = bookings.filter((bk) => bk.customerPhone === phone);
        const totalSpent = guestBookings
          .filter((bk) => !INACTIVE.includes(bk.status))
          .reduce((sum, bk) => sum + Number(bk.totalPrice), 0);
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
    // Generate random password — admin perlu mengatur password via reset flow
    const randomPassword = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10).toUpperCase();
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
    const randomPassword = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10).toUpperCase();
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

export default router;
