import { text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { bookingsTable } from "./bookings";
import { scSchema } from "./_schema";

export const waActionTokensTable = scSchema.table("wa_action_tokens", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  bookingId: integer("booking_id").notNull().references(() => bookingsTable.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WaActionToken = typeof waActionTokensTable.$inferSelect;
