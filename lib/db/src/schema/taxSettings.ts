import { text, serial, timestamp, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { scSchema } from "./_schema";

export const taxSettingsTable = scSchema.table("tax_settings", {
  id: serial("id").primaryKey(),
  taxCode: text("tax_code").notNull().unique(),
  taxName: text("tax_name").notNull(),
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull(),
  taxType: text("tax_type").notNull().default("output_vat"),
  appliesTo: text("applies_to").notNull().default("sport_booking"),
  isActive: boolean("is_active").notNull().default(true),
  // Backward compatibility: PPN only applies to bookings on/after this date.
  // NULL means PPN always applies (no restriction).
  effectiveDate: text("effective_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTaxSettingSchema = createInsertSchema(taxSettingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTaxSetting = z.infer<typeof insertTaxSettingSchema>;
export type TaxSetting = typeof taxSettingsTable.$inferSelect;
