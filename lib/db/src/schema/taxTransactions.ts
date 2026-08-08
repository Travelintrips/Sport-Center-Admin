import { text, serial, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { scSchema } from "./_schema";

export const taxTransactionsTable = scSchema.table("tax_transactions", {
  id: serial("id").primaryKey(),
  referenceType: text("reference_type").notNull(),
  referenceId: integer("reference_id").notNull(),
  referenceNumber: text("reference_number").notNull(),
  taxCode: text("tax_code").notNull(),
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull(),
  dpp: numeric("dpp", { precision: 14, scale: 2 }).notNull(),
  dppNilaiLain: numeric("dpp_nilai_lain", { precision: 14, scale: 2 }),
  grandTotal: numeric("grand_total", { precision: 14, scale: 2 }),
  taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }).notNull(),
  transactionDate: text("transaction_date").notNull(),
  status: text("status").notNull().default("posted"),
  transactionType: text("transaction_type").notNull().default("original"),
  reversalOfId: integer("reversal_of_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTaxTransactionSchema = createInsertSchema(taxTransactionsTable).omit({ id: true, createdAt: true });
export type InsertTaxTransaction = z.infer<typeof insertTaxTransactionSchema>;
export type TaxTransaction = typeof taxTransactionsTable.$inferSelect;
