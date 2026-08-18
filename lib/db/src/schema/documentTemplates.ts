import { text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { scSchema } from "./_schema";

export const companyDocumentTemplatesTable = scSchema.table("company_document_templates", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => usersTable.id, { onDelete: "cascade" }),
  documentType: text("document_type").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  headerLogoUrl: text("header_logo_url"),
  kopSuratHtml: text("kop_surat_html"),
  footerHtml: text("footer_html"),
  companyDisplayName: text("company_display_name"),
  financeName: text("finance_name"),
  financeTitle: text("finance_title"),
  financeSignature: text("finance_signature"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  numberFormatPrefix: text("number_format_prefix"),
  numberFormatPattern: text("number_format_pattern"),
  paperStyle: text("paper_style").notNull().default("A4"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const documentNumberSequencesTable = scSchema.table("document_number_sequences", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id"),
  documentType: text("document_type").notNull(),
  year: integer("year").notNull(),
  currentSeq: integer("current_seq").notNull().default(0),
});

export const insertDocumentTemplateSchema = createInsertSchema(companyDocumentTemplatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDocumentTemplate = z.infer<typeof insertDocumentTemplateSchema>;
export type DocumentTemplate = typeof companyDocumentTemplatesTable.$inferSelect;
export type DocumentNumberSequence = typeof documentNumberSequencesTable.$inferSelect;

// ─── Document File Templates (image/PDF background override) ──────────────────
export const documentFileTemplatesTable = scSchema.table("document_file_templates", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id"),
  documentType: text("document_type").notNull(),
  templateType: text("template_type").notNull().default("image"),
  fileUrl: text("file_url").notNull(),
  fileName: text("file_name"),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type DocumentFileTemplate = typeof documentFileTemplatesTable.$inferSelect;
