import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read=(path)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const gate=read("artifacts/api-server/src/routes/x904AdmsGate.ts");
const audit=read("artifacts/api-server/src/lib/x904AdmsDurableAudit.ts");
const view=read("artifacts/sport-center/src/pages/admin/GymX904.tsx");
const migration=read("docs/sql/gym-x904-adms-durable-audit-prod.sql");

test("server persists coarse only, with no attendance data or identity claims",()=>{
  assert.match(audit,/INSERT INTO sport_center\.gym_x904_adms_audit/);
  assert.match(audit,/device_identity_verified\)/);
  assert.match(audit,/__NEVER_PLACEHOLDER__|false\s*\n\s*\)/);
  assert.doesNotMatch(audit,/INSERT INTO sport_center\.gym_x904_raw_events/);
  assert.doesNotMatch(migration,/\b(user_pin|source_ip|serial_number|ip_address|fingerprint|face_template|user_agent|payload)\b/i);
  assert.match(migration,/CHECK \(device_identity_verified = false\)/);
});
test("persistent audit table is protected from browser and public access",()=>{
  assert.match(migration,/ENABLE ROW LEVEL SECURITY/);
  assert.match(migration,/REVOKE ALL ON sport_center\.gym_x904_adms_audit FROM PUBLIC, anon, authenticated/);
  assert.match(migration,/FOR INSERT\s+TO sport_center_app WITH CHECK \(true\)/);
  assert.match(migration,/FOR SELECT\s+TO sport_center_app USING \(true\)/);
});
test("admin route uses auth and response always claims source unverified",()=>{
  assert.match(gate,/router\.get\("\/api\/admin\/gym-x904\/adms-audit",adminMiddleware/);
  assert.match(gate,/sourceIdentity:"unverified"/);
  assert.match(gate,/X-X904-ADMS-Audit/);
  assert.match(gate,/await persist\("configuration_sent"\)/);
  assert.match(gate,/await persist\("poll_ack"\)/);
  assert.match(gate,/await persist\("attendance_not_imported"\)/);
  assert.match(gate,/return res\.status\(503\)\.send\("ATTLOG NOT IMPORTED/);
});
test("rate-limited, bounded audit and no new unsupported device command",()=>{
  assert.match(audit,/60_000/);
  assert.match(audit,/10_000/);
  assert.match(gate,/classification\.serial!==allowed/);
  assert.doesNotMatch(gate,/clearAttendance|setUser|setFinger|restartDevice|unlockDoor|deleteUser/);
});
test("admin UI displays database audit separately from transient diagnostics",()=>{
  assert.match(view,/gym-x904-adms-durable-audit/);
  assert.match(view,/\/api\/admin\/gym-x904\/adms-audit/);
  assert.match(view,/Audit ADMS permanen/);
  assert.match(view,/Belum diverifikasi/);
});
