import crypto from "node:crypto";
import type { RequestHandler } from "express";

export const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000;

type ResetUser = { id: number; email: string | null; passwordHash: string | null };
export type PasswordResetPayload = {
  purpose: "password-reset";
  subject: number;
  email: string;
  credential: string;
  expires: number;
};

function signingKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Password reset signing is unavailable");
  // Recovery links must never be accepted as the application's bearer tokens.
  return crypto.createHmac("sha256", secret).update("sport-center:password-reset:v1").digest();
}

function credentialFingerprint(user: ResetUser): string {
  return crypto.createHmac("sha256", signingKey())
    .update(JSON.stringify([user.id, user.email, user.passwordHash]))
    .digest("hex");
}

export function createPasswordResetToken(user: ResetUser): string {
  if (!user.email) throw new Error("Password reset requires an email");
  const payload: PasswordResetPayload = {
    purpose: "password-reset",
    subject: user.id,
    email: user.email,
    credential: credentialFingerprint(user),
    expires: Date.now() + PASSWORD_RESET_TTL_MS,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", signingKey()).update(data).digest("hex");
  return `${data}.${signature}`;
}

export function verifyPasswordResetToken(token: unknown): PasswordResetPayload | null {
  if (typeof token !== "string" || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[a-f0-9]{64}$/.test(parts[1])) return null;
  const expected = crypto.createHmac("sha256", signingKey()).update(parts[0]).digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(parts[1], "hex"))) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as PasswordResetPayload;
    if (
      payload.purpose !== "password-reset"
      || !Number.isSafeInteger(payload.subject) || payload.subject < 1
      || typeof payload.email !== "string"
      || typeof payload.credential !== "string" || !/^[a-f0-9]{64}$/.test(payload.credential)
      || !Number.isFinite(payload.expires) || payload.expires <= Date.now()
    ) return null;
    return payload;
  } catch {
    return null;
  }
}

export function matchesPasswordResetUser(payload: PasswordResetPayload, user: ResetUser): boolean {
  return payload.subject === user.id && payload.email === user.email
    && crypto.timingSafeEqual(Buffer.from(payload.credential, "hex"), Buffer.from(credentialFingerprint(user), "hex"));
}

export function isValidResetPassword(value: unknown): value is string {
  // bcrypt truncates at 72 bytes, including multibyte characters.
  return typeof value === "string" && value.length >= 8 && Buffer.byteLength(value, "utf8") <= 72;
}

/** Bounded per-process protection for both recovery channels; never trust raw forwarded headers. */
export function createPasswordResetLimiter(emailLimit: number, ipLimit: number): RequestHandler {
  const buckets = new Map<string, { count: number; expires: number }>();
  return (req, res, next) => {
    const now = Date.now();
    if (buckets.size > 1000) {
      for (const [key, bucket] of buckets) if (bucket.expires <= now) buckets.delete(key);
    }
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase().slice(0, 320) : "";
    const keys: Array<[string, number]> = [[`ip:${req.ip ?? "unknown"}`, ipLimit]];
    if (email) keys.push([`email:${email}`, emailLimit]);
    if (buckets.size >= 10_000 || keys.some(([key, limit]) => {
      const bucket = buckets.get(key);
      return bucket && bucket.expires > now && bucket.count >= limit;
    })) {
      res.setHeader("Retry-After", "900");
      res.status(429).json({ error: "Terlalu banyak permintaan. Coba lagi dalam 15 menit." });
      return;
    }
    for (const [key] of keys) {
      const bucket = buckets.get(key);
      if (bucket && bucket.expires > now) bucket.count += 1;
      else buckets.set(key, { count: 1, expires: now + PASSWORD_RESET_TTL_MS });
    }
    res.setHeader("Cache-Control", "no-store");
    next();
  };
}
