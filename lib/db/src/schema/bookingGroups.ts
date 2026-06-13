import { text, serial, timestamp, numeric } from "drizzle-orm/pg-core";
import { scSchema } from "./_schema";

export const bookingGroupStatusEnum = scSchema.enum("booking_group_status", [
  "pending",
  "paid",
]);

export const bookingGroupsTable = scSchema.table("booking_groups", {
  id: serial("id").primaryKey(),
  groupRef: text("group_ref").notNull().unique(),
  customerPhone: text("customer_phone").notNull(),
  customerName: text("customer_name").notNull(),
  totalPayment: numeric("total_payment", { precision: 12, scale: 2 }).notNull(),
  status: bookingGroupStatusEnum("status").notNull().default("pending"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BookingGroup = typeof bookingGroupsTable.$inferSelect;
