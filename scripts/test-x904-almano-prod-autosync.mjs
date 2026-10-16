import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./x904-almano-prod-autosync.ps1", import.meta.url),"utf8");

test("autosync is PROD-only and requires authenticated physical snapshot",()=>{
  assert.match(script,/x904-almano-prod-runner\.ps1/);
  assert.match(script,/read_authenticated=true/);
  assert.match(script,/mode=dry-run; no network upload; machine unchanged/);
  assert.doesNotMatch(script,/x904-lan-dev|supabase\.co\/functions\/v1\/x904-lan-dev/);
});
test("autosync is bounded and never loops without backoff",()=>{
  assert.match(script,/\$attempt\s+-le\s+3/i);
  assert.match(script,/Start-Sleep -Seconds 15/);
  assert.match(script,/Start-Sleep -Seconds 1800/);
  assert.match(script,/Local\\GymCST_X904_ProdAutoSync/);
});
test("autosync accepts only durable write acknowledgements",()=>{
  assert.match(script,/durable_database_ack=true/);
  assert.match(script,/stored_users=/);
  assert.match(script,/stored_logs=/);
  assert.match(script,/DURABLE_ACK_PASS/);
  assert.match(script,/DEVICE_LOG_COUNT_DECREASED/);
  assert.match(script,/last_ack_utc/);
});
test("autosync only invokes existing physical read-only machine integration",()=>{
  assert.match(script,/\& \$reader -Sync/);
  assert.match(script,/\& \$reader 2>&1/);
  assert.doesNotMatch(script,/Clear-Content|Remove-Item|CMD_DISABLEDEVICE|clearAttendance|setUser|setFinger|restartDevice/i);
  assert.doesNotMatch(script,/commkey\.dpapi|lan-ingest-prod\.dpapi/);
});
