import { createHmac } from "crypto";

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
  return createHmac("sha256", getSecret()).update(orderNumber).digest("hex");
}

export function verifyKwitansiToken(orderNumber: string, token: string): boolean {
  if (!token || typeof token !== "string") return false;
  const expected = signKwitansiToken(orderNumber);
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}
