import { pgTable, serial, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";

export const publicMembershipsTable = pgTable("sport_center_memberships", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id"),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  months: integer("months").notNull().default(1),
  totalPrice: numeric("total_price", { precision: 12, scale: 2 }).notNull(),
  status: text("status").notNull().default("pending_payment"),
  notes: text("notes"),
  paymentMethod: text("payment_method"),
  paymentProofUrl: text("payment_proof_url"),
  source: text("source").notNull().default("sport_center"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PublicMembership = typeof publicMembershipsTable.$inferSelect;
