import { randomBytes } from "crypto";
import { db, waActionTokensTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export type WaAction = "approve_payment" | "reject_payment" | "checkin" | "finish" | "upload_proof" | "approve_booking" | "review_payment";

export async function createWaToken(bookingId: number, action: WaAction, expiryDays = 30): Promise<string> {
  // 16 chars, URL-safe base64 (12 bytes = 96-bit entropy) — short enough to keep
  // WA links simple, still practically unguessable for a booking-scoped token.
  const token = randomBytes(12).toString("base64url");
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
  await db.insert(waActionTokensTable).values({ token, bookingId, action, expiresAt });
  return token;
}

export async function verifyWaToken(token: string, expectedAction?: WaAction): Promise<{ bookingId: number; action: string } | null> {
  const conditions = expectedAction
    ? and(eq(waActionTokensTable.token, token), eq(waActionTokensTable.action, expectedAction))
    : eq(waActionTokensTable.token, token);

  const [row] = await db.select().from(waActionTokensTable).where(conditions).limit(1);
  if (!row) return null;
  if (row.expiresAt && row.expiresAt < new Date()) return null;
  return { bookingId: row.bookingId, action: row.action };
}

export async function consumeWaToken(token: string): Promise<void> {
  await db.update(waActionTokensTable).set({ usedAt: new Date() }).where(eq(waActionTokensTable.token, token));
}

export async function getWaTokenRow(token: string) {
  const [row] = await db.select().from(waActionTokensTable).where(eq(waActionTokensTable.token, token)).limit(1);
  return row ?? null;
}
