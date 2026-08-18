import { text, serial, timestamp, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { scSchema } from "./_schema";

export const companyInvoiceSettingsTable = scSchema.table("company_invoice_settings", {
  id: serial("id").primaryKey(),
  companyName: text("company_name").notNull().default("Sport Center Soekarno-Hatta"),
  logoUrl: text("logo_url"),
  kopSuratHtml: text("kop_surat_html"),
  address: text("address").notNull().default(""),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  bankName: text("bank_name").notNull().default(""),
  bankAccount: text("bank_account").notNull().default(""),
  bankAccountName: text("bank_account_name").notNull().default(""),
  financeName: text("finance_name").notNull().default(""),
  financeTitle: text("finance_title").notNull().default("Finance Manager"),
  signatureUrl: text("signature_url"),
  invoicePrefix: text("invoice_prefix").notNull().default("INV"),
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default("11"),
  footerText: text("footer_text"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCompanyInvoiceSettingsSchema = createInsertSchema(companyInvoiceSettingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCompanyInvoiceSettings = z.infer<typeof insertCompanyInvoiceSettingsSchema>;
export type CompanyInvoiceSettings = typeof companyInvoiceSettingsTable.$inferSelect;
