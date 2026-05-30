import { text, serial, timestamp, numeric, integer, boolean, time } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { facilitiesTable } from "./facilities";
import { scSchema } from "./_schema";

export const pricingRulesTable = scSchema.table("pricing_rules", {
  id: serial("id").primaryKey(),
  facilityId: integer("facility_id").references(() => facilitiesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  ruleType: text("rule_type").notNull(),
  dayType: text("day_type"),
  peakStartTime: text("peak_start_time"),
  peakEndTime: text("peak_end_time"),
  priceOverride: numeric("price_override", { precision: 12, scale: 2 }),
  priceAddon: numeric("price_addon", { precision: 12, scale: 2 }),
  priceMultiplier: numeric("price_multiplier", { precision: 5, scale: 3 }),
  isActive: boolean("is_active").notNull().default(true),
  priority: integer("priority").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPricingRuleSchema = createInsertSchema(pricingRulesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPricingRule = z.infer<typeof insertPricingRuleSchema>;
export type PricingRule = typeof pricingRulesTable.$inferSelect;
