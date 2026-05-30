import { text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { bookingsTable } from "./bookings";
import { facilitiesTable } from "./facilities";
import { scSchema } from "./_schema";

export const bookingReviewsTable = scSchema.table("booking_reviews", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull().references(() => bookingsTable.id, { onDelete: "cascade" }).unique(),
  facilityId: integer("facility_id").notNull().references(() => facilitiesTable.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(),
  comment: text("comment"),
  reviewerName: text("reviewer_name"),
  isPublic: integer("is_public").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBookingReviewSchema = createInsertSchema(bookingReviewsTable).omit({ id: true, createdAt: true });
export type InsertBookingReview = z.infer<typeof insertBookingReviewSchema>;
export type BookingReview = typeof bookingReviewsTable.$inferSelect;
