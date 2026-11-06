import { Router } from "express";
import {
  db,
  bookingsTable,
  facilitiesTable,
  paymentsTable,
  bookingHistoryTable,
  settingsTable,
  waBookingSessionsTable,
  auditLogsTable,
} from "@workspace/db";
import { eq, and, desc, or, sql, ilike } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { logAudit, logAccountingError } from "../lib/auditLog";
import { extractBookingDpp, postConfirmedPaymentAccounting } from "../lib/accounting";
import { createWaToken } from "../lib/waTokens";
import {
  notifyWaBookingApproved,
  notifyWaBookingRejectedByAdmin,
  notifyWaBookingConfirmed,
  notifyWaStaffCheckin,
  notifyPaymentConfirmed,
  sendWAToAdmins,
} from "../lib/notifications";
import { sendRekapPemakaianToAdmin } from "../lib/rekapPemakaian";
import { getBaseUrl } from "../lib/appUrl";
import { ensurePaymentBankAccount, resolveRequiredPaymentEnrichment } from "../lib/paymentEnrichment";
import { createPaymentProviderId, createPaymentProviderOrderId, normalizeProviderName } from "../lib/paymentMetadata";
import { resolveGymGuestName } from "../services/x904GymGuestNameRouting";
import { autoReserveVisAfterFundsVerified, returnVerifiedVisCard, VisReservationError } from "../services/x904GymVisitorCardReservations";
import { notifyGymVisitorCardReserved } from "../lib/notifications";

const router = Router();

function formatIDR(n: number): string {
  return "Rp " + n.toLocaleString("id-ID");
}

// ─── GET /api/admin/wa-bookings ───────────────────────────────────────────────
router.get("/admin/wa-bookings", adminMiddleware, async (req, res) => {
  const { status, source = "all", search, page = "1", limit = "30" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, parseInt(limit) || 30);
  const offset = (pageNum - 1) * limitNum;

  const conditions: ReturnType<typeof eq>[] = [
    or(
      eq(bookingsTable.source, "whatsapp_chat"),
      eq(bookingsTable.source, "whatsapp"),
      eq(bookingsTable.source, "gym_public_guest")
    ) as any,
  ];
  // Filters are intersected with the allowlist above: never expose unrelated admin bookings.
  if (source === "wa") {
    conditions.push(or(eq(bookingsTable.source, "whatsapp_chat"), eq(bookingsTable.source, "whatsapp")) as any);
  } else if (source === "gym_public_guest") {
    conditions.push(eq(bookingsTable.source, "gym_public_guest"));
  }
  if (status && status !== "all") {
    conditions.push(eq(bookingsTable.status, status as any));
  }
  if (search) {
    const like = `%${search}%`;
    conditions.push(
      or(
        ilike(bookingsTable.customerName, like),
        ilike(bookingsTable.customerPhone, like),
        ilike(bookingsTable.orderNumber, like)
      ) as any
    );
  }

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: bookingsTable.id,
        orderNumber: bookingsTable.orderNumber,
        customerName: bookingsTable.customerName,
        customerPhone: bookingsTable.customerPhone,
        facilityId: bookingsTable.facilityId,
        facilityName: facilitiesTable.name,
        bookingDate: bookingsTable.bookingDate,
        startTime: bookingsTable.startTime,
        endTime: bookingsTable.endTime,
        durationHours: bookingsTable.durationHours,
        totalPrice: bookingsTable.totalPrice,
        grandTotal: bookingsTable.grandTotal,
        status: bookingsTable.status,
        source: bookingsTable.source,
        adminNotes: bookingsTable.adminNotes,
        approvedByAdminPhone: bookingsTable.approvedByAdminPhone,
        approvedAt: bookingsTable.approvedAt,
        rejectedReason: bookingsTable.rejectedReason,
        paidAt: bookingsTable.paidAt,
        paymentDeadline: bookingsTable.paymentDeadline,
        createdAt: bookingsTable.createdAt,
        updatedAt: bookingsTable.updatedAt,
      })
      .from(bookingsTable)
      .leftJoin(facilitiesTable, eq(bookingsTable.facilityId, facilitiesTable.id))
      .where(and(...conditions))
      .orderBy(desc(bookingsTable.createdAt))
      .limit(limitNum)
      .offset(offset),

    db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(bookingsTable)
      .where(and(...conditions)),
  ]);

  const total = totals[0]?.total ?? 0;
  res.json({ bookings: rows, total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) });
});

