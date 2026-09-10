import assert from "node:assert/strict";
import {
  ACTIVE_ENVIRONMENT_RECORD_NOT_FOUND,
  activeEnvironmentLookupResult,
} from "./payment-enrichment-diagnostic-logic.js";

assert.deepEqual(
  activeEnvironmentLookupResult(0, 987654),
  {
    error: ACTIVE_ENVIRONMENT_RECORD_NOT_FOUND,
    requestedPaymentId: 987654,
    activeEnvironmentRecordFound: false,
  },
);
assert.deepEqual(
  activeEnvironmentLookupResult(1, 42),
  { requestedPaymentId: 42, activeEnvironmentRecordFound: true },
);

console.log("payment-enrichment-diagnostic-logic: 2/2 PASS (active environment only)");