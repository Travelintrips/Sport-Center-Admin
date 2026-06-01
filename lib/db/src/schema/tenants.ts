import { text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { scSchema } from "./_schema";

export const tenantsTable = scSchema.table("tenants", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique().references(() => usersTable.id, { onDelete: "cascade" }),
  businessName: text("business_name").notNull(),
  ownerName: text("owner_name").notNull(),
  phone: text("phone"),
  email: text("email"),
  businessCategory: text("business_category"),
  logoUrl: text("logo_url"),
  address: text("address"),
  status: text("status", { enum: ["pending", "active", "inactive"] }).notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTenantSchema = createInsertSchema(tenantsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type Tenant = typeof tenantsTable.$inferSelect;