// ─── GET /api/admin/wa-bookings/:orderNumber/detail ───────────────────────────
router.get("/admin/wa-bookings/:orderNumber/detail", adminMiddleware, async (req, res) => {
  const orderNumber = String(req.params.orderNumber);
  const [booking] = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.orderNumber, orderNumber))
    .limit(1);
  if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }

  const [facility] = await db
    .select()
    .from(facilitiesTable)
    .where(eq(facilitiesTable.id, booking.facilityId))
    .limit(1);

  const session = await db
    .select()
    .from(waBookingSessionsTable)
    .where(eq(waBookingSessionsTable.phone, booking.customerPhone))
    .orderBy(desc(waBookingSessionsTable.createdAt))
    .limit(1);

  const history = await db
    .select()
    .from(bookingHistoryTable)
    .where(eq(bookingHistoryTable.bookingId, booking.id))
    .orderBy(bookingHistoryTable.createdAt);

  const logs = await db
    .select()
    .from(auditLogsTable)
    .where(and(eq(auditLogsTable.entity, "booking"), eq(auditLogsTable.entityId, booking.id)))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(30);

  // Admin-only identity detail. Never expose the matched PIN/UID in
  // public booking notes, the public name-preview, or order-status endpoints.
  const x904IdentityMatch = booking.source === "gym_public_guest"
    ? await resolveGymGuestName(booking.customerName).catch(() => null)
    : null;

  // Operator-only linked ordinary PIN access state. Never returned by public
  // booking endpoints; VIS card allocation and return logic remain separate.
  let x904PinGrant: {
    accessId: number; userPin: string; deviceUid: number; verifiedName: string;
    accessState: string; verificationState: string; paymentStatus: string | null;
  } | null = null;
  if (booking.source === "gym_public_guest") {
    const linked = await db.execute(sql`SELECT a.access_id,a.user_pin,a.device_uid,a.verified_name,
        a.access_state,a.verification_state,p.status::text AS payment_status
      FROM sport_center.x904_nonmember_daily_access a
      LEFT JOIN sport_center.sport_payments p ON p.id=a.payment_id AND p.booking_id=a.booking_id
      WHERE a.booking_id=${booking.id} AND a.identity_type='pin'
        AND a.device_serial='TDBD234200545' LIMIT 1`);
    if (linked.rows.length === 1) {
      const row = linked.rows[0] as any;
      x904PinGrant = {
        accessId: Number(row.access_id), userPin: String(row.user_pin),
        deviceUid: Number(row.device_uid), verifiedName: String(row.verified_name),
        accessState: String(row.access_state), verificationState: String(row.verification_state),
        paymentStatus: row.payment_status == null ? null : String(row.payment_status),
      };
    }
  }

  let visCardReservation: { cardCode: string; state: string } | null = null;
  if (booking.source === "gym_public_guest") {
    try {
      const reservations = await db.execute(sql`SELECT card_code,state
        FROM sport_center.gym_vis_card_reservations
        WHERE booking_id=${booking.id} LIMIT 1`);
      if (reservations.rows.length === 1) {
        visCardReservation = {
          cardCode: String(reservations.rows[0].card_code),
          state: String(reservations.rows[0].state),
        };
      }
    } catch (error) {
      console.warn("[gym-vis] admin reservation lookup unavailable", error);
    }
  }
  res.json({
    booking,
    visCardReservation,
    x904PinGrant,
    x904IdentityMatch: x904IdentityMatch?.route === "registered"
      ? {
          route: "registered",
          userPin: x904IdentityMatch.userPin,
          deviceUid: x904IdentityMatch.deviceUid,
          displayName: x904IdentityMatch.displayName,
          ownershipVerified: false,
        }
      : { route: x904IdentityMatch?.route ?? "staff_review", userPin: null, deviceUid: null, ownershipVerified: false },
    facility: facility ?? null,
    session: session[0] ?? null,
    messages: (session[0] as any)?.messages ?? [],
    history,
    auditLogs: logs,
  });
});

