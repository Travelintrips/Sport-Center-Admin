import { text, serial, timestamp, numeric, boolean, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { scSchema } from "./_schema";

export const documentTypeEnum = pgEnum("document_type_enum", [
  "general",
  "invoice",
  "spp",
  "kwitansi",
  "lampiran",
  "berita_acara",
  "surat_pengantar",
]);

export const companyDocumentSettingsTable = scSchema.table("company_document_settings", {
  id: serial("id").primaryKey(),
  documentType: documentTypeEnum("document_type").notNull().default("general"),

  // Kop surat & logo
  logoUrl: text("logo_url"),
  kopSuratHtml: text("kop_surat_html"),
  footerHtml: text("footer_html"),

  // Bank info
  bankName: text("bank_name").notNull().default(""),
  bankAccount: text("bank_account").notNull().default(""),
  bankHolder: text("bank_holder").notNull().default(""),

  // Finance / TTD
  financeName: text("finance_name").notNull().default(""),
  financeTitle: text("finance_title").notNull().default("Finance Manager"),
  signatureUrl: text("signature_url"),

  // Nomor dokumen
  prefixNumber: text("prefix_number").notNull().default("INV"),

  // Pajak
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default("11"),

  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCompanyDocumentSettingsSchema = createInsertSchema(companyDocumentSettingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCompanyDocumentSettings = z.infer<typeof insertCompanyDocumentSettingsSchema>;
export type CompanyDocumentSettings = typeof companyDocumentSettingsTable.$inferSelect;
export type DocumentType = typeof documentTypeEnum.enumValues[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  general: "Umum (Default)",
  invoice: "Invoice",
  spp: "SPP",
  kwitansi: "Kwitansi",
  lampiran: "Lampiran Pemakaian",
  berita_acara: "Berita Acara",
  surat_pengantar: "Surat Pengantar",
};
