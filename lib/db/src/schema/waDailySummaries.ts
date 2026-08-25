import { text, timestamp } from "drizzle-orm/pg-core";
import { scSchema } from "./_schema";

/**
 * Persistent idempotency marker for the daily admin WhatsApp usage summary.
 * The summary date is the natural key: one admin-group summary per WIB day.
 */
export const waDailySummariesTable = scSchema.table("wa_daily_summaries", {
  summaryDate: text("summary_date").primaryKey(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WaDailySummary = typeof waDailySummariesTable.$inferSelect;