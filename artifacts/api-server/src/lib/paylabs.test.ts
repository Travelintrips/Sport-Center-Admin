/**
 * Paylabs Public Key Tests — PHASE PAYLABS-SANDBOX-PUBKEY-04
 *
 * Tests:
 *  1.  PEM sandbox valid → normalized correctly
 *  2.  Literal \n → normalized to real newlines
 *  3.  Flat PEM (no headers) treated as raw base64 → wrapped
 *  4.  Empty string → returns "" (no throw)
 *  5.  normalizePaylabsPublicKey vs merchant private key: different functions, not interchangeable
 *  6.  verifyPaylabsSignature: valid → true
 *  7.  verifyPaylabsSignature: tampered body → false (INVALID)
 *  8.  verifyPaylabsSignature: empty public key → false (not crashing)
 *  9.  normalise does NOT strip production key if sandbox key supplied
 * 10.  Duplicate webhook guard (idempotency) — tested at integration level (see paylabsPayment.ts finalizePayment)
 *
 * Run: pnpm --filter @workspace/api-server exec tsx --test src/lib/paylabs.test.ts
 * Or:  cd artifacts/api-server && npx jest src/lib/paylabs.test.ts
 */

import crypto from "crypto";
import { describe, it, expect } from "vitest";
import { normalizePaylabsPublicKey, verifyPaylabsSignature } from "./paylabs";

