import { text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { companyVerificationsTable } from "./companyVerifications";
import { scSchema } from "./_schema";

export const companyVerificationTokensTable = scSchema.table("company_verification_tokens", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  verificationId: integer("verification_id").notNull().references(() => companyVerificationsTable.id, { onDelete: "cascade" }),
  action: text("action").notNull(), // 'approve' | 'reject'
  usedAt: timestamp("used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CompanyVerificationToken = typeof companyVerificationTokensTable.$inferSelect;
