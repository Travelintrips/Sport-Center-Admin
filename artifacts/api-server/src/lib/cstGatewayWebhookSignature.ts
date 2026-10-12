import { createPublicKey, verify } from "node:crypto";

const BUILT_IN_KEYS: Record<string, string> = {
  "mina-2026-10-12": "LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUNvd0JRWURLMlZ3QXlFQUFlL0o3S1htOWw3MVZuUHpIVWMrQ3lTZFZYQ2N4czZoK0YwTDJUbXFsTW89Ci0tLS0tRU5EIFBVQkxJQyBLRVktLS0tLQo=",
};

function publicKeyFor(keyId: string): string {
  const configuredKey = String(process.env.CST_WA_GATEWAY_WEBHOOK_PUBLIC_KEY_B64 ?? "").trim();
  const configuredKeyId = String(process.env.CST_WA_GATEWAY_WEBHOOK_KEY_ID ?? "").trim();
  if (configuredKey && configuredKeyId === keyId) return configuredKey;
  return BUILT_IN_KEYS[keyId] ?? "";
}

export function verifyCstGatewayWebhookSignature(input: {
  body: unknown;
  keyId: string;
  signatureB64: string;
}): boolean {
  const keyB64 = publicKeyFor(input.keyId.trim());
  if (!keyB64 || !input.signatureB64.trim()) return false;
  try {
    const publicKeyPem = Buffer.from(keyB64, "base64").toString("utf8");
    const signature = Buffer.from(input.signatureB64.trim(), "base64");
    return verify(
      null,
      Buffer.from(JSON.stringify(input.body ?? {})),
      createPublicKey(publicKeyPem),
      signature,
    );
  } catch {
    return false;
  }
}