import { text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantBookingsTable } from "./tenantBookings";
import { scSchema } from "./_schema";

export const tenantPaymentsTable = scSchema.table("tenant_payments", {
  id: serial("id").primaryKey(),
  tenantBookingId: integer("tenant_booking_id").notNull().references(() => tenantBookingsTable.id, { onDelete: "cascade" }),
  proofImageUrl: text("proof_image_url"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  status: text("status", { enum: ["pending", "verified", "rejected"] }).notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTenantPaymentSchema = createInsertSchema(tenantPaymentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTenantPayment = z.infer<typeof insertTenantPaymentSchema>;
export type TenantPayment = typeof tenantPaymentsTable.$inferSelect;
