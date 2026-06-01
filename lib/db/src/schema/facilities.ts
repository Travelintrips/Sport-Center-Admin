import { text, serial, timestamp, numeric, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { scSchema } from "./_schema";

export const facilitiesTable = scSchema.table("facilities", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  description: text("description"),
  pricePerHour: numeric("price_per_hour", { precision: 12, scale: 2 }).notNull(),
  openTime: text("open_time").notNull().default("06:00"),
  closeTime: text("close_time").notNull().default("22:00"),
  minDuration: integer("min_duration").notNull().default(1),
  maxDuration: integer("max_duration"),
  capacity: integer("capacity"),
  bookingMode: text("booking_mode").notNull().default("time_slot"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const facilityImagesTable = scSchema.table("facility_images", {
  id: serial("id").primaryKey(),
  facilityId: integer("facility_id").notNull().references(() => facilitiesTable.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  isPrimary: boolean("is_primary").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFacilitySchema = createInsertSchema(facilitiesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFacility = z.infer<typeof insertFacilitySchema>;
export type Facility = typeof facilitiesTable.$inferSelect;

export const insertFacilityImageSchema = createInsertSchema(facilityImagesTable).omit({ id: true, createdAt: true });
export type InsertFacilityImage = z.infer<typeof insertFacilityImageSchema>;
export type FacilityImage = typeof facilityImagesTable.$inferSelect;
