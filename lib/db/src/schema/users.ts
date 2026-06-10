import { text, serial, timestamp, integer, boolean, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { scSchema } from "./_schema";

export const userRoleEnum = scSchema.enum("user_role", ["admin", "super_admin", "admin_booking", "finance", "staff", "customer", "tenant", "ap2_employee"]);
export const userAccountTypeEnum = scSchema.enum("user_account_type", ["personal", "company"]);

export const usersTable = scSchema.table("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").unique(),
  passwordHash: text("password_hash"),
  googleId: text("google_id").unique(),
  role: userRoleEnum("role").notNull().default("customer"),
  phone: text("phone"),
  tenantId: integer("tenant_id"),
  customerCode: text("customer_code").unique(),
  registrationSource: text("registration_source").default("web"),
  // Company account fields
  accountType: userAccountTypeEnum("account_type").default("personal"),
  companyName: text("company_name"),
  picName: text("pic_name"),
  picPhone: text("pic_phone"),
  picEmail: text("pic_email"),
  billingAddress: text("billing_address"),
  paymentTermsDays: integer("payment_terms_days").default(30),
  monthlyCreditLimit: numeric("monthly_credit_limit", { precision: 14, scale: 2 }),
  allowMonthlyBilling: boolean("allow_monthly_billing").default(false),
  accountStatus: text("account_status").default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