// ─── POST /api/admin/wa-bookings/:orderNumber/approve ─────────────────────────
router.post("/admin/wa-bookings/:orderNumber/approve", adminMiddleware, async (req, res) => {
  const orderNumber = String(req.params.orderNumber);
  const adminUser = (req as any).user;
  const adminName = adminUser?.email ?? "admin";

  const [booking] = await db.select().from(bookingsTable)
    .where(eq(bookingsTable.orderNumber, orderNumber)).limit(1);
  if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }
  if (booking.status !== "waiting_admin_approval") {
    res.status(400).json({ error: `Status tidak valid: ${booking.status}` }); return;
  }

  const [facility] = await db.select().from(facilitiesTable)
    .where(eq(facilitiesTable.id, booking.facilityId)).limit(1);
  const [settings] = await db.select().from(settingsTable).limit(1);
  const paymentDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await db.update(bookingsTable).set({
    status: "pending_payment",
    paymentDeadline,
    approvedByAdminPhone: adminName,
    approvedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(bookingsTable.id, booking.id));

  await db.insert(bookingHistoryTable).values({
    bookingId: booking.id,
    fromStatus: "waiting_admin_approval",
    toStatus: "pending_payment",
    changedByName: adminName,
    note: "Booking disetujui admin via BizPortal. Customer diminta melakukan pembayaran.",
  });

  const proofToken = await createWaToken(booking.id, "upload_proof", 7);
  const deadlineStr = paymentDeadline.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", hour12: false });
  const amountToPay = Number(booking.grandTotal ?? booking.totalPrice);

  notifyWaBookingApproved({
    customerName: booking.customerName,
    customerPhone: booking.customerPhone,
    orderNumber: booking.orderNumber,
    facilityName: facility?.name ?? "",
    bookingDate: booking.bookingDate,
    startTime: booking.startTime,
    endTime: booking.endTime,
    totalPrice: amountToPay.toLocaleString("id-ID"),
    paymentDeadline: deadlineStr,
    statusUrl: `${await getBaseUrl()}/status/${booking.orderNumber}`,
    uploadProofUrl: `${await getBaseUrl()}/bukti/${proofToken}`,
    bankName: settings?.bankName ?? "",
    bankAccount: settings?.bankAccount ?? "",
    bankAccountName: settings?.bankAccountName ?? "",
  });

  // ─── Kirim rekap pemakaian Sport Center ke grup admin setelah approve ───
  (async () => {
    try {
      await sendRekapPemakaianToAdmin(booking.bookingDate);
      console.log("[SPORT CENTER REKAP] Rekap pemakaian berhasil dikirim");
    } catch (err) {
      console.error("[SPORT CENTER REKAP] Gagal kirim rekap pemakaian", err);
    }
  })();

  await logAudit({
    action: "admin_approved_via_wa",
    entity: "booking",
    entityId: booking.id,
    before: { status: "waiting_admin_approval" },
    after: { status: "pending_payment", approvedBy: adminName },
    userName: adminName,
  });

  res.json({ success: true, status: "pending_payment" });
});

// ─── POST /api/admin/wa-bookings/:orderNumber/reject ─────────────────────────
router.post("/admin/wa-bookings/:orderNumber/reject", adminMiddleware, async (req, res) => {
  const orderNumber = String(req.params.orderNumber);
  const { reason = "" } = req.body;
  const adminUser = (req as any).user;
  const adminName = adminUser?.email ?? "admin";

  const [booking] = await db.select().from(bookingsTable)
    .where(eq(bookingsTable.orderNumber, orderNumber)).limit(1);
  if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }
  if (["cancelled", "rejected", "refunded", "completed"].includes(booking.status)) {
    res.status(400).json({ error: `Status tidak valid: ${booking.status}` }); return;
  }

  const [facility] = await db.select({ name: facilitiesTable.name })
    .from(facilitiesTable).where(eq(facilitiesTable.id, booking.facilityId)).limit(1);

  await db.update(bookingsTable).set({
    status: "rejected",
    adminNotes: reason || null,
    rejectedReason: reason || null,
    updatedAt: new Date(),
  }).where(eq(bookingsTable.id, booking.id));

  await db.insert(bookingHistoryTable).values({
    bookingId: booking.id,
    fromStatus: booking.status,
    toStatus: "rejected",
    changedByName: adminName,
    note: reason ? `Ditolak admin via BizPortal. Alasan: ${reason}` : "Ditolak admin via BizPortal.",
  });

  notifyWaBookingRejectedByAdmin({
    customerPhone: booking.customerPhone,
    customerName: booking.customerName,
    orderNumber: booking.orderNumber,
    facilityName: facility?.name ?? "",
    bookingDate: booking.bookingDate,
    startTime: booking.startTime,
    endTime: booking.endTime,
    reason,
  });

  await logAudit({
    action: "admin_rejected_via_wa",
    entity: "booking",
    entityId: booking.id,
    before: { status: booking.status },
    after: { status: "rejected", reason },
    userName: adminName,
  });

  res.json({ success: true, status: "rejected" });
});

