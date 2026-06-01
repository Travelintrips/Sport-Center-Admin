import { text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { bookingsTable } from "./bookings";
import { usersTable } from "./users";
import { scSchema } from "./_schema";

export const bookingHistoryTable = scSchema.table("booking_history", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull().references(() => bookingsTable.id, { onDelete: "cascade" }),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  changedBy: integer("changed_by").references(() => usersTable.id, { onDelete: "set null" }),
  changedByName: text("changed_by_name"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBookingHistorySchema = createInsertSchema(bookingHistoryTable).omit({ id: true, createdAt: true });
export type InsertBookingHistory = z.infer<typeof insertBookingHistorySchema>;
export type BookingHistory = typeof bookingHistoryTable.$inferSelect;
