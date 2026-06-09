import { text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { scSchema } from "./_schema";
import { bookingsTable } from "./bookings";

export const bookingExtensionRequestsTable = scSchema.table("booking_extension_requests", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull().references(() => bookingsTable.id, { onDelete: "cascade" }),
  extraHours: integer("extra_hours").notNull(),
  additionalPrice: numeric("additional_price", { precision: 12, scale: 2 }).notNull(),
  reason: text("reason"),
  status: text("status").notNull().default("pending"),
  adminNote: text("admin_note"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type BookingExtensionRequest = typeof bookingExtensionRequestsTable.$inferSelect;
