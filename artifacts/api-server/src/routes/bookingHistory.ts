import { Router } from "express";
import { db, bookingHistoryTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";

const router = Router();

router.get("/bookings/:id/history", async (req, res) => {
  try {
    const bookingId = parseInt(String(req.params.id));
    const history = await db
      .select()
      .from(bookingHistoryTable)
      .where(eq(bookingHistoryTable.bookingId, bookingId))
      .orderBy(asc(bookingHistoryTable.createdAt));
    res.json(history);
  } catch (err) {
    req.log.error({ err }, "Get booking history error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
