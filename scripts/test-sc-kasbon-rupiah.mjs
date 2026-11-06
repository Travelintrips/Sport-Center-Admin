import assert from "node:assert/strict";
import { normalizeKasbonAmount, formatKasbonAmount, fromDatabaseKasbonAmount } from "../artifacts/sport-center/src/pages/admin/kasbonAmount.ts";

for (const [raw, expected] of [
  ["", ""],
  ["10", "10"],
  ["10000", "10.000"],
  ["100000", "100.000"],
  ["500000", "500.000"],
  ["1000000", "1.000.000"],
  ["5000000", "5.000.000"],
  ["1000000000", "1.000.000.000"],
]) {
  assert.equal(formatKasbonAmount(raw), expected);
  assert.equal(normalizeKasbonAmount(expected), raw);
}
assert.equal(normalizeKasbonAmount("Rp 1.000.000"), "1000000");
assert.equal(fromDatabaseKasbonAmount("1000000.00"), "1000000");
assert.equal(formatKasbonAmount(fromDatabaseKasbonAmount("1000000.00")), "1.000.000");
assert.equal(fromDatabaseKasbonAmount("100000.00"), "100000");
assert.throws(() => fromDatabaseKasbonAmount("garbled"));
assert.throws(() => fromDatabaseKasbonAmount("-12"));
console.log("PASS: rupiah input formatting, IDR paste, DB edit roundtrip (14 assertions groups)");
