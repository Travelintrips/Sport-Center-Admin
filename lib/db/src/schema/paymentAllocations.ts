import { serial, integer, numeric, timestamp, unique } from "drizzle-orm/pg-core";
import { scSchema } from "./_schema";
import { bookingsTable } from "./bookings";
import { paymentsTable } from "./payments";

/**
 * A payment allocation is only an invoice-allocation reference. It is not a
 * payment, journal, tax transaction, or BizPortal mirror.
 */
export const paymentAllocationsTable = scSchema.table("sport_payment_allocations", {
  id: serial("id").primaryKey(),
  paymentId: integer("payment_id").notNull().references(() => paymentsTable.id, { onDelete: "cascade" }),
  bookingId: integer("booking_id").notNull().references(() => bookingsTable.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  paymentBookingUnique: unique("sport_payment_allocations_payment_booking_unique")
    .on(table.paymentId, table.bookingId),
}));

export type PaymentAllocation = typeof paymentAllocationsTable.$inferSelect;