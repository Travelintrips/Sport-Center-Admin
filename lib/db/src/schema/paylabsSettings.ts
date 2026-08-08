import { text, serial, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { scSchema } from "./_schema";

export const paylabsSettingsTable = scSchema.table("paylabs_settings", {
  id: serial("id").primaryKey(),
  // General
  title: text("title").notNull().default("Online Payment (Bank Transfer, Virtual Account, QRIS)"),
  description: text("description").notNull().default(""),
  sendInvoice: boolean("send_invoice").notNull().default(true),
  chargeCustomer: boolean("charge_customer").notNull().default(false),
  newOrderStatus: text("new_order_status").notNull().default("completed"),
  debugMode: boolean("debug_mode").notNull().default(false),
  // Mode
  sandboxMode: boolean("sandbox_mode").notNull().default(true),
  storeId: text("store_id").notNull().default(""),
  // Sandbox credentials (SIT)
  sandboxPublicKey: text("sandbox_public_key").notNull().default(""),
  sandboxPrivateKey: text("sandbox_private_key").notNull().default(""),
  sandboxMerchantId: text("sandbox_merchant_id").notNull().default(""),
  // Production credentials
  prodPublicKey: text("prod_public_key").notNull().default(""),
  prodPrivateKey: text("prod_private_key").notNull().default(""),
  prodMerchantId: text("prod_merchant_id").notNull().default(""),
  // Payment methods active status & custom config (JSON)
  paymentMethodsConfig: jsonb("payment_methods_config"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type PaylabsSettings = typeof paylabsSettingsTable.$inferSelect;
export type InsertPaylabsSettings = typeof paylabsSettingsTable.$inferInsert;
