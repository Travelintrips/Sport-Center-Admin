import { Router } from "express";
import {
  db,
  gymMembershipsTable,
  membershipPaymentsTable,
  publicMembershipsTable,
  gymCheckinsTable,
  bookingsTable,
  bookingHistoryTable,
  facilitiesTable,
} from "@workspace/db";
import { eq, and, ilike, desc, inArray, or } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { syncMembershipToBizportal, pushMembershipPaymentAsBankMutation } from "../lib/bizportalSync";
import { createMembershipJournalEntry, createPublicMembershipAccountingEntry } from "../lib/accounting";
import { logAccountingError } from "../lib/auditLog";
import { sendRekapPemakaianToAdmin } from "../lib/rekapPemakaian";
import { notifyMembershipPaymentProofUploaded } from "../lib/notifications";
import { getBaseUrl } from "../lib/appUrl";
import { generateBookingOrderNumber } from "../lib/orderNumber";

const router = Router();

const PRICE_PER_MONTH = 300000;

function addHours(time: string, hours: number): string {
  const [hour, minute] = time.split(":").map(Number);
  const totalMinutes = hour * 60 + (minute || 0) + hours * 60;
  const endHour = Math.floor(totalMinutes / 60) % 24;
  const endMinute = totalMinutes % 60;
  return `${String(endHour).padStart(2, "0")}:${String(endMinute).padStart(2, "0")}`;
}

async function syncToPublic(m: typeof gymMembershipsTable.$inferSelect) {
  try {
    await db
      .insert(publicMembershipsTable)
      .values({
        sourceId: m.id,
        name: m.name,
        email: m.email,
        phone: m.phone,
        startDate: m.startDate,
        endDate: m.endDate,
        months: m.months,
        totalPrice: m.totalPrice,
        status: m.status,
        notes: m.notes,
        paymentMethod: m.paymentMethod,
        paymentProofUrl: m.paymentProofUrl,
        source: "sport_center",
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      })
      .onConflictDoUpdate({
        target: publicMembershipsTable.sourceId,
        set: {
          name: m.name,
          email: m.email,
          phone: m.phone,
          startDate: m.startDate,
          endDate: m.endDate,
          months: m.months,
          totalPrice: m.totalPrice,
          status: m.status,
          notes: m.notes,
          paymentMethod: m.paymentMethod,
          paymentProofUrl: m.paymentProofUrl,
          updatedAt: m.updatedAt,
        },
      });
  } catch (err) {
    console.warn("[sync-public-memberships] Non-fatal sync error:", err);
  }
}

async function deleteFromPublic(sourceId: number) {
  try {
    await db.delete(publicMembershipsTable).where(eq(publicMembershipsTable.sourceId, sourceId));
  } catch (err) {
    console.warn("[sync-public-memberships] Non-fatal delete error:", err);
  }
}

// ─── Gym Check-in Endpoints ───────────────────────────────────────────────────

