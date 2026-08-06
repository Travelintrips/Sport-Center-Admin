import { createHmac, timingSafeEqual } from "crypto";

function getSecret(): string {
  const s = process.env.CASHIER_TOKEN_SECRET ?? process.env.SESSION_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("[kwitansiToken] CASHIER_TOKEN_SECRET or SESSION_SECRET must be set in production");
    }
    return "fallback-dev-secret";
  }
  return s;
}

export function signKwitansiToken(orderNumber: string): string {
  // Take first 6 bytes of HMAC-SHA256 → 8-char base64url token
  const full = createHmac("sha256", getSecret()).update(orderNumber).digest();
  return full.subarray(0, 6).toString("base64url");
}

export function verifyKwitansiToken(orderNumber: string, token: string): boolean {
  if (!token || typeof token !== "string") return false;
  const expected = signKwitansiToken(orderNumber);
  if (expected.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}
