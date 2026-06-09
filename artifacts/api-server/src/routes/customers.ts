import { Router } from "express";
import { db, usersTable, bookingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";

const router = Router();

router.get("/customers", adminMiddleware, async (req, res) => {
  try {
    const { search } = req.query;
    const users = await db.select().from(usersTable).where(eq(usersTable.role, "customer"));
    const bookings = await db.select().from(bookingsTable);

    let result = users.map((u) => {
      const userBookings = bookings.filter((b) => b.customerId === u.id || b.customerEmail === u.email);
      const totalSpent = userBookings
        .filter((b) => b.status !== "cancelled")
        .reduce((sum, b) => sum + Number(b.totalPrice), 0);
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        customerCode: u.customerCode,
        registrationSource: u.registrationSource ?? "web",
        totalBookings: userBookings.length,
        totalSpent,
        createdAt: u.createdAt,
      };
    });

    if (search) {
      const s = (search as string).toLowerCase();
      result = result.filter(
        (u) =>
          u.name.toLowerCase().includes(s) ||
          u.email.toLowerCase().includes(s) ||
          (u.phone ?? "").includes(s) ||
          (u.customerCode ?? "").toLowerCase().includes(s)
      );
    }

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "List customers error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/customers/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!user) { res.status(404).json({ error: "Not found" }); return; }
    const userBookings = await db.select().from(bookingsTable).where(eq(bookingsTable.customerId, id));
    const totalSpent = userBookings
      .filter((b) => b.status !== "cancelled")
      .reduce((sum, b) => sum + Number(b.totalPrice), 0);
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      customerCode: user.customerCode,
      registrationSource: user.registrationSource ?? "web",
      totalBookings: userBookings.length,
      totalSpent,
      createdAt: user.createdAt,
    });
  } catch (err) {
    req.log.error({ err }, "Get customer error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
