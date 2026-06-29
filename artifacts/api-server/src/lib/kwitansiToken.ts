import { createHmac } from "crypto";

const SECRET = process.env.CASHIER_TOKEN_SECRET ?? process.env.SESSION_SECRET ?? "fallback-dev-secret";

export function signKwitansiToken(orderNumber: string): string {
  return createHmac("sha256", SECRET).update(orderNumber).digest("hex");
}

export function verifyKwitansiToken(orderNumber: string, token: string): boolean {
  if (!token || typeof token !== "string") return false;
  const expected = signKwitansiToken(orderNumber);
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}
