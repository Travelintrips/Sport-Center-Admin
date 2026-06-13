import { text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { scSchema } from "./_schema";

export const waBookingSessionsTable = scSchema.table("wa_booking_sessions", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull(),
  customerId: integer("customer_id").references(() => usersTable.id, { onDelete: "set null" }),
  currentStep: text("current_step").notNull().default("ask_facility"),
  facilityId: integer("facility_id"),
  bookingDate: text("booking_date"),
  startTime: text("start_time"),
  durationMinutes: integer("duration_minutes"),
  customerName: text("customer_name"),
  status: text("status").notNull().default("active"),
  rawMessages: jsonb("raw_messages")
    .$type<Array<{ role: string; text: string; at: string }>>()
    .notNull()
    .default([]),
  expiredAt: timestamp("expired_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type WaBookingSession = typeof waBookingSessionsTable.$inferSelect;
