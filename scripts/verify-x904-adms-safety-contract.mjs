import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const app = read("artifacts/api-server/src/app.ts");
const gate = read("artifacts/api-server/src/routes/x904AdmsGate.ts");
const events = read("artifacts/api-server/src/routes/gymX904Events.ts");
const integration = read("artifacts/api-server/src/routes/gymX904Integration.ts");
const deploy = read(".github/workflows/sport-center-deploy.yml");

// These guards prevent accidental 'online' claims or accidental production ACK
// while physical device identity/protocol compatibility is unverified.
assert.match(app, /app\.use\(x904AdmsGate\)/);
assert.match(app, /express\.text\(\{ type: "text\/plain", limit: "32kb" \}\)/);
assert.match(app, /app\.use\("\/iclock", \(_req, res\) =>/);
assert.match(gate, /GYM_X904_ADMS_PROBE_ENABLED/);
assert.match(gate, /GYM_X904_ADMS_HANDSHAKE_DIAGNOSTIC_ENABLED/);
assert.match(gate, /classification\.serial\s*!==\s*allowed/);
assert.match(gate, /return res\.status\(503\)\.send\("ATTLOG NOT IMPORTED/);
assert.match(gate, /hardwareVerified:\s*false/);
assert.match(gate, /ingesting:\s*false/);
assert.match(events, /GYM_X904_EVENT_INGEST_ENABLED/);
assert.match(events, /timingSafeEqual/);
assert.match(events, /ON CONFLICT \(event_id\) DO NOTHING/);
assert.match(integration, /hardware:\s*recent\s*\?\s*"connector-attested"\s*:\s*receiverState\.lastTrustedIngestAt[\s\S]*?"trusted-adms-data-received"[\s\S]*?"stored-adms-unverified"\s*:\s*"unverified"/);
assert.match(integration, /GYM_X904_CONNECTOR_HEARTBEAT_ENABLED/);
assert.match(integration, /timingSafeEqual/);
assert.match(integration, /HEARTBEAT_TTL_MS\s*=\s*90_000/);
assert.match(integration, /req\.body\?\.readAuthenticated\s*!==\s*true/);
assert.match(integration, /synchronizing:\s*false/);
assert.doesNotMatch(deploy, /\b(?:ssh|scp|rsync|ftp|sftp)\b/);
console.log("PASS X904 safe ADMS diagnostics, no premature ATTLOG ACK, truthful status, no implicit deploy");