// POST /memberships/lookup — public, cari membership by phone atau name
router.post("/memberships/lookup", async (req, res) => {
  try {
    const phone = String(req.body?.phone || "").trim();
    const name  = String(req.body?.name  || "").trim();

    if (!phone && !name) {
      res.status(400).json({ error: "phone atau name wajib diisi" });
      return;
    }

    let rows: (typeof gymMembershipsTable.$inferSelect)[] = [];

    if (phone) {
      // Cari exact match by phone
      rows = await db.select().from(gymMembershipsTable).where(eq(gymMembershipsTable.phone, phone));
    } else {
      // Cari by nama (case-insensitive, partial match)
      rows = await db.select().from(gymMembershipsTable).where(ilike(gymMembershipsTable.name, `%${name}%`));
    }

    const candidates = rows
      .filter((m) => m.status !== "cancelled")
      .sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime());

    if (candidates.length === 0) {
      res.status(404).json({ error: "Membership tidak ditemukan" });
      return;
    }

    const result = candidates.map((m) => ({
      id: m.id,
      name: m.name,
      phone: m.phone,
      email: m.email,
      status: m.status,
      startDate: m.startDate,
      endDate: m.endDate,
      months: m.months,
      totalPrice: Number(m.totalPrice),
    }));

    // Jika cari by phone → kembalikan 1 hasil (backward compat); by name → array
    if (phone) {
      res.json(result[0]);
    } else {
      res.json(result);
    }
  } catch (err) {
    req.log.error({ err }, "Lookup membership error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /memberships/checkins?date=YYYY-MM-DD
router.get("/memberships/checkins", adminMiddleware, async (req, res) => {
  try {
    const date = String(req.query.date || new Date().toISOString().split("T")[0]);
    const checkins = await db
      .select({
        id: gymCheckinsTable.id,
        membershipId: gymCheckinsTable.membershipId,
        checkinDate: gymCheckinsTable.checkinDate,
        checkedInAt: gymCheckinsTable.checkedInAt,
        notes: gymCheckinsTable.notes,
        memberName: gymMembershipsTable.name,
        memberPhone: gymMembershipsTable.phone,
      })
      .from(gymCheckinsTable)
      .leftJoin(gymMembershipsTable, eq(gymCheckinsTable.membershipId, gymMembershipsTable.id))
      .where(eq(gymCheckinsTable.checkinDate, date));
    res.json(checkins);
  } catch (err) {
    req.log.error({ err }, "List checkins error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /memberships/:id/checkin
router.post("/memberships/:id/checkin", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const today = new Date().toISOString().split("T")[0]!;
    const checkinDate = String(req.body.checkinDate || today);
    const notes = req.body.notes ?? null;

    const [member] = await db.select().from(gymMembershipsTable).where(eq(gymMembershipsTable.id, id)).limit(1);
    if (!member) { res.status(404).json({ error: "Member tidak ditemukan" }); return; }
    if (member.status !== "active") { res.status(400).json({ error: "Member tidak aktif" }); return; }

    // Safety guard: endDate sudah lewat → otomatis expire dan tolak check-in
    const todayStr = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().split("T")[0]!;
    if (member.endDate < todayStr) {
      await db.update(gymMembershipsTable).set({ status: "expired", updatedAt: new Date() }).where(eq(gymMembershipsTable.id, id));
      res.status(400).json({ error: "Membership sudah kadaluarsa, tidak bisa check-in" }); return;
    }

    const [existing] = await db.select().from(gymCheckinsTable)
      .where(and(eq(gymCheckinsTable.membershipId, id), eq(gymCheckinsTable.checkinDate, checkinDate)))
      .limit(1);
    if (existing) { res.status(409).json({ error: "Sudah check-in pada tanggal ini", checkin: existing }); return; }

    // Every member visit is also a booking record so it appears in the
    // central booking list. It is prepaid by the membership and must never
    // enter the regular payment queue.
    const [gymFacility] = await db.select().from(facilitiesTable)
      .where(or(
        eq(facilitiesTable.bookingMode, "walk_in"),
        ilike(facilitiesTable.name, "%gym%"),
        ilike(facilitiesTable.name, "%fitness%"),
        ilike(facilitiesTable.category, "%gym%"),
        ilike(facilitiesTable.category, "%fitness%"),
      ))
      .limit(1);
    if (!gymFacility) {
      res.status(409).json({ error: "Fasilitas Gym belum tersedia" });
      return;
    }

    const orderNumber = await generateBookingOrderNumber();
    const checkedInAt = new Date();
    const bookingNote = [
      `Pemakaian member gym #${member.id}`,
      notes ? `Catatan check-in: ${String(notes).trim()}` : "",
    ].filter(Boolean).join(" — ");

    const result = await db.transaction(async (tx) => {
      const [newCheckin] = await tx.insert(gymCheckinsTable)
        .values({ membershipId: id, checkinDate, notes })
        .returning();

      const [newBooking] = await tx.insert(bookingsTable).values({
        orderNumber,
        customerId: null,
        customerName: member.name,
        customerEmail: member.email,
        customerPhone: member.phone,
        facilityId: gymFacility.id,
        bookingDate: checkinDate,
        startTime: gymFacility.openTime,
        endTime: addHours(gymFacility.openTime, 1),
        durationHours: 1,
        totalPrice: "0",
        discountAmount: "0",
        customerType: "umum",
        verificationStatus: "not_required",
        basePrice: "0",
        apDiscountAmount: "0",
        bookingType: "regular",
        membershipId: member.id,
        status: "confirmed",
        source: "gym_membership",
        numberOfPeople: 1,
        notes: bookingNote,
        paymentRequiredNow: false,
        payerType: "personal",
        billingStatus: "paid",
        dpp: "0",
        grandTotal: "0",
        checkedInAt,
      }).returning();

      await tx.insert(bookingHistoryTable).values({
        bookingId: newBooking.id,
        fromStatus: null,
        toStatus: "confirmed",
        changedByName: member.name,
        note: `Pemakaian member gym dicatat dari check-in membership #${member.id}`,
      });

      return { checkin: newCheckin, booking: newBooking };
    });

    res.status(201).json(result);

    // Fire-and-forget: kirim rekap WA hari ini ke grup admin
    sendRekapPemakaianToAdmin(checkinDate).catch((err) =>
      req.log.error({ err }, "[checkin] Gagal kirim rekap WA setelah check-in")
    );
  } catch (err) {
    req.log.error({ err }, "Check-in member error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /memberships/checkins/:checkinId  — undo check-in (harus sebelum /:id)
router.delete("/memberships/checkins/:checkinId", adminMiddleware, async (req, res) => {
  try {
    const checkinId = parseInt(String(req.params.checkinId));

    // Ambil tanggal dulu sebelum dihapus, untuk rekap
    const [existing] = await db.select().from(gymCheckinsTable).where(eq(gymCheckinsTable.id, checkinId)).limit(1);
    await db.delete(gymCheckinsTable).where(eq(gymCheckinsTable.id, checkinId));
    if (existing) {
      // Keep the booking for audit purposes, but make the cancelled check-in
      // disappear from active booking totals.
      await db.update(bookingsTable)
        .set({
          status: "cancelled",
          notes: "Pemakaian member gym dibatalkan bersama check-in.",
          updatedAt: new Date(),
        })
        .where(and(
          eq(bookingsTable.membershipId, existing.membershipId),
          eq(bookingsTable.bookingDate, existing.checkinDate),
          eq(bookingsTable.source, "gym_membership"),
        ));
    }
    res.status(204).send();

    // Fire-and-forget: kirim rekap WA hari ini ke grup admin
    const checkinDate = existing?.checkinDate ?? new Date().toISOString().split("T")[0]!;
    sendRekapPemakaianToAdmin(checkinDate).catch((err) =>
      req.log.error({ err }, "[checkin] Gagal kirim rekap WA setelah batal check-in")
    );
  } catch (err) {
    req.log.error({ err }, "Delete checkin error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

router.get("/memberships", adminMiddleware, async (req, res) => {
  try {
    const { status } = req.query;
    let memberships = await db.select().from(gymMembershipsTable).orderBy(gymMembershipsTable.createdAt);
    if (status) memberships = memberships.filter((m) => m.status === status);
    res.json(memberships.map((m) => ({ ...m, totalPrice: Number(m.totalPrice) })));
  } catch (err) {
    req.log.error({ err }, "List memberships error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/memberships/export", adminMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let memberships = await db.select().from(gymMembershipsTable).orderBy(gymMembershipsTable.startDate);

    if (startDate) memberships = memberships.filter((m) => m.startDate >= (startDate as string));
    if (endDate) memberships = memberships.filter((m) => m.startDate <= (endDate as string));

    const statusLabel: Record<string, string> = {
      active: "Aktif",
      expired: "Kadaluarsa",
      cancelled: "Dibatalkan",
      waiting_confirmation: "Menunggu Konfirmasi",
      pending_payment: "Menunggu Bayar",
    };

    const header = "Nama,Email,Telepon,Tanggal Mulai,Tanggal Selesai,Durasi (bulan),Total Harga,Status,Metode Bayar,Catatan,Tanggal Daftar\n";
    const rows = memberships.map((m) =>
      [
        m.name,
        m.email ?? "",
        m.phone ?? "",
        m.startDate,
        m.endDate,
        m.months,
        Number(m.totalPrice),
        statusLabel[m.status] ?? m.status,
        m.paymentMethod ?? "",
        m.notes ?? "",
        new Date(m.createdAt).toISOString(),
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );

    const csv = header + rows.join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=members-gym.csv");
    res.send(csv);
  } catch (err) {
    req.log.error({ err }, "Export memberships error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/memberships/:id/payments", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "ID membership tidak valid" });
      return;
    }

    const payments = await db
      .select()
      .from(membershipPaymentsTable)
      .where(eq(membershipPaymentsTable.membershipId, id))
      .orderBy(desc(membershipPaymentsTable.id));

    res.json(payments.map((payment) => ({ ...payment, amount: Number(payment.amount) })));
  } catch (err) {
    req.log.error({ err }, "List membership payments error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/memberships/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [membership] = await db.select().from(gymMembershipsTable).where(eq(gymMembershipsTable.id, id)).limit(1);
    if (!membership) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ...membership, totalPrice: Number(membership.totalPrice) });
  } catch (err) {
    req.log.error({ err }, "Get membership error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/memberships", async (req, res) => {
  try {
    const { name, email, phone, startDate, months, notes } = req.body;
    if (!name || !email || !phone || !startDate) {
      res.status(400).json({ error: "name, email, phone, dan startDate wajib diisi" });
      return;
    }

    // ── Cegah duplikat: tolak jika phone sudah punya membership aktif/pending ──
    const phoneNorm = String(phone).trim().toUpperCase();
    const BLOCK_STATUSES = ["active", "pending_payment", "waiting_confirmation"];
    const existingAll = await db
      .select()
      .from(gymMembershipsTable)
      .where(eq(gymMembershipsTable.phone, String(phone).trim()));

    const conflict = existingAll.find((m) => BLOCK_STATUSES.includes(m.status));
    if (conflict) {
      res.status(409).json({
        error: "Nomor HP ini sudah terdaftar sebagai member aktif atau sedang menunggu konfirmasi. Gunakan fitur Perpanjang untuk memperpanjang membership Anda.",
        conflictStatus: conflict.status,
        conflictId: conflict.id,
      });
      return;
    }

    const monthsNum = Number(months) || 1;
    const totalPrice = PRICE_PER_MONTH * monthsNum;

    const start = new Date(startDate);
    const end = new Date(start);
    end.setMonth(end.getMonth() + monthsNum);
    const endDate = end.toISOString().split("T")[0];

    const [membership] = await db
      .insert(gymMembershipsTable)
      .values({
        name,
        email,
        phone: String(phone).trim(),
        startDate,
        endDate,
        months: monthsNum,
        totalPrice: String(totalPrice),
        notes,
        status: "pending_payment",
      })
      .returning();

    await db.insert(membershipPaymentsTable).values({
      membershipId: membership!.id,
      periodStart: membership!.startDate,
      periodEnd: membership!.endDate,
      months: membership!.months,
      amount: membership!.totalPrice,
      status: "pending_payment",
    });

    syncMembershipToBizportal(membership).catch(() => {});
    await syncToPublic(membership!);
    res.status(201).json({ ...membership, totalPrice: Number(membership!.totalPrice) });
  } catch (err) {
    req.log.error({ err }, "Create membership error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /memberships/:id/renew — public, perpanjang membership yang ada (update record, bukan buat baru)
router.post("/memberships/:id/renew", async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const months = Math.max(1, parseInt(String(req.body?.months || 1)));

    const [existing] = await db.select().from(gymMembershipsTable).where(eq(gymMembershipsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Membership tidak ditemukan" }); return; }
    if (existing.status === "pending_payment" || existing.status === "waiting_confirmation") {
      res.status(400).json({ error: "Selesaikan pembayaran yang sedang berjalan sebelum memperpanjang. Status saat ini: " + existing.status }); return;
    }

    const todayStr = new Date().toISOString().split("T")[0]!;
    let newStartDate: string;
    if (existing.status === "active" && existing.endDate >= todayStr) {
      // Masih aktif — mulai setelah endDate lama
      const d = new Date(existing.endDate);
      d.setDate(d.getDate() + 1);
      newStartDate = d.toISOString().split("T")[0]!;
    } else {
      newStartDate = todayStr;
    }

    const endD = new Date(newStartDate);
    endD.setMonth(endD.getMonth() + months);
    const newEndDate = endD.toISOString().split("T")[0]!;
    const totalPrice = String(months * 300000);

    const [updated] = await db
      .update(gymMembershipsTable)
      .set({
        startDate: newStartDate,
        endDate: newEndDate,
        months,
        totalPrice,
        status: "pending_payment",
        paymentMethod: null,
        paymentProofUrl: null,
      })
      .where(eq(gymMembershipsTable.id, id))
      .returning();

    await db.insert(membershipPaymentsTable).values({
      membershipId: updated!.id,
      periodStart: updated!.startDate,
      periodEnd: updated!.endDate,
      months: updated!.months,
      amount: updated!.totalPrice,
      status: "pending_payment",
    });

    await syncToPublic(updated!);
    res.json({ ...updated, totalPrice: Number(updated!.totalPrice) });
  } catch (err) {
    req.log.error({ err }, "Renew membership error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/memberships/:id/payment-proof", async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const { paymentMethod, paymentProofUrl } = req.body;

    if (!paymentMethod || !paymentProofUrl) {
      res.status(400).json({ error: "paymentMethod and paymentProofUrl are required" });
      return;
    }

    const [existing] = await db.select().from(gymMembershipsTable).where(eq(gymMembershipsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.status !== "pending_payment") {
      res.status(400).json({ error: "Membership is not in pending_payment status" });
      return;
    }

    let [pendingPayment] = await db
      .select()
      .from(membershipPaymentsTable)
      .where(
        and(
          eq(membershipPaymentsTable.membershipId, id),
          eq(membershipPaymentsTable.status, "pending_payment"),
        ),
      )
      .orderBy(desc(membershipPaymentsTable.id))
      .limit(1);

    if (!pendingPayment) {
      [pendingPayment] = await db
        .insert(membershipPaymentsTable)
        .values({
          membershipId: existing.id,
          periodStart: existing.startDate,
          periodEnd: existing.endDate,
          months: existing.months,
          amount: existing.totalPrice,
          status: "pending_payment",
        })
        .returning();
    }

    await db.update(gymMembershipsTable)
      .set({ paymentMethod, paymentProofUrl, status: "waiting_confirmation" })
      .where(eq(gymMembershipsTable.id, id));

    await db
      .update(membershipPaymentsTable)
      .set({
        paymentMethod,
        paymentProofUrl,
        status: "waiting_confirmation",
        submittedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(membershipPaymentsTable.id, pendingPayment.id));

    const [membership] = await db.select().from(gymMembershipsTable).where(eq(gymMembershipsTable.id, id)).limit(1);
    syncMembershipToBizportal(membership).catch(() => {});
    await syncToPublic(membership!);

    const appUrl = await getBaseUrl();
    notifyMembershipPaymentProofUploaded({
      membershipId: membership!.id,
      customerName: membership!.name,
      startDate: membership!.startDate,
      endDate: membership!.endDate,
      totalPrice: Number(membership!.totalPrice).toLocaleString("id-ID"),
      reviewUrl: appUrl ? `${appUrl}/admin/memberships` : undefined,
    }).catch((err) => req.log.error({ err }, "[WA] notifyMembershipPaymentProofUploaded error"));

    res.json({ ...membership, totalPrice: Number(membership!.totalPrice) });
  } catch (err) {
    req.log.error({ err }, "Submit payment proof error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/memberships/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [existing] = await db.select().from(gymMembershipsTable).where(eq(gymMembershipsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const { status, notes, startDate, endDate } = req.body ?? {};
    const data: {
      status?: typeof existing.status;
      notes?: string | null;
      startDate?: string;
      endDate?: string;
      updatedAt: Date;
    } = { updatedAt: new Date() };

    if (status !== undefined) data.status = status;
    if (notes !== undefined) data.notes = notes;
    if (startDate !== undefined || endDate !== undefined) {
      const nextStartDate = String(startDate ?? existing.startDate);
      const nextEndDate = String(endDate ?? existing.endDate);
      const isDateOnly = (value: string) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const parsed = new Date(`${value}T00:00:00Z`);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
      };

      if (!isDateOnly(nextStartDate) || !isDateOnly(nextEndDate)) {
        res.status(400).json({ error: "Tanggal mulai dan berakhir harus berformat YYYY-MM-DD yang valid" });
        return;
      }
      if (nextStartDate > nextEndDate) {
        res.status(400).json({ error: "Tanggal mulai tidak boleh setelah tanggal berakhir" });
        return;
      }

      data.startDate = nextStartDate;
      data.endDate = nextEndDate;
    }

    if (Object.keys(data).length === 1) {
      res.status(400).json({ error: "Tidak ada data yang diperbarui" });
      return;
    }

    await db.update(gymMembershipsTable).set(data).where(eq(gymMembershipsTable.id, id));
    const [membership] = await db.select().from(gymMembershipsTable).where(eq(gymMembershipsTable.id, id)).limit(1);
    if (!membership) { res.status(404).json({ error: "Not found" }); return; }

    if (data.startDate !== undefined || data.endDate !== undefined) {
      await db
        .update(membershipPaymentsTable)
        .set({
          periodStart: membership.startDate,
          periodEnd: membership.endDate,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(membershipPaymentsTable.membershipId, membership.id),
            inArray(membershipPaymentsTable.status, ["pending_payment", "waiting_confirmation"]),
          ),
        );
    }

    if (membership.status === "cancelled" && existing.status !== "cancelled") {
      await db
        .update(membershipPaymentsTable)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(
          and(
            eq(membershipPaymentsTable.membershipId, membership.id),
            inArray(membershipPaymentsTable.status, ["pending_payment", "waiting_confirmation"]),
          ),
        );
    }

    syncMembershipToBizportal(membership).catch(() => {});
    if (membership.status === "active" && existing.status !== "active") {
      let [payment] = await db
        .select()
        .from(membershipPaymentsTable)
        .where(
          and(
            eq(membershipPaymentsTable.membershipId, membership.id),
            inArray(membershipPaymentsTable.status, ["pending_payment", "waiting_confirmation"]),
          ),
        )
        .orderBy(desc(membershipPaymentsTable.id))
        .limit(1);

      if (!payment) {
        [payment] = await db
          .insert(membershipPaymentsTable)
          .values({
            membershipId: membership.id,
            periodStart: membership.startDate,
            periodEnd: membership.endDate,
            months: membership.months,
            amount: membership.totalPrice,
            status: "pending_payment",
            paymentMethod: membership.paymentMethod,
            paymentProofUrl: membership.paymentProofUrl,
          })
          .returning();
      }

      const confirmedAt = new Date();
      const refNumber = `MB-${membership.id}-P${payment.id}`;
      const mutationKey = `SC-MBP-${payment.id}`;
      await db
        .update(membershipPaymentsTable)
        .set({
          status: "confirmed",
          paymentMethod: membership.paymentMethod,
          paymentProofUrl: membership.paymentProofUrl,
          confirmedAt,
          mutationKey,
          accountingRef: refNumber,
          updatedAt: confirmedAt,
        })
        .where(eq(membershipPaymentsTable.id, payment.id));

      const [confirmedPayment] = await db
        .select()
        .from(membershipPaymentsTable)
        .where(eq(membershipPaymentsTable.id, payment.id))
        .limit(1);
      const today = new Date().toISOString().split("T")[0]!;
      // totalPrice sudah inklusif PPN — hitung DPP dan PPN agar tidak double-count
      const totalPrice = Number(membership.totalPrice);
      const membershipDpp = Math.round(totalPrice / 1.11);
      const membershipPpn = totalPrice - membershipDpp;
      pushMembershipPaymentAsBankMutation(membership, confirmedPayment!, confirmedAt).catch(() => {});
      createMembershipJournalEntry(membership.id, refNumber, membershipDpp, membershipPpn, today).catch((err) =>
        logAccountingError({ operation: "createMembershipJournalEntry", orderNumber: refNumber, bookingId: membership.id, error: err }),
      );
      createPublicMembershipAccountingEntry(membership.id, refNumber, membershipDpp, membershipPpn, today).catch((err) =>
        logAccountingError({ operation: "createPublicMembershipAccountingEntry", orderNumber: refNumber, bookingId: membership.id, error: err }),
      );
    }
    await syncToPublic(membership);
    res.json({ ...membership, totalPrice: Number(membership.totalPrice) });
  } catch (err) {
    req.log.error({ err }, "Update membership error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/memberships/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    await db.delete(gymMembershipsTable).where(eq(gymMembershipsTable.id, id));
    await deleteFromPublic(id);
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Delete membership error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
