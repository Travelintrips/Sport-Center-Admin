import { pgTable, text, serial, timestamp, numeric, integer, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const membershipStatusEnum = pgEnum("membership_status", ["active", "expired", "cancelled"]);

export const gymMembershipsTable = pgTable("gym_memberships", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  months: integer("months").notNull().default(1),
  totalPrice: numeric("total_price", { precision: 12, scale: 2 }).notNull(),
  status: membershipStatusEnum("status").notNull().default("active"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertGymMembershipSchema = createInsertSchema(gymMembershipsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertGymMembership = z.infer<typeof insertGymMembershipSchema>;
export type GymMembership = typeof gymMembershipsTable.$inferSelect;
