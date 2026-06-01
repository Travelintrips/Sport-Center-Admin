import { text, serial, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { facilitiesTable } from "./facilities";
import { usersTable } from "./users";
import { scSchema } from "./_schema";

export const bookingStatusEnum = scSchema.enum("booking_status", [
  "pending_payment",
  "waiting_confirmation",
  "paid",
  "confirmed",
  "completed",
  "cancelled",
  "rejected",
  "expired",
  "refunded",
]);

export const customerTypeEnum = scSchema.enum("customer_type", [
  "umum",
  "angkasa_pura",
]);

export const verificationStatusEnum = scSchema.enum("verification_status", [
  "not_required",
  "pending",
  "verified",
  "rejected",
]);

export const bookingsTable = scSchema.table("bookings", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull().unique(),
  customerId: integer("customer_id").references(() => usersTable.id, { onDelete: "set null" }),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone").notNull(),
  facilityId: integer("facility_id").notNull().references(() => facilitiesTable.id),
  bookingDate: text("booking_date").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  durationHours: integer("duration_hours").notNull(),
  totalPrice: numeric("total_price", { precision: 12, scale: 2 }).notNull(),
  promoCode: text("promo_code"),
  discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  customerType: customerTypeEnum("customer_type").notNull().default("umum"),
  idCardNumber: text("id_card_number"),
  verificationStatus: verificationStatusEnum("verification_status").notNull().default("not_required"),
  basePrice: numeric("base_price", { precision: 12, scale: 2 }),
  apDiscountAmount: numeric("ap_discount_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  status: bookingStatusEnum("status").notNull().default("pending_payment"),
  activityType: text("activity_type"),
  numberOfPeople: integer("number_of_people"),
  resourceName: text("resource_name"),
  notes: text("notes"),
  adminNotes: text("admin_notes"),
  paymentDeadline: timestamp("payment_deadline", { withTimezone: true }),
  checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const adminNotesTable = scSchema.table("admin_notes", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull().references(() => bookingsTable.id, { onDelete: "cascade" }),
  note: text("note").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBookingSchema = createInsertSchema(bookingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type Booking = typeof bookingsTable.$inferSelect;
