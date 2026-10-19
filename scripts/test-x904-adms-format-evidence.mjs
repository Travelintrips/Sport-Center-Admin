import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const read=(path)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const audit=read("artifacts/api-server/src/lib/x904AdmsDurableAudit.ts");
const gate=read("artifacts/api-server/src/routes/x904AdmsGate.ts");
const ui=read("artifacts/sport-center/src/pages/admin/GymX904.tsx");
const sql=read("docs/sql/gym-x904-adms-format-shape-prod.sql");

test("SQL stores only parseability and minimum column count, never attendance fields",()=>{
 assert.match(sql,/ADD COLUMN IF NOT EXISTS attlog_parseable boolean/);
 assert.match(sql,/ADD COLUMN IF NOT EXISTS attlog_min_columns integer/);
 assert.doesNotMatch(sql,/user_pin|source_ip|src_ip|device_serial|ip_address|person_name|user_agent|face_template|fingerprint_template/i);
});
test("the durable audit records only constrained metadata",()=>{
 assert.match(audit,/parseable\?: boolean/);
 assert.match(audit,/minColumns\?: number/);
 assert.match(audit,/event.kind === "attendance" && typeof event.parseable === "boolean"/);
 assert.match(audit,/Math.min\(event.minColumns!, 32\)/);
 assert.match(audit,/attlog_parseable, attlog_min_columns/);
 assert.match(audit,/device_identity_verified,/);
});
test("untrusted direct ATTLOG is transport-acked but never ingested",()=>{
 assert.match(gate,/await persist\("attendance_untrusted"/);
 assert.match(gate,/return res.status\(200\).send\("OK\\n"/);
 assert.match(gate,/classification\.serial!==allowed/);
 assert.match(gate,/timingSafeEqual\(expectedKey,\s*receivedKey\)/);
 assert.match(gate,/attendance_stored/);
 assert.match(gate,/hardwareVerified:false/);
});
test("backend uses existing parsed shape; admin audit labels formats",()=>{
 assert.match(gate,/lastAttlogShape\?\.parseable \?\? false/);
 assert.match(gate,/lastAttlogShape\?\.columnCounts\[0\] \?\? 0/);
 assert.match(ui,/Format ATTLOG/);
 assert.match(ui,/Belum dianalisis/);
});