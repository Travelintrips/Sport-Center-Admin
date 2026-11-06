import { integer, text, timestamp, numeric } from "drizzle-orm/pg-core";
import { scSchema } from "./_schema";
import { scEmployeesTable } from "./scEmployees";
export const scEmployeeKasbonTable = scSchema.table("sc_employee_kasbon", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  employeeId: text("employee_id").notNull().references(() => scEmployeesTable.employeeId, { onDelete: "restrict" }),
  kasbonDate: text("kasbon_date").notNull(),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  notes: text("notes").notNull(),
  proofUrl: text("proof_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});