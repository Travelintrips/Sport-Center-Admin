import { text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { scSchema } from "./_schema";

export const waNotifLogsTable = scSchema.table("wa_notif_logs", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id"),
  orderNumber: text("order_number"),
  event: text("event"),
  recipientPhone: text("recipient_phone").notNull(),
  messagePreview: text("message_preview"),
  status: text("status").notNull().default("sent"),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWaNotifLogSchema = createInsertSchema(waNotifLogsTable).omit({ id: true, sentAt: true });
export type InsertWaNotifLog = z.infer<typeof insertWaNotifLogSchema>;
export type WaNotifLog = typeof waNotifLogsTable.$inferSelect;
