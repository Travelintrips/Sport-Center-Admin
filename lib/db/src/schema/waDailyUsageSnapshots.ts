import { text, serial, timestamp } from "drizzle-orm/pg-core";
import { scSchema } from "./_schema";

/**
 * Stores the last daily usage-list fingerprint sent to the admin WhatsApp
 * destinations. Keeping this in the database makes the scheduler safe across
 * API restarts and deploys.
 */
export const waDailyUsageSnapshotsTable = scSchema.table("wa_daily_usage_snapshots", {
  id: serial("id").primaryKey(),
  usageDate: text("usage_date").notNull().unique(),
  fingerprint: text("fingerprint").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WaDailyUsageSnapshot = typeof waDailyUsageSnapshotsTable.$inferSelect;