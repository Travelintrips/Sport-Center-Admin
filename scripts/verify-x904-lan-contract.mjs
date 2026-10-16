import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
const read = (file) => readFileSync(new URL("../" + file, import.meta.url), "utf8");
const route = read("artifacts/api-server/src/routes/gymX904Lan.ts");
const edge = read("supabase/functions/x904-lan-dev/index.ts");
const client = read("scripts/x904-almano-snapshot.mjs");
const runner = read("scripts/x904-almano-runner.ps1");
const migration = read("docs/sql/gym-x904-lan-connector-auth-dev.sql");
const atomicMigration = read("docs/sql/gym-x904-lan-atomic-snapshots-dev.sql");

assert.match(route, /GYM_X904_LAN_INGEST_ENABLED/);
assert.match(route, /readAuthenticated/);
assert.match(route, /ON CONFLICT \(event_id\)/);
assert.match(route, /verifiedStored: true/);
assert.match(edge, /xssrfshdrtdfupgqwfdw\.supabase\.co/);
assert.match(edge, /constantTimeEq/);
assert.match(edge, /token_sha256/);
assert.match(edge, /jsonb_to_recordset\(\(\$3::text\)::jsonb\)/);
assert.match(edge, /INCOMPLETE_SNAPSHOT/);
assert.match(edge, /verifiedStored:true/);
assert.match(edge, /Array\.isArray/);
assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /REVOKE ALL/);
assert.match(atomicMigration, /ENABLE ROW LEVEL SECURITY/);
assert.match(edge, /gym_x904_lan_pending_users/);
assert.match(edge, /gym_x904_lan_pending_logs/);
assert.match(edge, /updatedUsers.length !== users \|\| updatedLogs.length !== logs/);
assert.match(edge, /ATOMIC_SNAPSHOT_ROW_MISMATCH/);
assert.match(client, /UNAPPROVED_DEV_ENDPOINT/);
assert.match(client, /INCOMPLETE_DURABLE_ACK/);
assert.match(runner, /ConvertTo-SecureString/);
for (const source of [route, edge, client, runner]) {
  assert.doesNotMatch(source, /CMD_DISABLEDEVICE|CMD_DELETE_USER|CMD_UNLOCK|CMD_CLEAR_ATTLOG/);
}
console.log("PASS: X904 DEV edge auth, RLS, read-only and durable ACK contracts");
