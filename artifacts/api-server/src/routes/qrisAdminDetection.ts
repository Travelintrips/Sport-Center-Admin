import { Router } from "express";
import { db, bookingsTable, paymentsTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";

const router = Router();

router.get("/admin/bookings/:id/qris-email-detection", adminMiddleware, async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid booking id" });
      return;
    }

    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
    if (!booking) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const groupBookingIds = booking.groupRef
      ? (await db.select({ id: bookingsTable.id }).from(bookingsTable)
          .where(eq(bookingsTable.groupRef, booking.groupRef))).map((row) => row.id)
      : [id];

    const allPayments = await db.select().from(paymentsTable)
      .where(inArray(paymentsTable.bookingId, groupBookingIds));
    const paymentIds = allPayments.map((payment) => payment.id);
    if (paymentIds.length === 0) {
      res.json({ detection: null });
      return;
    }

    const tableName = process.env.NODE_ENV === "production"
      ? "sport_center.qris_email_transactions"
      : "sport_center.qris_email_transactions_dev";
    const paymentIdList = paymentIds.map((value) => Number(value)).filter(Number.isInteger).join(",");
    if (!paymentIdList) {
      res.json({ detection: null });
      return;
    }

    const query = [
      "SELECT payment_id, match_status, transaction_at FROM (",
      "SELECT UNNEST(candidate_payment_ids) AS payment_id, match_status, transaction_at, id",
      "FROM " + tableName,
      "WHERE candidate_payment_ids && ARRAY[" + paymentIdList + "]::integer[]",
      "AND match_status IN ('reference_match_review','ambiguous','review_required')",
      ") admin_qris_candidates",
      "ORDER BY CASE match_status",
      "WHEN 'reference_match_review' THEN 0",
      "WHEN 'ambiguous' THEN 1",
      "ELSE 2 END, id DESC LIMIT 1",
    ].join(" ");

    const result = await db.execute(sql.raw(query));
    const row = (((result as any).rows ?? result) as Array<{
      payment_id: unknown;
      match_status: unknown;
      transaction_at: unknown;
    }>)[0];
    if (!row) {
      res.json({ detection: null });
      return;
    }

    const paymentId = Number(row.payment_id);
    const payment = allPayments.find((item) => item.id === paymentId);
    if (!payment) {
      res.json({ detection: null });
      return;
    }

    const status = String(row.match_status ?? "");
    res.json({
      detection: {
        paymentId,
        paymentStatus: payment.status,
        status,
        transactionAt: row.transaction_at == null ? null : new Date(String(row.transaction_at)).toISOString(),
        confidence: status === "reference_match_review" ? "high" : "low",
      },
    });
  } catch (err) {
    req.log.error({ err }, "Get admin QRIS email detection error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
