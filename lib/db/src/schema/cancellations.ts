import { text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { bookingsTable } from "./bookings";
import { usersTable } from "./users";
import { scSchema } from "./_schema";

export const bookingCancellationsTable = scSchema.table("booking_cancellations", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull().references(() => bookingsTable.id, { onDelete: "cascade" }).unique(),
  cancelledBy: text("cancelled_by").notNull().default("customer"),
  cancelledByUserId: integer("cancelled_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  reason: text("reason"),
  refundAmount: numeric("refund_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  refundStatus: text("refund_status").notNull().default("none"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBookingCancellationSchema = createInsertSchema(bookingCancellationsTable).omit({ id: true, createdAt: true });
export type InsertBookingCancellation = z.infer<typeof insertBookingCancellationSchema>;
export type BookingCancellation = typeof bookingCancellationsTable.$inferSelect;
