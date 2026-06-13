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

export const bankMutationsTable = scSchema.table("bank_mutations", {
  id: serial("id").primaryKey(),
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
  providerOrderId: text("provider_order_id"),
  rawPayload: jsonb("raw_payload"),
  status: bankMutationStatusEnum("status").notNull().default("unmatched"),
  matchedPaymentId: integer("matched_payment_id"),
  matchedOrderId: integer("matched_order_id"),
  uploadedProofUrl: text("uploaded_proof_url"),
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

export const insertBankMutationSchema = createInsertSchema(bankMutationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertBankReconciliationMatchSchema = createInsertSchema(bankReconciliationMatchesTable).omit({ id: true, createdAt: true });

export type BankMutation = typeof bankMutationsTable.$inferSelect;
export type InsertBankMutation = z.infer<typeof insertBankMutationSchema>;
export type BankReconciliationMatch = typeof bankReconciliationMatchesTable.$inferSelect;
export type InsertBankReconciliationMatch = z.infer<typeof insertBankReconciliationMatchSchema>;
export type BankJournalEntry = typeof bankJournalEntriesTable.$inferSelect;
