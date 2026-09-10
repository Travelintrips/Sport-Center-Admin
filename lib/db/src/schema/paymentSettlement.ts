import { text, serial, timestamp, integer, boolean, date, unique, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { scSchema } from "./_schema";

/**
 * Effective-dated settlement configuration.  This is intentionally separate
 * from the UAT-only tables so production configuration cannot be inferred
 * from a fixture row.
 */
export const paymentSettlementConfigsTable = scSchema.table(
  "payment_settlement_configs",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    providerCode: text("provider_code").notNull(),
    bankAccountId: text("bank_account_id").notNull(),
    settlementDelayBusinessDays: integer("settlement_delay_business_days").notNull().default(1),
    effectiveFrom: date("effective_from").notNull(),
    effectiveUntil: date("effective_until"),
    isActive: boolean("is_active").notNull().default(true),
    source: text("source").notNull().default("admin_config"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("payment_settlement_configs_unique").on(
      table.companyId,
      table.providerCode,
      table.bankAccountId,
      table.effectiveFrom,
    ),
  ],
);

export const bankImportSourceMappingsTable = scSchema.table(
  "bank_import_source_mappings",
  {
    id: serial("id").primaryKey(),
    sourceType: text("source_type").notNull().default("google_sheet"),
    sourceId: text("source_id").notNull(),
    worksheetName: text("worksheet_name"),
    companyId: integer("company_id").notNull(),
    bankAccountId: text("bank_account_id").notNull(),
    providerName: text("provider_name"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("bank_import_source_mappings_unique").on(
      table.sourceType,
      table.sourceId,
      table.worksheetName,
    ),
  ],
);

export const paymentBusinessCalendarTable = scSchema.table(
  "payment_business_calendar",
  {
    calendarDate: date("calendar_date").notNull(),
    isBusinessDay: boolean("is_business_day").notNull().default(true),
    label: text("label"),
    source: text("source").notNull().default("admin_config"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.calendarDate], name: "payment_business_calendar_pkey" })],
);

export const insertPaymentSettlementConfigSchema = createInsertSchema(paymentSettlementConfigsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertBankImportSourceMappingSchema = createInsertSchema(bankImportSourceMappingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertPaymentBusinessCalendarSchema = createInsertSchema(paymentBusinessCalendarTable).omit({
  updatedAt: true,
});

export type InsertPaymentSettlementConfig = z.infer<typeof insertPaymentSettlementConfigSchema>;
export type InsertBankImportSourceMapping = z.infer<typeof insertBankImportSourceMappingSchema>;
export type PaymentSettlementConfig = typeof paymentSettlementConfigsTable.$inferSelect;
export type BankImportSourceMapping = typeof bankImportSourceMappingsTable.$inferSelect;
export type PaymentBusinessCalendar = typeof paymentBusinessCalendarTable.$inferSelect;