// ─── POST /api/admin/wa-bookings/:orderNumber/paid ────────────────────────────
router.post("/admin/wa-bookings/:orderNumber/paid", adminMiddleware, async (req, res) => {
  const orderNumber = String(req.params.orderNumber);
  const adminUser = (req as any).user;
  const adminName = adminUser?.email ?? "admin";

  const [booking] = await db.select().from(bookingsTable)
    .where(eq(bookingsTable.orderNumber, orderNumber)).limit(1);
  if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }
  // A public Gym guest is a booking only, not a verified X904 entitlement.
  // Do not allow this legacy WA one-click paid action to create a payment
  // with no supporting proof and independent fund verification.
  if (booking.source === "gym_public_guest") {
    res.status(409).json({
      error: "Booking Gym mandiri wajib diverifikasi melalui menu Booking Admin. Tombol Lunas cepat WA tidak tersedia untuk booking ini.",
    }); return;
  }
  if (!["pending_payment", "waiting_confirmation", "waiting_admin_approval"].includes(booking.status)) {
    res.status(400).json({ error: `Status tidak valid untuk mark paid: ${booking.status}` }); return;
  }

  const [facility] = await db.select().from(facilitiesTable)
    .where(eq(facilitiesTable.id, booking.facilityId)).limit(1);

  const [existingPay] = await db.select().from(paymentsTable)
    .where(eq(paymentsTable.bookingId, booking.id)).limit(1);
  let paymentForAccounting = existingPay;
  if (existingPay) {
    paymentForAccounting = await ensurePaymentBankAccount(existingPay, booking);
    await db.update(paymentsTable).set({ status: "confirmed", confirmedAt: new Date() })
      .where(eq(paymentsTable.bookingId, booking.id));
  } else {
    const paymentEnrichment = await resolveRequiredPaymentEnrichment(booking, "unknown", new Date());
    const [createdPayment] = await db.insert(paymentsTable).values({
      bookingId: booking.id,
      amount: String(Number(booking.grandTotal ?? booking.totalPrice)),
      paymentMethod: "Manual (Admin BizPortal)",
      paymentProvider: "unknown",
      providerName: normalizeProviderName("unknown"),
      providerId: createPaymentProviderId("unknown", `bizportal-admin-${booking.id}`),
      providerOrderId: createPaymentProviderOrderId("unknown", `bizportal-admin-order-${booking.id}`),
      companyId: paymentEnrichment.companyId,
      bankAccountId: paymentEnrichment.bankAccountId,
      expectedSettlementDate: paymentEnrichment.expectedSettlementDate,
      paidAt: paymentEnrichment.paidAt,
      status: "confirmed",
      confirmedAt: new Date(),
    }).returning();
    paymentForAccounting = createdPayment;
  }

  await db.update(bookingsTable).set({
    status: "confirmed",
    paidAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(bookingsTable.id, booking.id));

  await db.insert(bookingHistoryTable).values({
    bookingId: booking.id,
    fromStatus: booking.status,
    toStatus: "confirmed",
    changedByName: adminName,
    note: "Pembayaran dikonfirmasi dan booking disetujui via BizPortal.",
  });

  const checkinToken = await createWaToken(booking.id, "checkin", 30);
  const finishToken = await createWaToken(booking.id, "finish", 30);

  notifyPaymentConfirmed({
    customerName: booking.customerName,
    customerPhone: booking.customerPhone,
    orderNumber: booking.orderNumber,
    facilityName: facility?.name ?? "",
    bookingDate: booking.bookingDate,
    startTime: booking.startTime,
    endTime: booking.endTime,
    totalPrice: Number(booking.totalPrice).toLocaleString("id-ID"),
    bookingId: booking.id,
  }).catch((err) => console.error("[WA] notifyPaymentConfirmed error:", err));

  notifyWaStaffCheckin({
    orderNumber: booking.orderNumber,
    customerName: booking.customerName,
    facilityName: facility?.name ?? "",
    bookingDate: booking.bookingDate,
    startTime: booking.startTime,
    endTime: booking.endTime,
    checkinUrl: `${await getBaseUrl()}/wa/action/${checkinToken}`,
    finishUrl: `${await getBaseUrl()}/wa/action/${finishToken}`,
  }).catch((err) => console.error("[WA] notifyWaStaffCheckin error:", err));

  await logAudit({
    action: "admin_paid_via_wa",
    entity: "booking",
    entityId: booking.id,
    before: { status: booking.status },
    after: { status: "confirmed", paidAt: new Date() },
    userName: adminName,
  });

  const today = new Date().toISOString().split("T")[0];
  const {
    dpp,
    ppnAmount,
    ppnCollectedByCustomer,
  } = extractBookingDpp(booking);
  const paymentMethod = existingPay?.paymentMethod ?? "Transfer Bank";
  postConfirmedPaymentAccounting({
    bookingId: booking.id,
    orderNumber: booking.orderNumber,
    dpp,
    ppnAmount,
    ppnRate: booking.ppnRate == null ? null : Number(booking.ppnRate),
    ppnTreatment: booking.ppnTreatment,
    ppnCollectedByCustomer,
    facilityId: booking.facilityId,
    journalDate: today,
    paymentMethod,
    paymentId: paymentForAccounting?.id,
  }).catch((err) =>
    logAccountingError({ operation: "postConfirmedPaymentAccounting", orderNumber: booking.orderNumber, bookingId: booking.id, error: err }),
  );

  res.json({ success: true, status: "confirmed" });
});

