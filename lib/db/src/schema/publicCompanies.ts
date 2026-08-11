import { boolean, integer, pgTable, text } from "drizzle-orm/pg-core";

/**
 * Canonical legal/accounting company master owned by the public schema.
 *
 * Sport Center login identities remain in sport_center.users and must not be
 * used as company ownership records.
 */
export const publicCompaniesTable = pgTable("companies", {
  id: integer("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name"),
  isActive: boolean("is_active").notNull(),
});

export type PublicCompany = typeof publicCompaniesTable.$inferSelect;