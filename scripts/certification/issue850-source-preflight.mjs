// Issue #850 minimum source preflight. This is NOT an E2E tenant-isolation certificate.
// Run from repository root. --enforce intentionally blocks release until integrated.
import { readFileSync } from "node:fs";
const source = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const has = (file, expression) => expression.test(source(file));
const checks = {
  operatorScopedBooking: has("lib/db/src/schema/bookings.ts", /operatorId:\s*integer\("operator_id"\)/),
  operatorScopedPayment: has("lib/db/src/schema/payments.ts", /operatorId:\s*integer\("operator_id"\)/),
  operatorScopedFacility: has("lib/db/src/schema/facilities.ts", /operatorId:\s*integer\("operator_id"\)/),
  operatorScopedMembership: has("lib/db/src/schema/memberships.ts", /operatorId:\s*integer\("operator_id"\)/),
  backendOperatorContext: has("artifacts/api-server/src/routes/bookings.ts", /requireOperatorScope\s*\(/),
  deviceRoutingAlreadyExists: has("artifacts/api-server/src/services/x904RealPg.integration.test.ts", /device_serial/),
};
const missing = Object.entries(checks).filter(([,ok])=>!ok).map(([name])=>name);
const decision = missing.length ? "NO_GO" : "SOURCE_PREFLIGHT_ONLY";
console.log(JSON.stringify({
  target:"Sport Center multi-operator release", issue:850, mode:"source-preflight",
  checks, missing, decision,
  warning:"Even SOURCE_PREFLIGHT_ONLY is not GO: require real two-operator authenticated API E2E, storage isolation, device ACK, production-safe backup restore proof and independent review."
},null,2));
if (process.argv.includes("--enforce") && missing.length) process.exitCode=2;
