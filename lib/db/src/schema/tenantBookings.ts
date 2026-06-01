import { text, serial, timestamp, integer, numeric, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";
import { scSchema } from "./_schema";

export const tenantBookingsTable = scSchema.table("tenant_bookings", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull().unique(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  bookingType: text("booking_type", { enum: ["booth", "event_space", "advertising_space", "renewal"] }).notNull().default("booth"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  durationMonths: integer("duration_months"),
  requestedArea: text("requested_area"),
  description: text("description"),
  price: numeric("price", { precision: 12, scale: 2 }).notNull().default("0"),
  paymentStatus: text("payment_status", { enum: ["pending", "uploaded", "verified", "rejected"] }).notNull().default("pending"),
  status: text("status", { enum: ["pending", "approved", "rejected", "active", "expired"] }).notNull().default("pending"),
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTenantBookingSchema = createInsertSchema(tenantBookingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTenantBooking = z.infer<typeof insertTenantBookingSchema>;
export type TenantBooking = typeof tenantBookingsTable.$inferSelect;
