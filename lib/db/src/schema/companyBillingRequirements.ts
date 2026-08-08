import { text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { scSchema } from "./_schema";

export const BILLING_DOCUMENT_TYPES = [
  "invoice",
  "faktur_pajak",
  "kwitansi",
  "spp",
  "lampiran_pemakaian",
  "dokumentasi",
  "berita_acara",
  "surat_pengantar",
  "materai",
  "custom_document",
] as const;

export type BillingDocumentType = typeof BILLING_DOCUMENT_TYPES[number];

export const BILLING_DOCUMENT_LABELS: Record<BillingDocumentType, string> = {
  invoice: "Invoice",
  faktur_pajak: "Faktur Pajak",
  kwitansi: "Kwitansi",
  spp: "SPP (Surat Permohonan Pembayaran)",
  lampiran_pemakaian: "Lampiran Pemakaian",
  dokumentasi: "Dokumentasi",
  berita_acara: "Berita Acara",
  surat_pengantar: "Surat Pengantar",
  materai: "Materai",
  custom_document: "Dokumen Kustom",
};

export const companyBillingRequirementsTable = scSchema.table("company_billing_requirements", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  documentType: text("document_type").notNull(),
  required: boolean("required").notNull().default(true),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCompanyBillingRequirementSchema = createInsertSchema(companyBillingRequirementsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCompanyBillingRequirement = z.infer<typeof insertCompanyBillingRequirementSchema>;
export type CompanyBillingRequirement = typeof companyBillingRequirementsTable.$inferSelect;
