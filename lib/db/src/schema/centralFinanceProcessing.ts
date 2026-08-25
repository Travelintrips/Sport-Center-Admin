import { integer, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { scSchema } from "./_schema";

export const centralFinanceProcessingTable = scSchema.table(
  "central_finance_processing",
  {
    id: serial("id").primaryKey(),
    sourceProject: text("source_project").notNull(),
    sourcePaymentId: integer("source_payment_id").notNull(),
    eventType: text("event_type").notNull(),
    correlationId: text("correlation_id").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    lastError: text("last_error"),
    comparisonClass: text("comparison_class"),
    comparisonEvidence: text("comparison_evidence"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("central_finance_processing_identity").on(
      table.sourceProject,
      table.sourcePaymentId,
      table.eventType,
    ),
    unique("central_finance_processing_correlation_unique").on(table.correlationId),
  ],
);

export type CentralFinanceProcessing = typeof centralFinanceProcessingTable.$inferSelect;