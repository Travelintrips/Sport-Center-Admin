import { text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { scSchema } from "./_schema";

export const systemConnectionBaselinesTable = scSchema.table("system_connection_baselines", {
  id: serial("id").primaryKey(),
  connectionKey: text("connection_key").notNull().unique(),
  connectionName: text("connection_name").notNull(),
  connectionType: text("connection_type").notNull(),
  expectedEnvironment: text("expected_environment"),
  expectedProjectRef: text("expected_project_ref"),
  currentProjectRef: text("current_project_ref"),
  currentHost: text("current_host"),
  status: text("status").notNull().default("unchecked"),
  responseTimeMs: integer("response_time_ms"),
  lastMessage: text("last_message"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  changeDetectedAt: timestamp("change_detected_at", { withTimezone: true }),
  changeMessage: text("change_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SystemConnectionBaseline = typeof systemConnectionBaselinesTable.$inferSelect;
