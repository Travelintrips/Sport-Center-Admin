import { text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { companyUsersTable, companyVerificationStatusEnum } from "./companyUsers";
import { scSchema } from "./_schema";

export const companyVerificationsTable = scSchema.table("company_verifications", {
  id: serial("id").primaryKey(),
  companyUserId: integer("company_user_id").references(() => companyUsersTable.id, { onDelete: "set null" }),
  companyId: integer("company_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  employeeId: text("employee_id").notNull(),
  officeEmail: text("office_email"),
  idCardUrl: text("id_card_url"),
  status: companyVerificationStatusEnum("status").notNull().default("pending"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedBy: integer("approved_by").references(() => usersTable.id, { onDelete: "set null" }),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCompanyVerificationSchema = createInsertSchema(companyVerificationsTable).omit({ id: true, createdAt: true });
export type InsertCompanyVerification = z.infer<typeof insertCompanyVerificationSchema>;
export type CompanyVerification = typeof companyVerificationsTable.$inferSelect;
