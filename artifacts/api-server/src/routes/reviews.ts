import { Router } from "express";
import { db, bookingReviewsTable, bookingsTable, facilitiesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";

const router = Router();

// GET /reviews — get all reviews (admin) or by facilityId (public)
router.get("/reviews", async (req, res) => {
  try {
    const { facilityId } = req.query;
    let reviews = await db.select().from(bookingReviewsTable);
    if (facilityId) reviews = reviews.filter((r) => r.facilityId === Number(facilityId));

    const bookingIds = [...new Set(reviews.map((r) => r.bookingId))];
    const bookings = bookingIds.length > 0 ? await db.select().from(bookingsTable) : [];
    const facilities = await db.select({ id: facilitiesTable.id, name: facilitiesTable.name }).from(facilitiesTable);

    const result = reviews.map((r) => {
      const booking = bookings.find((b) => b.id === r.bookingId);
      const facility = facilities.find((f) => f.id === r.facilityId);
      return {
        ...r,
        facilityName: facility?.name ?? "",
        bookingDate: booking?.bookingDate ?? "",
        orderNumber: booking?.orderNumber ?? "",
      };
    });

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "List reviews error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /reviews/summary — average ratings per facility
router.get("/reviews/summary", async (req, res) => {
  try {
    const reviews = await db.select().from(bookingReviewsTable);
    const facilities = await db.select({ id: facilitiesTable.id, name: facilitiesTable.name }).from(facilitiesTable);

    const summary: Record<number, { facilityId: number; facilityName: string; avgRating: number; count: number }> = {};
    for (const r of reviews) {
      if (!summary[r.facilityId]) {
        const facility = facilities.find((f) => f.id === r.facilityId);
        summary[r.facilityId] = { facilityId: r.facilityId, facilityName: facility?.name ?? "", avgRating: 0, count: 0 };
      }
      summary[r.facilityId].count++;
      summary[r.facilityId].avgRating += r.rating;
    }

    const result = Object.values(summary).map((s) => ({
      ...s,
      avgRating: s.count > 0 ? Math.round((s.avgRating / s.count) * 10) / 10 : 0,
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Reviews summary error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /reviews — customer submits review for a completed booking
router.post("/reviews", async (req, res) => {
  try {
    const { bookingId, rating, comment, reviewerName } = req.body;

    if (!bookingId || !rating) {
      res.status(400).json({ error: "bookingId and rating are required" });
      return;
    }
    if (rating < 1 || rating > 5) {
      res.status(400).json({ error: "Rating harus antara 1-5" });
      return;
    }

    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, Number(bookingId))).limit(1);
    if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }
    if (booking.status !== "completed") { res.status(400).json({ error: "Hanya booking selesai yang dapat dirating" }); return; }

    const [existing] = await db.select().from(bookingReviewsTable).where(eq(bookingReviewsTable.bookingId, Number(bookingId))).limit(1);
    if (existing) { res.status(409).json({ error: "Booking ini sudah dirating" }); return; }

    const [review] = await db.insert(bookingReviewsTable).values({
      bookingId: Number(bookingId),
      facilityId: booking.facilityId,
      rating: Number(rating),
      comment: comment || null,
      reviewerName: reviewerName || booking.customerName,
    }).returning();

    res.status(201).json(review);
  } catch (err) {
    req.log.error({ err }, "Create review error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /reviews/:id — admin only
router.delete("/reviews/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    await db.delete(bookingReviewsTable).where(eq(bookingReviewsTable.id, id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete review error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
