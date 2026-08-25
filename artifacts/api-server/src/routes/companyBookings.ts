import { Router } from "express";
import { db, usersTable, companyUsersTable } from "@workspace/db";
import { eq, and, ilike, or } from "drizzle-orm";
import { authMiddleware } from "../lib/auth";
import { logAudit, getClientInfo } from "../lib/auditLog";

const router = Router();

// POST /api/company-bookings/prepare-customer
// Cari / buat customer, buat/cek company_users link, return billing status
router.post("/company-bookings/prepare-customer", authMiddleware, async (req, res) => {
  try {
    const { companyId, customerName, customerPhone, employeeId } = req.body;
    const loggedInUserId: number = (req as any).user.userId;
    const loggedInRole: string = (req as any).user.role;
    const isAdminBooking = loggedInRole === "admin_booking" || loggedInRole === "admin" || loggedInRole === "super_admin" || loggedInRole === "staff";
    const { ipAddress, userAgent } = getClientInfo(req);

    if (!companyId) {
      res.status(400).json({ error: "companyId wajib diisi" });
      return;
    }

    // Ambil data perusahaan
    const [company] = await db
      .select({ id: usersTable.id, name: usersTable.name, companyName: usersTable.companyName, allowMonthlyBilling: usersTable.allowMonthlyBilling, picPhone: usersTable.picPhone, picEmail: usersTable.picEmail, picName: usersTable.picName, accountStatus: usersTable.accountStatus })
      .from(usersTable)
      .where(and(eq(usersTable.id, Number(companyId)), eq(usersTable.accountType, "company")))
      .limit(1);

    if (!company) {
      res.status(404).json({ error: "Perusahaan tidak ditemukan" });
      return;
    }

    let customerId: number;
    let isNewCustomer = false;

    if (isAdminBooking && customerPhone) {
      // Admin booking: cari customer by phone, atau buat baru
      const cleanPhone = customerPhone.trim().replace(/\s/g, "");
      const [existingUser] = await db.select({ id: usersTable.id, name: usersTable.name })
        .from(usersTable)
        .where(or(eq(usersTable.phone, cleanPhone), ilike(usersTable.phone, cleanPhone)))
        .limit(1);

      if (existingUser) {
        customerId = existingUser.id;
      } else {
        // Buat customer baru dari nama + phone
        const [newUser] = await db.insert(usersTable).values({
          name: (customerName ?? "").trim() || cleanPhone,
          phone: cleanPhone,
          role: "customer",
          accountStatus: "active",
          registrationSource: "company_booking",
        }).returning({ id: usersTable.id });
        customerId = newUser.id;
        isNewCustomer = true;

        await logAudit({
          userId: loggedInUserId,
          action: "CUSTOMER_AUTO_CREATED_FROM_COMPANY_BOOKING",
          entity: "user",
          entityId: customerId,
          after: { name: customerName, phone: cleanPhone, companyId },
          ipAddress, userAgent,
        });
      }
    } else {
      // Regular customer: gunakan akun sendiri
      customerId = loggedInUserId;
    }

    // Cek company_users link yang sudah ada
    const effectiveEmployeeId = (employeeId || "").trim() || customerPhone?.replace(/\D/g, "") || String(customerId);
    const [existingLink] = await db.select()
      .from(companyUsersTable)
      .where(and(
        eq(companyUsersTable.companyId, Number(companyId)),
        eq(companyUsersTable.customerId, customerId),
      ))
      .limit(1);

    let companyUserId: number;
    let billingApproved = false;

    if (existingLink) {
      companyUserId = existingLink.id;
      billingApproved = existingLink.verificationStatus === "approved" && existingLink.corporateBillingEnabled && !!company.allowMonthlyBilling;
    } else {
      // Buat link baru dengan status pending
      const [newLink] = await db.insert(companyUsersTable).values({
        companyId: Number(companyId),
        customerId,
        employeeId: effectiveEmployeeId,
        verificationStatus: "pending",
        corporateBillingEnabled: false,
      }).returning({ id: companyUsersTable.id });
      companyUserId = newLink.id;

      await logAudit({
        userId: loggedInUserId,
        action: "COMPANY_USER_LINKED_FROM_BOOKING",
        entity: "company_user",
        entityId: companyUserId,
        after: { companyId, customerId, status: "pending", isNewCustomer },
        ipAddress, userAgent,
      });
    }

    res.json({
      customerId,
      companyUserId,
      billingApproved,
      companyName: company.companyName || company.name,
      picPhone: company.picPhone,
      isNewCustomer,
    });
  } catch (err) {
    (req as any).log?.error({ err }, "prepare-customer error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