// ─── POST /api/admin/wa-bookings/:orderNumber/resend ─────────────────────────
router.post("/admin/wa-bookings/:orderNumber/resend", adminMiddleware, async (req, res) => {
  const orderNumber = String(req.params.orderNumber);
  const adminUser = (req as any).user;
  const adminName = adminUser?.email ?? "admin";

  const [booking] = await db.select().from(bookingsTable)
    .where(eq(bookingsTable.orderNumber, orderNumber)).limit(1);
  if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }

  const [facility] = await db.select().from(facilitiesTable)
    .where(eq(facilitiesTable.id, booking.facilityId)).limit(1);
  const [settings] = await db.select().from(settingsTable).limit(1);
  const amountToPay = Number(booking.grandTotal ?? booking.totalPrice);
  let sentTo = "";

  if (booking.status === "waiting_admin_approval") {
    const adminWaRaw = settings?.adminWaPhones ?? process.env.ADMIN_WA_PHONES ?? "";
    const adminList = adminWaRaw.split(",").map((p: string) => p.trim().replace(/\D/g, "").replace(/^0/, "62")).filter(Boolean);
    const msg =
      `🏅 *Booking WA Menunggu Persetujuan (Resend)*\n\n` +
      `Order: *${booking.orderNumber}*\nCustomer: *${booking.customerName}* (${booking.customerPhone})\n` +
      `Fasilitas: *${facility?.name ?? ""}*\nTanggal: *${booking.bookingDate}* pukul *${booking.startTime}–${booking.endTime}*\n` +
      `Total: *${formatIDR(amountToPay)}*\n\n` +
      `Ketik *APPROVE ${booking.orderNumber}* untuk menyetujui\nKetik *REJECT ${booking.orderNumber} [alasan]* untuk menolak`;
    await sendWAToAdmins(msg);
    sentTo = `admins (${adminList.length})`;
  } else if (booking.status === "pending_payment") {
    const proofToken = await createWaToken(booking.id, "upload_proof", 7);
    const deadline = booking.paymentDeadline
      ? new Date(booking.paymentDeadline).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", hour12: false })
      : "-";
    notifyWaBookingApproved({
      customerName: booking.customerName,
      customerPhone: booking.customerPhone,
      orderNumber: booking.orderNumber,
      facilityName: facility?.name ?? "",
      bookingDate: booking.bookingDate,
      startTime: booking.startTime,
      endTime: booking.endTime,
      totalPrice: amountToPay.toLocaleString("id-ID"),
      paymentDeadline: deadline,
      statusUrl: `${await getBaseUrl()}/status/${booking.orderNumber}`,
      uploadProofUrl: `${await getBaseUrl()}/bukti/${proofToken}`,
      bankName: settings?.bankName ?? "",
      bankAccount: settings?.bankAccount ?? "",
      bankAccountName: settings?.bankAccountName ?? "",
    });
    sentTo = "customer (instruksi pembayaran)";
  } else if (booking.status === "confirmed") {
    notifyWaBookingConfirmed({
      customerName: booking.customerName,
      customerPhone: booking.customerPhone,
      orderNumber: booking.orderNumber,
      facilityName: facility?.name ?? "",
      bookingDate: booking.bookingDate,
      startTime: booking.startTime,
      endTime: booking.endTime,
      totalPrice: Number(booking.totalPrice).toLocaleString("id-ID"),
      statusUrl: `${await getBaseUrl()}/status/${booking.orderNumber}`,
    });
    sentTo = "customer (konfirmasi booking)";
  } else {
    res.status(400).json({ error: `Tidak bisa resend untuk status: ${booking.status}` }); return;
  }

  await logAudit({
    action: "payment_link_sent",
    entity: "booking",
    entityId: booking.id,
    after: { orderNumber, resendTo: sentTo, resendBy: adminName },
    userName: adminName,
  });

  res.json({ success: true, sentTo });
});

