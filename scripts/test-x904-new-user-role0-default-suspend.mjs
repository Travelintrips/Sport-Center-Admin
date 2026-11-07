import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = p => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const worker = read("artifacts/api-server/src/services/x904NewOrdinaryUserDefaultSuspend.ts");
const policy = read("artifacts/api-server/src/services/x904NonmemberAccessPolicy.ts");
const startup = read("artifacts/api-server/src/index.ts");

test("new user automation requires explicit opt-in and a fresh baseline", () => {
  assert.match(worker, /GYM_X904_NEW_USER_DEFAULT_SUSPEND_ENABLED/);
  assert.match(worker, /GYM_X904_NEW_USER_BASELINE_AT/);
  assert.match(worker, /GYM_X904_NONMEMBER_ACCESS_ENABLED/);
  assert.match(worker, /GYM_X904_MANUAL_ACCESS_ENABLED/);
  assert.match(worker, /GYM_X904_USER_WRITE_ENABLED/);
  assert.match(worker, /previousTime >= latestTime/);
  assert.match(worker, /latestTime - previousTime > 10 \* 60_000/);
  assert.match(worker, /SNAPSHOT_MAX_AGE_MS/);
  assert.match(startup, /startX904NewOrdinaryUserDefaultSuspend\(\)/);
});
test("only newly appearing role 0 in Group 1 is considered", () => {
  assert.match(worker, /!previousPins\.has\(pin\)/);
  assert.match(worker, /Number\(user\.role\) === 0/);
  assert.match(worker, /Number\(user\.group\) === 1/);
  assert.match(worker, /user\.enabled === true/);
  assert.match(worker, /user_count/);
  assert.match(worker, /currentUsers\.length < priorUsers\.length/);
  assert.match(policy, /deviceRole === 14 \|\| deviceRole === 4/);
});
test("no broad or duplicate commands; identity ownership and grants are protected", () => {
  assert.match(worker, /GYM_X904_NEW_USER_ONLY_PIN/);
  assert.match(worker, /gym_x904_member_mapping/);
  assert.match(worker, /x904_nonmember_daily_access/);
  assert.match(worker, /x904_verified_nonmember_identities/);
  assert.match(worker, /x904_user_commands/);
  assert.match(worker, /expectedUid: uid, expectedName: name, expectedRole: 0/);
  assert.match(worker, /ON CONFLICT \(idempotency_key\) DO NOTHING/);
  assert.match(worker, /pg_advisory_xact_lock/);
  assert.doesNotMatch(worker, /ACTIVATE_USER/);
});
test("no role4 or role14 suspension and active access 12h policy unchanged", () => {
  assert.match(policy, /NONMEMBER_ACCESS_MS = 12 \* 60 \* 60 \* 1000/);
  assert.match(policy, /X904_GYM_CLOSE_HOUR_WIB = 23/);
  assert.match(policy, /isX904AutoSuspendExempt\(input\.userPin, input\.deviceRole\)/);
});
