import { serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { scSchema } from "./_schema";

export const paymentAccountingOutboxTable = scSchema.table("payment_accounting_outbox", {
  id: serial("id").primaryKey(),
  paymentId: integer("payment_id").notNull(),
  eventType: text("event_type").notNull().default("payment_confirmed"),
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