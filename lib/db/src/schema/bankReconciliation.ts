import { text, serial, timestamp, numeric, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { scSchema } from "./_schema";

export const bankMutationStatusEnum = scSchema.enum("bank_mutation_status", [
  "unmatched",
  "need_review",
  "auto_matched",
  "matched",
  "duplicate_need_review",
  "approved",
  "rejected",
]);

export const reconMatchStatusEnum = scSchema.enum("recon_match_status", [
  "candidate", "approved", "rejected",
]);

export const reconCandidateTypeEnum = scSchema.enum("recon_candidate_type", [
  "payment", "order", "invoice", "expense",
]);

export const bankAccountBalancesTable = scSchema.table("bank_account_balances", {
  id: serial("id").primaryKey(),
  bankAccountId: text("bank_account_id").notNull(),
  companyId: integer("company_id"),
  openingBalance: numeric("opening_balance", { precision: 14, scale: 2 }).notNull().default("0"),
  currentBalance: numeric("current_balance", { precision: 14, scale: 2 }).notNull().default("0"),
  lastReconciledBalance: numeric("last_reconciled_balance", { precision: 14, scale: 2 }).default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bankMutationsTable = scSchema.table("bank_mutations", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id"),
  bankAccountId: text("bank_account_id"),
  transactionDate: text("transaction_date").notNull(),
  description: text("description").notNull(),
  creditAmount: numeric("credit_amount", { precision: 14, scale: 2 }).default("0"),
  debitAmount: numeric("debit_amount", { precision: 14, scale: 2 }).default("0"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  direction: text("direction").notNull(),
  mutationKey: text("mutation_key").notNull(),
  normalizedDescription: text("normalized_description"),
  providerName: text("provider_name"),
  providerDetectionSource: text("provider_detection_source"),
  providerOrderId: text("provider_order_id"),
  rawPayload: jsonb("raw_payload"),
  status: bankMutationStatusEnum("status").notNull().default("unmatched"),
  matchedPaymentId: integer("matched_payment_id"),
  matchedOrderId: integer("matched_order_id"),
  uploadedProofUrl: text("uploaded_proof_url"),
  // Tax fields (Phase 3)
  transactionType: text("transaction_type"),
  taxType: text("tax_type"),
  taxPeriod: text("tax_period"),
  taxPaymentReference: text("tax_payment_reference"),
  // Accounting
  accountingPosted: boolean("accounting_posted").notNull().default(false),
  journalId: text("journal_id"),
  // Approval / rejection tracking
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedBy: text("rejected_by"),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const bankReconciliationMatchesTable = scSchema.table("bank_reconciliation_matches", {
  id: serial("id").primaryKey(),
  mutationId: integer("mutation_id").notNull().references(() => bankMutationsTable.id, { onDelete: "cascade" }),
  candidateType: reconCandidateTypeEnum("candidate_type").notNull(),
  candidateId: integer("candidate_id").notNull(),
  matchScore: integer("match_score").notNull().default(0),
  matchReason: text("match_reason"),
  amountMatch: boolean("amount_match").notNull().default(false),
  dateMatch: boolean("date_match").notNull().default(false),
  nameMatch: boolean("name_match").notNull().default(false),
  orderIdMatch: boolean("order_id_match").notNull().default(false),
  proofMatch: boolean("proof_match").notNull().default(false),
  statusValidMatch: boolean("status_valid_match").notNull().default(false),
  toleranceUsed: boolean("tolerance_used").notNull().default(false),
  note: text("note"),
  status: reconMatchStatusEnum("status").notNull().default("candidate"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bankJournalEntriesTable = scSchema.table("bank_journal_entries", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id"),
  journalId: text("journal_id").notNull().unique(),
  mutationId: integer("mutation_id").notNull().references(() => bankMutationsTable.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  debitAccountCode: text("debit_account_code").notNull(),
  debitAccountName: text("debit_account_name").notNull(),
  creditAccountCode: text("credit_account_code").notNull(),
  creditAccountName: text("credit_account_name").notNull(),
  memo: text("memo"),
  candidateType: text("candidate_type"),
  candidateId: integer("candidate_id"),
  postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
  postedBy: text("posted_by"),
});

// Phase 2: Dynamic COA mapping rules per bank account / transaction type
export const bankReconciliationAccountRulesTable = scSchema.table("bank_reconciliation_account_rules", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id"),
  bankAccountId: text("bank_account_id"),
  transactionType: text("transaction_type").notNull(),
  direction: text("direction").notNull(),
  debitCoaId: text("debit_coa_id").notNull(),
  debitCoaName: text("debit_coa_name").notNull(),
  creditCoaId: text("credit_coa_id").notNull(),
  creditCoaName: text("credit_coa_name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// Phase 4: Monthly bank closing
export const bankReconciliationClosingTable = scSchema.table("bank_reconciliation_closing", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id"),
  bankAccountId: text("bank_account_id"),
  periodYear: integer("period_year").notNull(),
  periodMonth: integer("period_month").notNull(),
  openingBalance: numeric("opening_balance", { precision: 14, scale: 2 }).notNull().default("0"),
  totalIn: numeric("total_in", { precision: 14, scale: 2 }).notNull().default("0"),
  totalOut: numeric("total_out", { precision: 14, scale: 2 }).notNull().default("0"),
  systemEndingBalance: numeric("system_ending_balance", { precision: 14, scale: 2 }).notNull().default("0"),
  statementEndingBalance: numeric("statement_ending_balance", { precision: 14, scale: 2 }).notNull().default("0"),
  difference: numeric("difference", { precision: 14, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("unreconciled"),
  closedBy: text("closed_by"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  reopenedBy: text("reopened_by"),
  reopenedAt: timestamp("reopened_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBankMutationSchema = createInsertSchema(bankMutationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertBankReconciliationMatchSchema = createInsertSchema(bankReconciliationMatchesTable).omit({ id: true, createdAt: true });
export const insertBankReconciliationAccountRuleSchema = createInsertSchema(bankReconciliationAccountRulesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertBankReconciliationClosingSchema = createInsertSchema(bankReconciliationClosingTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertBankAccountBalanceSchema = createInsertSchema(bankAccountBalancesTable).omit({ id: true, updatedAt: true });

export type BankMutation = typeof bankMutationsTable.$inferSelect;
export type InsertBankMutation = z.infer<typeof insertBankMutationSchema>;
export type BankReconciliationMatch = typeof bankReconciliationMatchesTable.$inferSelect;
export type InsertBankReconciliationMatch = z.infer<typeof insertBankReconciliationMatchSchema>;
export type BankJournalEntry = typeof bankJournalEntriesTable.$inferSelect;
export type BankReconciliationAccountRule = typeof bankReconciliationAccountRulesTable.$inferSelect;
export type BankReconciliationClosing = typeof bankReconciliationClosingTable.$inferSelect;
export type BankAccountBalance = typeof bankAccountBalancesTable.$inferSelect;
