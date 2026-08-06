import { text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { scSchema } from "./_schema";
import { bookingsTable } from "./bookings";
import { usersTable } from "./users";

export const corporateBookingDocumentationTable = scSchema.table(
  "corporate_booking_documentation",
  {
    id: serial("id").primaryKey(),
    bookingId: integer("booking_id")
      .notNull()
      .references(() => bookingsTable.id, { onDelete: "cascade" }),
    companyId: integer("company_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    /** "customer" | "admin" */
    uploadedBy: text("uploaded_by").notNull().default("customer"),
    fileUrl: text("file_url").notNull(),
    fileName: text("file_name"),
    caption: text("caption"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const insertCorporateBookingDocumentationSchema =
  createInsertSchema(corporateBookingDocumentationTable).omit({
    id: true,
    createdAt: true,
  });

export type InsertCorporateBookingDocumentation = z.infer<
  typeof insertCorporateBookingDocumentationSchema
>;
export type CorporateBookingDocumentation =
  typeof corporateBookingDocumentationTable.$inferSelect;
