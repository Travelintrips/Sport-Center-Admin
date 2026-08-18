import { text, serial, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { scSchema } from "./_schema";
import { accountingJournalsTable } from "./accountingJournals";

export const accountingJournalLinesTable = scSchema.table("accounting_journal_lines", {
  id: serial("id").primaryKey(),
  journalId: integer("journal_id").notNull().references(() => accountingJournalsTable.id, { onDelete: "cascade" }),
  lineType: text("line_type").notNull(),
  accountCode: text("account_code").notNull(),
  accountName: text("account_name").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAccountingJournalLineSchema = createInsertSchema(accountingJournalLinesTable).omit({ id: true, createdAt: true });
export type InsertAccountingJournalLine = z.infer<typeof insertAccountingJournalLineSchema>;
export type AccountingJournalLine = typeof accountingJournalLinesTable.$inferSelect;
