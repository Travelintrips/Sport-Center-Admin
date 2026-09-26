import { boolean, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { scSchema } from "./_schema";

export const settingsTable = scSchema.table("sport_settings", {
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
  fonnteToken: text("fonnte_token"),
  fonnteCustomerToken: text("fonnte_customer_token"),
  fonnteCustomerDevice: text("fonnte_customer_device"),
  customerServiceWhatsapp: text("customer_service_whatsapp"),
  minaWebChatEnabled: boolean("mina_web_chat_enabled").notNull().default(true),
  minaWebChatGreeting: text("mina_web_chat_greeting").notNull().default("Halo! Saya Mina, asisten Sport Center. Ada yang bisa saya bantu?"),
  minaWebChatQuickActions: text("mina_web_chat_quick_actions").notNull().default("Booking Fasilitas\nCek Jadwal\nCek Harga\nGym & Membership"),
  fonnteAdminWa: text("fonnte_admin_wa"),
  adminWaPhones: text("admin_wa_phones"),
  appUrl: text("app_url"),
  paymentDomain: text("payment_domain"),
  paymentDeadlineHours: text("payment_deadline_hours").default("24"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSettingsSchema = createInsertSchema(settingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settingsTable.$inferSelect;
