import { text, serial, timestamp, numeric, integer, uniqueIndex } from "drizzle-orm/pg-core";
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
}, (t) => ({
  uniqueCompanyPeriod: uniqueIndex("company_invoices_company_period_unique").on(t.companyCustomerId, t.periodMonth),
}));

export const companyInvoiceItemsTable = scSchema.table("company_invoice_items", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => companyInvoicesTable.id, { onDelete: "cascade" }),
  bookingId: integer("booking_id"),
  companyId: integer("company_id"),
  bookingDate: text("booking_date"),
  facilityName: text("facility_name"),
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"),
  startTime: text("start_time"),
  endTime: text("end_time"),
  durationHours: numeric("duration_hours", { precision: 6, scale: 2 }),
  pricePerHour: numeric("price_per_hour", { precision: 12, scale: 2 }),
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }),
  taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }),
  orderNumber: text("order_number"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCompanyInvoiceSchema = createInsertSchema(companyInvoicesTable).omit({ id: true, createdAt: true });
export const insertCompanyInvoiceItemSchema = createInsertSchema(companyInvoiceItemsTable).omit({ id: true, createdAt: true });
export type InsertCompanyInvoice = z.infer<typeof insertCompanyInvoiceSchema>;
export type InsertCompanyInvoiceItem = z.infer<typeof insertCompanyInvoiceItemSchema>;
export type CompanyInvoice = typeof companyInvoicesTable.$inferSelect;
export type CompanyInvoiceItem = typeof companyInvoiceItemsTable.$inferSelect;
