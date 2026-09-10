import { text, serial, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { facilitiesTable } from "./facilities";
import { bookingsTable } from "./bookings";
import { scSchema } from "./_schema";

export const subscriptionStatusEnum = scSchema.enum("corporate_subscription_status", [
  "active", "paused", "stop_requested", "stopped",
]);

export const corporateSubscriptionsTable = scSchema.table("corporate_subscriptions", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => usersTable.id),
  facilityId: integer("facility_id").notNull().references(() => facilitiesTable.id),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  effectiveStartDate: text("effective_start_date").notNull(),
  billingPeriod: text("billing_period").notNull().default("monthly"),
  status: subscriptionStatusEnum("status").notNull().default("active"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  stoppedAt: timestamp("stopped_at", { withTimezone: true }),
  stoppedBy: integer("stopped_by").references(() => usersTable.id, { onDelete: "set null" }),
  stopReason: text("stop_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const corporateOccurrencesTable = scSchema.table("corporate_occurrences", {
  id: serial("id").primaryKey(),
  subscriptionId: integer("subscription_id").notNull().references(() => corporateSubscriptionsTable.id, { onDelete: "cascade" }),
  occurrenceDate: text("occurrence_date").notNull(),
  bookingId: integer("booking_id").references(() => bookingsTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("scheduled"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  subscriptionDateUnique: uniqueIndex("corporate_occurrences_subscription_date_unique").on(t.subscriptionId, t.occurrenceDate),
}));

export const usageProofsTable = scSchema.table("usage_proofs", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull().references(() => bookingsTable.id, { onDelete: "cascade" }),
  storagePath: text("storage_path").notNull(),
  photoUrl: text("photo_url").notNull(),
  uploadedBy: integer("uploaded_by").references(() => usersTable.id, { onDelete: "set null" }),
  capturedAt: timestamp("captured_at", { withTimezone: true }),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCorporateSubscriptionSchema = createInsertSchema(corporateSubscriptionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCorporateSubscription = z.infer<typeof insertCorporateSubscriptionSchema>;
export type CorporateSubscription = typeof corporateSubscriptionsTable.$inferSelect;
export type CorporateOccurrence = typeof corporateOccurrencesTable.$inferSelect;