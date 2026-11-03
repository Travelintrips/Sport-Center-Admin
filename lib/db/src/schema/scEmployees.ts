import { boolean, text, timestamp } from "drizzle-orm/pg-core";
import { scSchema } from "./_schema";

export const scEmployeesTable = scSchema.table("sc_employees", {
  employeeId: text("employee_id").primaryKey(),
  fullName: text("full_name").notNull(),
  whatsappNumber: text("whatsapp_number").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
