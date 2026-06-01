import { text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { bookingsTable } from "./bookings";
import { usersTable } from "./users";
import { scSchema } from "./_schema";

export const rescheduleRequestsTable = scSchema.table("reschedule_requests", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull().references(() => bookingsTable.id, { onDelete: "cascade" }),
  requestedBy: integer("requested_by").references(() => usersTable.id, { onDelete: "set null" }),
  newDate: text("new_date").notNull(),
  newStartTime: text("new_start_time").notNull(),
  newEndTime: text("new_end_time").notNull(),
  reason: text("reason"),
  status: text("status").notNull().default("pending"),
  reviewedBy: integer("reviewed_by").references(() => usersTable.id, { onDelete: "set null" }),
  reviewNote: text("review_note"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertRescheduleRequestSchema = createInsertSchema(rescheduleRequestsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRescheduleRequest = z.infer<typeof insertRescheduleRequestSchema>;
export type RescheduleRequest = typeof rescheduleRequestsTable.$inferSelect;
