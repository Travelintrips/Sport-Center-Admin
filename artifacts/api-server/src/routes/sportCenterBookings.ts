import { Router } from "express";
import { db, bookingsTable, facilitiesTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { generateBookingOrderNumber } from "../lib/orderNumber";
import {
  recordTaxTransaction,
  resolveCustomerTax,
  resolveWithholdingTax,
} from "../lib/tax";

const router = Router();

router.post("/sport-center/bookings", adminMiddleware, async (req, res) => {
  try {
    const { customerId, facilityId, startTime, endTime, duration, paymentMethod } = req.body;

    if (!customerId || !facilityId || !startTime || !duration) {
      res.status(400).json({ error: "customerId, facilityId, startTime, duration wajib diisi" });
      return;
    }

    const [customer] = await db
      .select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        phone: usersTable.phone,
        accountType: usersTable.accountType,
        requirePerBookingApproval: usersTable.requirePerBookingApproval,
      })
      .from(usersTable)
      .where(eq(usersTable.id, Number(customerId)))
      .limit(1);

    if (!customer) {
      res.status(404).json({ error: "Customer tidak ditemukan" });
      return;
    }

    const [facility] = await db
      .select()
      .from(facilitiesTable)
      .where(eq(facilitiesTable.id, Number(facilityId)))
      .limit(1);

    if (!facility) {
      res.status(404).json({ error: "Fasilitas tidak ditemukan" });
      return;
    }

    // Parse datetime-local ("2026-06-11T09:00") → bookingDate + startTime (HH:MM)
    const dt = new Date(startTime);
    const bookingDate = startTime.split("T")[0];
    const startHH = String(dt.getHours()).padStart(2, "0");
    const startMM = String(dt.getMinutes()).padStart(2, "0");
    const startTimeFormatted = `${startHH}:${startMM}`;

    const durationHours = Number(duration);
    const totalPrice = Number(facility.pricePerHour) * durationHours;
    const isCompany = customer.accountType === "company";
    const companyCustomerId = isCompany ? customer.id : null;
    const taxCalc = await resolveCustomerTax(totalPrice, {
      customerId: customer.id,
      companyCustomerId,
      bookingDate,
    });
    const pphCalc = await resolveWithholdingTax(
      companyCustomerId,
      taxCalc.grandTotal,
      taxCalc.dpp,
    );
    const orderNumber = await generateBookingOrderNumber();

    const endDt = new Date(dt.getTime() + durationHours * 60 * 60 * 1000);
    const endHH = String(endDt.getHours()).padStart(2, "0");
    const endMM = String(endDt.getMinutes()).padStart(2, "0");
    const endTimeFormatted = `${endHH}:${endMM}`;

    const [booking] = await db
      .insert(bookingsTable)
      .values({
        orderNumber,
        customerId: customer.id,
        customerName: customer.name,
        customerEmail: customer.email ?? "",
        customerPhone: customer.phone ?? "",
        facilityId: facility.id,
        bookingDate,
        startTime: startTimeFormatted,
        endTime: endTimeFormatted,
        durationHours,
        totalPrice: String(totalPrice),
        basePrice: String(totalPrice),
        discountAmount: "0",
        apDiscountAmount: "0",
        ppnRate: taxCalc.taxRate > 0 ? String(taxCalc.taxRate) : null,
        dpp: String(taxCalc.dpp),
        ppnAmount: String(taxCalc.taxAmount),
        grandTotal: String(taxCalc.grandTotal),
        ppnTreatment: taxCalc.ppnTreatment,
        ppnCollectedByCustomer: taxCalc.ppnCollectedByCustomer,
        pphRate: pphCalc.enabled ? String(pphCalc.rate) : null,
        pphAmount: pphCalc.enabled ? String(pphCalc.amount) : null,
        netAmount: String(pphCalc.netAmount),
        payerType: isCompany ? "company" : "personal",
        companyCustomerId,
        paymentRequiredNow: !isCompany,
        billingStatus: isCompany ? "unbilled" : null,
        bookedForName: isCompany ? (req.body.bookedForName?.trim() || customer.name) : null,
        bookedForPhone: isCompany ? (req.body.bookedForPhone?.trim() || customer.phone || null) : null,
        status: isCompany
          ? (customer.requirePerBookingApproval ? "waiting_confirmation" : "confirmed")
          : "pending_payment",
        notes: req.body.notes ?? null,
      })
      .returning();

    if (taxCalc.taxCode) {
      recordTaxTransaction("booking", booking.id, booking.orderNumber, taxCalc, bookingDate).catch(() => {});
    }

    req.log.info({ bookingId: booking.id, orderNumber }, "Admin walk-in booking created");
    res.status(201).json({ success: true, booking: { ...booking, totalPrice } });
  } catch (err) {
    req.log.error({ err }, "sport-center/bookings POST error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
