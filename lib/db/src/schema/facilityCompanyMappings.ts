import { boolean, date, integer, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { facilitiesTable } from "./facilities";
import { scSchema } from "./_schema";
import { usersTable } from "./users";

/**
 * Canonical, effective-dated operational ownership for Sport Center
 * facilities.  A company account is still validated by the database trigger
 * during writes; the FK only guarantees that the referenced user exists.
 */
export const facilityCompanyMappingsTable = scSchema.table("facility_company_mappings", {
  id: serial("id").primaryKey(),
  facilityId: integer("facility_id").notNull().references(() => facilitiesTable.id, { onDelete: "cascade" }),
  companyId: integer("company_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  effectiveFrom: date("effective_from").notNull(),
  effectiveUntil: date("effective_until"),
  isActive: boolean("is_active").notNull().default(true),
  source: text("source").notNull().default("admin_config"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFacilityCompanyMappingSchema = createInsertSchema(facilityCompanyMappingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertFacilityCompanyMapping = z.infer<typeof insertFacilityCompanyMappingSchema>;
export type FacilityCompanyMapping = typeof facilityCompanyMappingsTable.$inferSelect;