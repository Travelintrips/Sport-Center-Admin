import { text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { facilitiesTable } from "./facilities";
import { scSchema } from "./_schema";

export const blockedSchedulesTable = scSchema.table("blocked_schedules", {
  id: serial("id").primaryKey(),
  facilityId: integer("facility_id").notNull().references(() => facilitiesTable.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBlockedScheduleSchema = createInsertSchema(blockedSchedulesTable).omit({ id: true, createdAt: true });
export type InsertBlockedSchedule = z.infer<typeof insertBlockedScheduleSchema>;
export type BlockedSchedule = typeof blockedSchedulesTable.$inferSelect;
