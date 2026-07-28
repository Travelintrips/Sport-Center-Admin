import { text, serial, timestamp, numeric, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { scSchema } from "./_schema";
import { bookingsTable } from "./bookings";

export const accountingJournalsTable = scSchema.table("accounting_journals", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").references(() => bookingsTable.id, { onDelete: "cascade" }),
  orderNumber: text("order_number").notNull(),
  journalType: text("journal_type").notNull(),
  debitAccount: text("debit_account").notNull().default("Kas/Bank"),
  debitAmount: numeric("debit_amount", { precision: 14, scale: 2 }).notNull(),
  creditRevenueAccount: text("credit_revenue_account").notNull().default("Pendapatan Sport Center"),
  creditRevenueAmount: numeric("credit_revenue_amount", { precision: 14, scale: 2 }).notNull(),
  creditPpnAccount: text("credit_ppn_account").notNull().default("PPN Keluaran"),
  creditPpnAmount: numeric("credit_ppn_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  journalDate: text("journal_date").notNull(),
  isReversal: boolean("is_reversal").notNull().default(false),
  reversalOfId: integer("reversal_of_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAccountingJournalSchema = createInsertSchema(accountingJournalsTable).omit({ id: true, createdAt: true });
export type InsertAccountingJournal = z.infer<typeof insertAccountingJournalSchema>;
export type AccountingJournal = typeof accountingJournalsTable.$inferSelect;
