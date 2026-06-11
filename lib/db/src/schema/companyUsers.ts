import { text, serial, timestamp, integer, boolean, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { scSchema } from "./_schema";

export const companyVerificationStatusEnum = scSchema.enum("company_verification_status", [
  "pending",
  "approved",
  "rejected",
  "revoked",
]);

export const companyUsersTable = scSchema.table(
  "company_users",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    customerId: integer("customer_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    employeeId: text("employee_id").notNull(),
    officeEmail: text("office_email"),
    idCardUrl: text("id_card_url"),
    verificationStatus: companyVerificationStatusEnum("verification_status").notNull().default("pending"),
    corporateBillingEnabled: boolean("corporate_billing_enabled").notNull().default(false),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedBy: integer("verified_by").references(() => usersTable.id, { onDelete: "set null" }),
    rejectionReason: text("rejection_reason"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [unique("company_users_company_employee_unique").on(table.companyId, table.employeeId)],
);

export const insertCompanyUserSchema = createInsertSchema(companyUsersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCompanyUser = z.infer<typeof insertCompanyUserSchema>;
export type CompanyUser = typeof companyUsersTable.$inferSelect;
