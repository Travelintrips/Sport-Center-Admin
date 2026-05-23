import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const settingsTable = pgTable("settings", {
  id: serial("id").primaryKey(),
  centerName: text("center_name").notNull().default("Sport Center"),
  address: text("address").notNull().default(""),
  phone: text("phone").notNull().default(""),
  whatsapp: text("whatsapp").notNull().default(""),
  email: text("email").notNull().default(""),
  openHour: text("open_hour").default("06:00"),
  closeHour: text("close_hour").default("22:00"),
  logoUrl: text("logo_url"),
  bankName: text("bank_name"),
  bankAccount: text("bank_account"),
  bankAccountName: text("bank_account_name"),
  qrisImageUrl: text("qris_image_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSettingsSchema = createInsertSchema(settingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settingsTable.$inferSelect;
