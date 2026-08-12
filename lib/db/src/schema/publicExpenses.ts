import { pgTable, serial, text, numeric, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const publicExpensesTable = pgTable("sport_center_expenses", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id"),
  expenseNo: text("expense_no").notNull(),
  expenseDate: text("expense_date").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  vendorName: text("vendor_name"),
  facilityId: integer("facility_id"),
  facilityName: text("facility_name"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  ppnAmount: numeric("ppn_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull(),
  paymentMethod: text("payment_method"),
  paymentAccount: text("payment_account"),
  paymentStatus: text("payment_status").notNull().default("draft"),
  receiptUrl: text("receipt_url"),
  receiptUrls: jsonb("receipt_urls").$type<string[]>().default([]),
  notes: text("notes"),
  rejectedReason: text("rejected_reason"),
  journalId: text("journal_id"),
  source: text("source").notNull().default("sport_center"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PublicExpense = typeof publicExpensesTable.$inferSelect;
