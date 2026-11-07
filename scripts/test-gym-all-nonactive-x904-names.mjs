import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const root = new URL("../", import.meta.url);
const source = (p) => readFileSync(new URL(p, root), "utf8");
const routing = source("artifacts/api-server/src/services/x904GymGuestNameRouting.ts");
const api = source("artifacts/api-server/src/routes/whatsapp.ts");
const form = source("artifacts/sport-center/src/pages/wa/BookingForm.tsx");

test("ALL machine roles and reserved PINs are recognizable but never auto-authorized", () => {
  assert.match(routing, /route: "recognized_review", userPin: null, deviceUid: null/);
  assert.match(routing, /VIS_PINS\.has\(pin\) \|\| RESERVED_PINS\.has\(pin\)\) return recognized\(\)/);
  assert.match(routing, /Number\(entry\.device_role\) !== 0/);
  assert.match(routing, /if \(approved\.rows\.length !== 1\) return recognized\(\)/);
  assert.match(routing, /if \(matched\.rows\.length !== 1\) return recognized\(\)/);
});
test("Active membership only is excluded from green recognition", () => {
  assert.match(routing, /m\.status::text='active'/);
  assert.match(routing, /m\.start_date <= \$\{todayWib\}::date/);
  assert.match(routing, /m\.end_date >= \$\{todayWib\}::date/);
  assert.match(routing, /if \(active\.rows\.length\) return review\(\)/);
  assert.doesNotMatch(routing, /isPastGrace/);
});
test("Expired and future membership matches never return old member PIN", () => {
  assert.match(routing, /if \(ownership\.rows\.length\) \{/);
  assert.match(routing, /route: "expired_member", userPin: null, deviceUid: null/);
  assert.match(api, /PIN asli tidak boleh diaktifkan otomatis/);
  assert.match(api, /PIN membership lama tidak diberikan hak akses/);
  assert.match(api, /guestNameRoute\?\.route === "registered"/);
});
test("Anonymous UI highlights recognized name, hides PIN and rate limits probes", () => {
  assert.match(form, /guestIdentityRoute === "recognized_review"/);
  assert.match(form, /font-bold text-green-700 border-green-300/);
  assert.doesNotMatch(form, /id="guest-x904-pin"/);
  const preview = api.slice(api.indexOf('router.post("/wa/gym-name-route"'), api.indexOf("// POST /api/wa/booking"));
  assert.match(preview, /route: match\.route/);
  assert.doesNotMatch(preview, /res\.json\(\{[^}]*userPin/);
  assert.match(preview, /res\.status\(429\)/);
});
