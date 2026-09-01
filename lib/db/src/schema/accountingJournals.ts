import { text, serial, timestamp, numeric, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { scSchema } from "./_schema";
import { bookingsTable } from "./bookings";

export const accountingJournalsTable = scSchema.table("accounting_journals", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").references(() => bookingsTable.id, { onDelete: "cascade" }),
  paymentId: integer("payment_id"),
  companyId: integer("company_id"),
  orderNumber: text("order_number").notNull(),
  journalType: text("journal_type").notNull(),
  status: text("status").notNull().default("posted"),
  paymentMethod: text("payment_method"),
  paymentProvider: text("payment_provider"),
  providerName: text("provider_name"),
  providerId: text("provider_id"),
  paymentType: text("payment_type"),
  bankAccountId: text("bank_account_id"),
  expectedSettlementDate: text("expected_settlement_date"),
  settlementStatus: text("settlement_status"),
  mdrRate: numeric("mdr_rate", { precision: 8, scale: 5 }),
  mdrAmount: numeric("mdr_amount", { precision: 14, scale: 2 }),
  grossAmount: numeric("gross_amount", { precision: 14, scale: 2 }),
  dppAmount: numeric("dpp_amount", { precision: 14, scale: 2 }),
  taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }),
  providerReference: text("provider_reference"),
  providerOrderId: text("provider_order_id"),
  merchantTradeNo: text("merchant_trade_no"),
  providerTradeNo: text("provider_trade_no"),
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
