import { text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { scSchema } from "./_schema";
import { bookingsTable } from "./bookings";

export const discountSettingsTable = scSchema.table("discount_settings", {
  id: serial("id").primaryKey(),
  customerType: text("customer_type").notNull().unique(),
  discountPercentage: integer("discount_percentage").notNull().default(0),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const apMembersTable = scSchema.table("ap_members", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  idCardNumber: text("id_card_number").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const verificationLogsTable = scSchema.table("verification_logs", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").references(() => bookingsTable.id, { onDelete: "cascade" }),
  orderNumber: text("order_number"),
  verifiedByUserId: integer("verified_by_user_id"),
  idCardNumberInput: text("id_card_number_input").notNull(),
  status: text("status").notNull(),
  notes: text("notes"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDiscountSettingSchema = createInsertSchema(discountSettingsTable).omit({ id: true, updatedAt: true });
export type InsertDiscountSetting = z.infer<typeof insertDiscountSettingSchema>;
export type DiscountSetting = typeof discountSettingsTable.$inferSelect;

export const insertApMemberSchema = createInsertSchema(apMembersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertApMember = z.infer<typeof insertApMemberSchema>;
export type ApMember = typeof apMembersTable.$inferSelect;

export const insertVerificationLogSchema = createInsertSchema(verificationLogsTable).omit({ id: true, createdAt: true });
export type InsertVerificationLog = z.infer<typeof insertVerificationLogSchema>;
export type VerificationLog = typeof verificationLogsTable.$inferSelect;
