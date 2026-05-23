import { pgTable, text, serial, timestamp, numeric, boolean, integer, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const promoTypeEnum = pgEnum("promo_type", ["promo", "event"]);

export const promosTable = pgTable("promos", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  type: promoTypeEnum("type").notNull().default("promo"),
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }),
  startDate: text("start_date"),
  endDate: text("end_date"),
  imageUrl: text("image_url"),
  isActive: boolean("is_active").notNull().default(true),
  code: text("code").unique(),
  discountType: text("discount_type").notNull().default("percent"),
  discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }),
  minPurchase: numeric("min_purchase", { precision: 12, scale: 2 }),
  maxUses: integer("max_uses"),
  usedCount: integer("used_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const promoRegistrationsTable = pgTable("promo_registrations", {
  id: serial("id").primaryKey(),
  promoId: integer("promo_id").notNull().references(() => promosTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  message: text("message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPromoSchema = createInsertSchema(promosTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPromo = z.infer<typeof insertPromoSchema>;
export type Promo = typeof promosTable.$inferSelect;

export const insertPromoRegistrationSchema = createInsertSchema(promoRegistrationsTable).omit({ id: true, createdAt: true });
export type InsertPromoRegistration = z.infer<typeof insertPromoRegistrationSchema>;
export type PromoRegistration = typeof promoRegistrationsTable.$inferSelect;
