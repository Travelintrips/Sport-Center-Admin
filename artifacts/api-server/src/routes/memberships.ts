import { Router } from "express";
import { db, gymMembershipsTable, publicMembershipsTable, gymCheckinsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { syncMembershipToBizportal, pushMembershipPaymentAsBankMutation } from "../lib/bizportalSync";
import { createMembershipJournalEntry, createPublicMembershipAccountingEntry } from "../lib/accounting";
import { logAccountingError } from "../lib/auditLog";
import { sendRekapPemakaianToAdmin } from "../lib/rekapPemakaian";
import { notifyMembershipPaymentProofUploaded } from "../lib/notifications";
import { getBaseUrl } from "../lib/appUrl";

const router = Router();

const PRICE_PER_MONTH = 300000;

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

    const [existing] = await db.select().from(gymCheckinsTable)
      .where(and(eq(gymCheckinsTable.membershipId, id), eq(gymCheckinsTable.checkinDate, checkinDate)))
      .limit(1);
    if (existing) { res.status(409).json({ error: "Sudah check-in pada tanggal ini", checkin: existing }); return; }

    const [checkin] = await db.insert(gymCheckinsTable).values({ membershipId: id, checkinDate, notes }).returning();
    res.status(201).json(checkin);

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
        phone,
        startDate,
        endDate,
        months: monthsNum,
        totalPrice: String(totalPrice),
        notes,
        status: "pending_payment",
      })
      .returning();

    syncMembershipToBizportal(membership).catch(() => {});
    await syncToPublic(membership!);
    res.status(201).json({ ...membership, totalPrice: Number(membership!.totalPrice) });
  } catch (err) {
    req.log.error({ err }, "Create membership error");
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

    await db.update(gymMembershipsTable)
      .set({ paymentMethod, paymentProofUrl, status: "waiting_confirmation" })
      .where(eq(gymMembershipsTable.id, id));

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
    const data = { ...req.body };
    if (data.totalPrice !== undefined) data.totalPrice = String(data.totalPrice);
    await db.update(gymMembershipsTable).set(data).where(eq(gymMembershipsTable.id, id));
    const [membership] = await db.select().from(gymMembershipsTable).where(eq(gymMembershipsTable.id, id)).limit(1);
    if (!membership) { res.status(404).json({ error: "Not found" }); return; }
    syncMembershipToBizportal(membership).catch(() => {});
    if (membership.status === "active" && existing.status !== "active") {
      const refNumber = `MB-${membership.id}`;
      const today = new Date().toISOString().split("T")[0]!;
      // totalPrice sudah inklusif PPN — hitung DPP dan PPN agar tidak double-count
      const totalPrice = Number(membership.totalPrice);
      const membershipDpp = Math.round(totalPrice / 1.11);
      const membershipPpn = totalPrice - membershipDpp;
      pushMembershipPaymentAsBankMutation(membership, new Date()).catch(() => {});
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
