import { text, serial, timestamp, numeric, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { facilitiesTable } from "./facilities";
import { usersTable } from "./users";
import { scSchema } from "./_schema";
import { coaAccountsTable } from "./coaAccounts";

export const expenseStatusEnum = scSchema.enum("expense_status", [
  "draft",
  "pending_approval",
  "approved",
  "paid",
  "rejected",
  "cancelled",
]);

export const expenseCategoryEnum = scSchema.enum("expense_category", [
  "Alat Gym",
  "Bola & Peralatan Olahraga",
  "Perbaikan Lapangan",
  "Maintenance Fasilitas",
  "Listrik & Air",
  "Kebersihan",
  "Gaji / Fee Staff",
  "Sewa / Vendor",
  "Lain-lain",
]);

export const expensesTable = scSchema.table("sport_expenses", {
  id: serial("id").primaryKey(),
  expenseNo: text("expense_no").notNull(),
  expenseDate: text("expense_date").notNull(),
  category: expenseCategoryEnum("category").notNull().default("Lain-lain"),
  coaAccountId: integer("coa_account_id").references(() => coaAccountsTable.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  vendorName: text("vendor_name"),
  facilityId: integer("facility_id").references(() => facilitiesTable.id, { onDelete: "set null" }),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  ppnAmount: numeric("ppn_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull(),
  paymentMethod: text("payment_method"),
  paymentAccount: text("payment_account"),
  paymentStatus: expenseStatusEnum("payment_status").notNull().default("draft"),
  receiptUrl: text("receipt_url"),
  receiptUrls: jsonb("receipt_urls").$type<string[]>().default([]),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  approvedBy: integer("approved_by").references(() => usersTable.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  rejectedReason: text("rejected_reason"),
  journalId: text("journal_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertExpenseSchema = createInsertSchema(expensesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type Expense = typeof expensesTable.$inferSelect;
