import { text, serial, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { scSchema } from "./_schema";


export const membershipStatusEnum = scSchema.enum("membership_status", ["pending_payment", "waiting_confirmation", "active", "expired", "cancelled"]);

export const gymMembershipsTable = scSchema.table("sport_memberships", {
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
  paymentMethod: text("payment_method"),
  paymentProofUrl: text("payment_proof_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertGymMembershipSchema = createInsertSchema(gymMembershipsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertGymMembership = z.infer<typeof insertGymMembershipSchema>;
export type GymMembership = typeof gymMembershipsTable.$inferSelect;

// ─── Gym Check-ins ────────────────────────────────────────────────────────────

export const gymCheckinsTable = scSchema.table("gym_checkins", {
  id: serial("id").primaryKey(),
  membershipId: integer("membership_id").notNull().references(() => gymMembershipsTable.id, { onDelete: "cascade" }),
  checkinDate: text("checkin_date").notNull(), // YYYY-MM-DD
  checkedInAt: timestamp("checked_in_at", { withTimezone: true }).notNull().defaultNow(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertGymCheckinSchema = createInsertSchema(gymCheckinsTable).omit({ id: true, checkedInAt: true, createdAt: true });
export type InsertGymCheckin = z.infer<typeof insertGymCheckinSchema>;
export type GymCheckin = typeof gymCheckinsTable.$inferSelect;
