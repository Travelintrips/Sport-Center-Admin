import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runtime = readFileSync(new URL("./qris-prod-detection-runtime.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("./prod-qris-email-schema.sql", import.meta.url), "utf8");
const bookingDetailSource = readFileSync(
  new URL("../../artifacts/api-server/src/routes/bookings.ts", import.meta.url),
  "utf8",
);

test("prod runtime is localhost-only and detection-only", () => {
  assert.match(runtime, /const HOST = "127\.0\.0\.1"/);
  assert.match(runtime, /autoConfirm:\s*false/);
  assert.match(runtime, /autoConfirmed:\s*0/);
  assert.match(runtime, /QRIS_GMAIL_PROD_DETECTION_ENABLED/);
  assert.match(runtime, /nzdweipzckfszczzqtuw/);
  assert.doesNotMatch(runtime, /(?:insert|update|delete)\s+(?:into\s+)?sport_center\.sport_payments/i);
});

test("prod schema grants no payment mutation to QRIS runtime", () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS sport_center\.qris_email_transactions/);
  assert.match(schema, /qris_gmail_prod_runtime/);
  assert.match(schema, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\s+ON sport_center\.sport_payments\s+FROM qris_gmail_prod_runtime/i);
  assert.match(schema, /GRANT SELECT ON sport_center\.qris_email_transactions TO sport_center_app/i);
  assert.match(schema, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\s+ON sport_center\.qris_email_transactions\s+FROM sport_center_app/i);
  assert.doesNotMatch(schema, /match_status IN \([^)]*confirmed/i);
});

test("production Booking Detail banner is explicitly feature-gated", () => {
  assert.match(bookingDetailSource, /QRIS_GMAIL_PROD_BANNER_ENABLED/);
  assert.match(bookingDetailSource, /sport_center\.qris_email_transactions/);
  assert.match(bookingDetailSource, /process\.env\.NODE_ENV === "production"/);
});
