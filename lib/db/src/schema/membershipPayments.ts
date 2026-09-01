import { index, integer, numeric, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { scSchema } from "./_schema";
import { gymMembershipsTable } from "./memberships";

export const membershipPaymentStatuses = [
  "pending_payment",
  "waiting_confirmation",
  "confirmed",
  "cancelled",
] as const;

export const membershipPaymentsTable = scSchema.table(
  "sport_membership_payments",
  {
    id: serial("id").primaryKey(),
    membershipId: integer("membership_id")
      .notNull()
      .references(() => gymMembershipsTable.id, { onDelete: "cascade" }),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    months: integer("months").notNull().default(1),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    status: text("status", { enum: membershipPaymentStatuses }).notNull().default("pending_payment"),
    paymentMethod: text("payment_method"),
    paymentProofUrl: text("payment_proof_url"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    mutationKey: text("mutation_key"),
    accountingRef: text("accounting_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("sport_membership_payments_membership_idx").on(table.membershipId),
    index("sport_membership_payments_period_idx").on(table.periodStart, table.periodEnd),
    index("sport_membership_payments_status_idx").on(table.status),
    uniqueIndex("sport_membership_payments_mutation_key_idx").on(table.mutationKey),
    uniqueIndex("sport_membership_payments_accounting_ref_idx").on(table.accountingRef),
  ],
);

export const insertMembershipPaymentSchema = createInsertSchema(membershipPaymentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertMembershipPayment = z.infer<typeof insertMembershipPaymentSchema>;
export type MembershipPayment = typeof membershipPaymentsTable.$inferSelect;