// ─── Key Fixture ──────────────────────────────────────────────────────────────
// Generate a real RSA-2048 key pair for deterministic test signing
function generateTestKeyPair() {
  return crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

const { publicKey: TEST_PUBLIC_PEM, privateKey: TEST_PRIVATE_PEM } =
  generateTestKeyPair();

// ─── normalizePaylabsPublicKey ────────────────────────────────────────────────

describe("normalizePaylabsPublicKey", () => {
  it("1. Valid PEM with proper header → preserves header and normalizes chunking", () => {
    const result = normalizePaylabsPublicKey(TEST_PUBLIC_PEM);
    expect(result).toContain("-----BEGIN PUBLIC KEY-----");
    expect(result).toContain("-----END PUBLIC KEY-----");
    // Each line of body should be ≤ 64 chars
    const lines = result.split("\n").filter((l) => !l.startsWith("-----"));
    lines.forEach((line) => expect(line.length).toBeLessThanOrEqual(64));
  });

  it("2. Literal \\n escape sequences → converted to real newlines", () => {
    // Simulate a key pasted from a secret manager as a single-line string with \\n
    const flat = TEST_PUBLIC_PEM.replace(/\n/g, "\\n");
    const result = normalizePaylabsPublicKey(flat);
    expect(result).toContain("-----BEGIN PUBLIC KEY-----");
    expect(result).toContain("-----END PUBLIC KEY-----");
    expect(result).not.toContain("\\n");
  });

  it("3. Raw base64 without PEM header → wrapped in PUBLIC KEY block", () => {
    const base64 = TEST_PUBLIC_PEM.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
    const result = normalizePaylabsPublicKey(base64);
    expect(result).toContain("-----BEGIN PUBLIC KEY-----");
    expect(result).toContain("-----END PUBLIC KEY-----");
  });

  it("4. Empty string → returns empty string without throwing", () => {
    expect(normalizePaylabsPublicKey("")).toBe("");
    expect(normalizePaylabsPublicKey("   ")).toBe("");
  });

  it("5. A DIFFERENT public key (wrong pair) does NOT verify a signature from a different private key", () => {
    // Guards against accidentally using the wrong Paylabs public key
    // e.g. merchant's own public key instead of Paylabs public key for webhook verification.
    const { publicKey: wrongPubKey } = generateTestKeyPair(); // unrelated key pair
    const timestamp = "2026-08-05T10:00:00.000+07:00";
    const rawBody   = JSON.stringify({ merchantTradeNo: "TEST-KEY-SWAP", tradeStatus: "02" });
    // Sign with TEST_PRIVATE_PEM but try to verify with an unrelated wrongPubKey
    const sig = signForTest(TEST_PRIVATE_PEM, rawBody, timestamp, "/api/paylabs/webhook");
    const result = verifyPaylabsSignature(wrongPubKey, timestamp, rawBody, sig, "/api/paylabs/webhook");
    expect(result).toBe(false);
  });
});

// ─── verifyPaylabsSignature ───────────────────────────────────────────────────

/** Build a real Paylabs-style signature for test purposes */
function signForTest(privateKeyPem: string, rawBody: string, timestamp: string, endpoint: string): string {
  const minified = rawBody.replace(/[\n\r\t]/g, "");
  const bodyHash = crypto.createHash("sha256").update(minified, "utf8").digest("hex").toLowerCase();
  const stringToSign = `POST:${endpoint}:${bodyHash}:${timestamp}`;
  const s = crypto.createSign("RSA-SHA256");
  s.update(stringToSign, "utf8");
  return s.sign(privateKeyPem, "base64"); // use the PASSED key, not the global constant
}

describe("verifyPaylabsSignature", () => {
  const endpoint  = "/api/paylabs/webhook";
  const timestamp = "2026-08-05T10:00:00.000+07:00";
  const rawBody   = JSON.stringify({ merchantTradeNo: "TEST-001", tradeStatus: "02" });

  it("6. Valid signature → returns true (VALID)", () => {
    const sig = signForTest(TEST_PRIVATE_PEM, rawBody, timestamp, endpoint);
    const result = verifyPaylabsSignature(TEST_PUBLIC_PEM, timestamp, rawBody, sig, endpoint);
    expect(result).toBe(true);
  });

  it("7. Tampered body → returns false (INVALID)", () => {
    const sig = signForTest(TEST_PRIVATE_PEM, rawBody, timestamp, endpoint);
    const tampered = JSON.stringify({ merchantTradeNo: "TEST-001", tradeStatus: "02", injected: true });
    const result = verifyPaylabsSignature(TEST_PUBLIC_PEM, timestamp, tampered, sig, endpoint);
    expect(result).toBe(false);
  });

  it("7b. Tampered signature → returns false (INVALID)", () => {
    const tampered = "AAAA" + signForTest(TEST_PRIVATE_PEM, rawBody, timestamp, endpoint).slice(4);
    const result = verifyPaylabsSignature(TEST_PUBLIC_PEM, timestamp, rawBody, tampered, endpoint);
    expect(result).toBe(false);
  });

  it("8. Empty public key → returns false without throwing", () => {
    const sig = signForTest(TEST_PRIVATE_PEM, rawBody, timestamp, endpoint);
    expect(() => verifyPaylabsSignature("", timestamp, rawBody, sig, endpoint)).not.toThrow();
    const result = verifyPaylabsSignature("", timestamp, rawBody, sig, endpoint);
    expect(result).toBe(false);
  });

  it("9. Sandbox public key does NOT verify prod-signed message (different keys)", () => {
    const { publicKey: anotherPubKey, privateKey: anotherPrivKey } = generateTestKeyPair();
    // Sign with "prod" private key
    const sig = signForTest(anotherPrivKey, rawBody, timestamp, endpoint);
    // Verify with "sandbox" public key — should fail
    const result = verifyPaylabsSignature(TEST_PUBLIC_PEM, timestamp, rawBody, sig, endpoint);
    expect(result).toBe(false);
  });

  it("10. Literal \\n in stored public key → still verifies correctly", () => {
    // Simulate public key stored with literal \n (as happens in some secret managers)
    const flatPublicKey = TEST_PUBLIC_PEM.replace(/\n/g, "\\n");
    const sig = signForTest(TEST_PRIVATE_PEM, rawBody, timestamp, endpoint);
    // normalizePaylabsPublicKey should fix it before verification
    const normalized = normalizePaylabsPublicKey(flatPublicKey);
    const result = verifyPaylabsSignature(normalized, timestamp, rawBody, sig, endpoint);
    expect(result).toBe(true);
  });
});
