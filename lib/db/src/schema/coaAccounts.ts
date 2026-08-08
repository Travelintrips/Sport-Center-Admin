import { text, serial, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { scSchema } from "./_schema";

export const coaAccountTypeEnum = scSchema.enum("coa_account_type", [
  "asset",
  "liability",
  "equity",
  "revenue",
  "expense",
]);

export const coaAccountsTable = scSchema.table("coa_accounts", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  accountType: coaAccountTypeEnum("account_type").notNull(),
  parentCode: text("parent_code"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type CoaAccount = typeof coaAccountsTable.$inferSelect;
