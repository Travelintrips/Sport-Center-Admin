import { text, serial, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { scSchema } from "./_schema";

export const invoiceStatusEnum = scSchema.enum("invoice_status", ["unpaid", "paid"]);

export const companyInvoicesTable = scSchema.table("company_invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  companyCustomerId: integer("company_customer_id").notNull().references(() => usersTable.id),
  periodMonth: text("period_month").notNull(),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  ppnAmount: numeric("ppn_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  grandTotal: numeric("grand_total", { precision: 14, scale: 2 }).notNull().default("0"),
  status: invoiceStatusEnum("invoice_status").notNull().default("unpaid"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCompanyInvoiceSchema = createInsertSchema(companyInvoicesTable).omit({ id: true, createdAt: true });
export type InsertCompanyInvoice = z.infer<typeof insertCompanyInvoiceSchema>;
export type CompanyInvoice = typeof companyInvoicesTable.$inferSelect;
