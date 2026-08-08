import { text, serial, timestamp, numeric, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { bookingsTable } from "./bookings";
import { scSchema } from "./_schema";

export const paymentStatusEnum = scSchema.enum("payment_status", ["pending", "confirmed", "rejected"]);
export const paymentTypeEnum = scSchema.enum("payment_type", ["dp", "pelunasan", "full_payment"]);
export const paymentProviderEnum = scSchema.enum("payment_provider", ["mandiri_direct", "paylabs", "unknown"]);

export const paymentsTable = scSchema.table("sport_payments", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull().references(() => bookingsTable.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  proofUrl: text("proof_url"),
  paymentMethod: text("payment_method").default("Transfer Bank"),
  paymentProvider: paymentProviderEnum("payment_provider"),
  providerReference: text("provider_reference"),
  merchantTradeNo: text("merchant_trade_no"),
  providerTradeNo: text("provider_trade_no"),
  paymentType: paymentTypeEnum("payment_type").notNull().default("full_payment"),
  status: paymentStatusEnum("status").notNull().default("pending"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  notes: text("notes"),
  ocrName: text("ocr_name"),
  ocrAmount: numeric("ocr_amount", { precision: 14, scale: 2 }),
  ocrDate: text("ocr_date"),
  ocrRaw: text("ocr_raw"),
  ocrData: jsonb("ocr_data"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
