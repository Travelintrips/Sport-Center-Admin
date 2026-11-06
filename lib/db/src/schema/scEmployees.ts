import { boolean, numeric, text, timestamp } from "drizzle-orm/pg-core";
import { scSchema } from "./_schema";
import { sql } from "drizzle-orm";

export const scEmployeesTable = scSchema.table("sc_employees", {
  employeeId: text("employee_id").primaryKey().default(sql`'SC' || lpad(nextval('sport_center.sc_employees_id_seq'::regclass)::text, 3, '0')`),
  fullName: text("full_name").notNull(),
  whatsappNumber: text("whatsapp_number").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  salary: numeric("salary", {precision: 15, scale: 2}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