// Staff verifies an official bank transaction; VIS card selection is atomic
// and automatic. No X904 door command or grant is created here.
router.post("/admin/wa-bookings/:orderNumber/auto-allocate-vis", adminMiddleware, async (req, res) => {
  const admin = (req as any).user;
  const adminEmail = String(admin?.email ?? "").trim();
  if (!adminEmail) { res.status(403).json({ error: "Identitas admin tidak tersedia." }); return; }
  try {
    const assigned = await autoReserveVisAfterFundsVerified({
      orderNumber: String(req.params.orderNumber),
      officialBankReference: String(req.body?.officialBankReference ?? ""),
      officialFundsChecked: req.body?.officialFundsChecked === true,
      verifiedBy: adminEmail,
    });
    if (assigned.newReservation) {
      const [booking] = await db.select().from(bookingsTable)
        .where(eq(bookingsTable.orderNumber, String(req.params.orderNumber))).limit(1);
      if (booking) {
        await logAudit({
          action: "gym_guest_vis_card_auto_reserved", entity: "booking", entityId: booking.id,
          userName: adminEmail,
          after: { cardCode: assigned.cardCode, state: assigned.state, payment: "official_bank_attested" },
        });
        const statusUrl = `${await getBaseUrl()}/status/${booking.orderNumber}`;
        // Failure of WhatsApp dispatch must never duplicate the reservation.
        notifyGymVisitorCardReserved({
          bookingId: booking.id, orderNumber: booking.orderNumber,
          customerName: booking.customerName, customerPhone: booking.customerPhone,
          cardCode: assigned.cardCode, statusUrl,
        }).catch(error => console.error("[gym-vis] customer notification failed",error));
      }
    }
    res.json({ success: true, cardCode: assigned.cardCode,
      state: assigned.state, alreadyReserved: !assigned.newReservation,
      message: "Kartu VIS dialokasikan otomatis. Pengunjung dapat melihatnya di tiket booking; kartu fisik diserahkan saat tiba." });
  } catch (error) {
    if (error instanceof VisReservationError) {
      res.status(error.status).json({ error: error.message, code: error.code }); return;
    }
    console.error("[gym-vis] auto allocation action failed",error);
    res.status(503).json({error:"Alokasi VIS gagal dan tidak ada perintah akses pintu yang diterbitkan."});
  }
});

router.post("/admin/wa-bookings/:orderNumber/return-vis", adminMiddleware, async (req, res) => {
  const actor = String((req as any).user?.email ?? "").trim();
  if (!actor) { res.status(403).json({ error: "Identitas petugas tidak tersedia." }); return; }
  try {
    const outcome = await returnVerifiedVisCard({
      orderNumber: String(req.params.orderNumber),
      physicalCardReturned: req.body?.physicalCardReturned === true,
      x904ReadbackChecked: req.body?.x904ReadbackChecked === true,
      returnedBy: actor,
    });
    const [booking] = await db.select().from(bookingsTable)
      .where(eq(bookingsTable.orderNumber,String(req.params.orderNumber))).limit(1);
    if (booking) await logAudit({
      action: "gym_guest_vis_card_returned", entity: "booking", entityId: booking.id,
      userName: actor, after: { cardCode: outcome.cardCode, returnState: outcome.state, x904ReadbackChecked: true },
    });
    res.json({ success: true, ...outcome });
  } catch (error) {
    if (error instanceof VisReservationError) {
      res.status(error.status).json({ error:error.message, code:error.code }); return;
    }
    res.status(503).json({ error:"Pengembalian kartu belum dapat diselesaikan." });
  }
});

export default router;
