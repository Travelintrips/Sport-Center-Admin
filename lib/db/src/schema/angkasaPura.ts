import { text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { scSchema } from "./_schema";

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

export const insertDiscountSettingSchema = createInsertSchema(discountSettingsTable).omit({ id: true, updatedAt: true });
export type InsertDiscountSetting = z.infer<typeof insertDiscountSettingSchema>;
export type DiscountSetting = typeof discountSettingsTable.$inferSelect;

export const insertApMemberSchema = createInsertSchema(apMembersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertApMember = z.infer<typeof insertApMemberSchema>;
export type ApMember = typeof apMembersTable.$inferSelect;
