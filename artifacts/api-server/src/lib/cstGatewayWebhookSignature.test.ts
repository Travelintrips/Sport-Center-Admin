import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it } from "@jest/globals";
import { verifyCstGatewayWebhookSignature } from "./cstGatewayWebhookSignature";

afterEach(() => {
  delete process.env.CST_WA_GATEWAY_WEBHOOK_PUBLIC_KEY_B64;
  delete process.env.CST_WA_GATEWAY_WEBHOOK_KEY_ID;
});

describe("CST WA Gateway webhook signature", () => {
  it("verifies a dedicated Ed25519 signing key without an API token", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    process.env.CST_WA_GATEWAY_WEBHOOK_PUBLIC_KEY_B64 = Buffer.from(publicKey).toString("base64");
    process.env.CST_WA_GATEWAY_WEBHOOK_KEY_ID = "test-key";
    const body = { event: "message.received", deviceId: "mina-ai-sport-center" };
    const signature = sign(null, Buffer.from(JSON.stringify(body)), privateKey).toString("base64");
    expect(verifyCstGatewayWebhookSignature({ body, keyId: "test-key", signatureB64: signature })).toBe(true);
  });

  it("rejects a changed payload", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    process.env.CST_WA_GATEWAY_WEBHOOK_PUBLIC_KEY_B64 = Buffer.from(publicKey).toString("base64");
    process.env.CST_WA_GATEWAY_WEBHOOK_KEY_ID = "test-key";
    const signature = sign(null, Buffer.from(JSON.stringify({ event: "message.received" })), privateKey).toString("base64");
    expect(verifyCstGatewayWebhookSignature({ body: { event: "changed" }, keyId: "test-key", signatureB64: signature })).toBe(false);
  });
});