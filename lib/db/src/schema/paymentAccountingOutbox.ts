import { serial, integer, text, timestamp, numeric } from "drizzle-orm/pg-core";
import { scSchema } from "./_schema";

export const paymentAccountingOutboxTable = scSchema.table("payment_accounting_outbox", {
  id: serial("id").primaryKey(),
  paymentId: integer("payment_id").notNull(),
  eventType: text("event_type").notNull().default("payment_confirmed"),
  sourceProject: text("source_project").notNull().default("SPORT_CENTER"),
  sourceSchema: text("source_schema").notNull().default("sport_center"),
  sourceTable: text("source_table").notNull().default("sport_payments"),
  bookingId: integer("booking_id"),
  companyId: integer("company_id"),
  amount: numeric("amount", { precision: 14, scale: 2 }),
  paymentType: text("payment_type"),
  paymentMethod: text("payment_method"),
  paymentProvider: text("payment_provider"),
  providerReference: text("provider_reference"),
  providerOrderId: text("provider_order_id"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  correlationId: text("correlation_id"),
  schemaVersion: integer("schema_version").notNull().default(1),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PaymentAccountingOutbox = typeof paymentAccountingOutboxTable.$inferSelect;