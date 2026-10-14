import postgres from "npm:postgres@3.4.5";

const DEV_HOST = "xssrfshdrtdfupgqwfdw.supabase.co";
const configuredHost = (() => {
  try { return new URL(Deno.env.get("SUPABASE_URL") || "").host; } catch { return ""; }
})();
const dbUrl = Deno.env.get("SUPABASE_DB_URL") || "";
const db = configuredHost === DEV_HOST && dbUrl
  ? postgres(dbUrl, { max: 1, prepare: false, connect_timeout: 8, idle_timeout: 5 })
  : null;

const pinPattern = /^[A-Za-z0-9_-]{1,50}$/;
const serialPattern = /^[A-Za-z0-9_-]{4,100}$/;
const uuid4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const timestampPattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const integer = (x: unknown, low: number, high: number): x is number =>
  Number.isSafeInteger(x) && (x as number) >= low && (x as number) <= high;
const timestamp = (x: unknown): x is string => {
  if (typeof x !== "string" || !timestampPattern.test(x)) return false;
  const date = new Date(x.replace(" ", "T") + "Z");
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 19).replace("T", " ") === x;
};
const keys = (x: Record<string, unknown>, expected: string[]) =>
  Object.keys(x).length === expected.length &&
  Object.keys(x).every((key) => expected.includes(key));

const reply = (status: number, data: Record<string, unknown>) => new Response(
  JSON.stringify(data),
  { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } }
);
const error = (status: number, code: string) => reply(status, { ok: false, error: code });
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("");
}
function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; ++i) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (request) => {
  const path = new URL(request.url).pathname;
  if (!db) return error(503, "DEV_DATABASE_NOT_CONFIGURED");
  if (request.method === "GET" && path.endsWith("/health")) {
    try {
      await db.unsafe("SELECT 1");
      return reply(200, { ok: true, service: "x904-lan-dev", databaseReady: true });
    } catch { return error(503, "DEV_DATABASE_UNAVAILABLE"); }
  }
  const match = path.match(/\/api\/internal\/gym-x904\/lan\/(users|logs|complete)$/);
  if (request.method !== "POST" || !match) return error(404, "NOT_FOUND");
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return error(415, "JSON_REQUIRED");
  }
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (!Number.isFinite(contentLength) || contentLength > 131072) return error(413, "BODY_TOO_LARGE");
  const token = request.headers.get("x-gym-lan-key") || "";
  if (token.length < 32 || token.length > 128) return error(403, "UNAUTHORIZED");
  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > 131072) return error(413, "BODY_TOO_LARGE");
    const parsed = JSON.parse(text);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw Error("INVALID_JSON");
    body = parsed as Record<string, unknown>;
  } catch { return error(400, "INVALID_JSON"); }
  if (!serialPattern.test(String(body.serial ?? "")) ||
      !uuid4Pattern.test(String(body.snapshotId ?? "")) ||
      body.readAuthenticated !== true) return error(403, "UNAUTHORIZED");
  const serial = body.serial as string;
  const snapshotId = body.snapshotId as string;
  try {
    const auth = await db.unsafe(
      "SELECT token_sha256 FROM sport_center.gym_x904_lan_auth WHERE device_serial=$1 AND enabled=true",
      [serial],
    );
    if (auth.length !== 1 || !constantTimeEq(auth[0].token_sha256, await sha256(token))) {
      return error(403, "UNAUTHORIZED");
    }

    if (match[1] === "users") {
      const input = body.users;
      if (!Array.isArray(input) || !integer(body.userCount, 1, 500) ||
          input.length !== body.userCount) return error(400, "INVALID_USERS");
      const pins = new Set<string>();
      const users: Array<{ pin: string; uid: number; name: string; role: number }> = [];
      for (const item of input) {
        if (!item || Array.isArray(item) || typeof item !== "object" ||
            !keys(item, ["pin", "uid", "name", "role"]) ||
            typeof item.pin !== "string" || !pinPattern.test(item.pin) ||
            pins.has(item.pin) || !integer(item.uid, 0, 65535) ||
            !integer(item.role, 0, 255) || typeof item.name !== "string" ||
            item.name.length > 100 || /[\u0000-\u001f\u007f]/.test(item.name)) {
          return error(400, "INVALID_USERS");
        }
        pins.add(item.pin);
        users.push(item as {pin:string;uid:number;name:string;role:number});
      }
      const jsonShape = await db.unsafe("SELECT jsonb_typeof(($1::text)::jsonb) AS kind", [JSON.stringify(users)]);
      if (jsonShape[0]?.kind !== "array") {
        return reply(422, { ok:false, error:"JSON_ARRAY_ENCODING_FAILED", kind:String(jsonShape[0]?.kind || "unknown") });
      }
      const accepted = await db.unsafe(
        "INSERT INTO sport_center.gym_x904_lan_users " +
        "(device_serial,user_pin,device_uid,display_name,device_role,last_seen_snapshot) " +
        "SELECT $1,u.pin,u.uid,u.name,u.role,$2::uuid " +
        "FROM jsonb_to_recordset(($3::text)::jsonb) AS u(pin text,uid integer,name text,role integer) " +
        "ON CONFLICT (device_serial,user_pin) DO UPDATE SET " +
        "device_uid=EXCLUDED.device_uid,display_name=EXCLUDED.display_name," +
        "device_role=EXCLUDED.device_role,last_seen_snapshot=EXCLUDED.last_seen_snapshot,last_seen_at=now() " +
        "RETURNING user_pin",
        [serial, snapshotId, JSON.stringify(users)],
      );
      if (accepted.length !== users.length) return error(503, "INCOMPLETE_USERS");
      return reply(200, {ok:true, acknowledged: accepted.length, snapshotId});
    }

    if (match[1] === "logs") {
      const input = body.events;
      if (!Array.isArray(input) || input.length < 1 || input.length > 500 ||
          !integer(body.offset, 0, 999999) ||
          !integer(body.deviceLogCount, 1, 1000000) ||
          body.offset + input.length > body.deviceLogCount) return error(400, "INVALID_LOG_BATCH");
      const logs: Array<{id:string;ix:number;pin:string;uid:number;occurred:string}> = [];
      for (let i = 0; i < input.length; i++) {
        const item = input[i];
        if (!item || Array.isArray(item) || typeof item !== "object" ||
            !keys(item, ["index", "pin", "uid", "occurred"]) ||
            item.index !== (body.offset as number) + i ||
            typeof item.pin !== "string" || !pinPattern.test(item.pin) ||
            !integer(item.uid, 0, 65535) || !timestamp(item.occurred)) {
          return error(400, "INVALID_LOG_RECORD");
        }
        const id = await sha256(JSON.stringify([serial, item.index, item.pin, item.uid, item.occurred]));
        logs.push({id, ix:item.index, pin:item.pin, uid:item.uid, occurred:item.occurred});
      }
      const result = await db.unsafe(
        "INSERT INTO sport_center.gym_x904_lan_logs " +
        "(event_id,device_serial,event_index,user_pin,device_uid,device_time,last_seen_snapshot) " +
        "SELECT e.id,$1,e.ix,e.pin,e.uid,e.occurred,$2::uuid " +
        "FROM jsonb_to_recordset(($3::text)::jsonb) AS e(id text,ix integer,pin text,uid integer,occurred text) " +
        "ON CONFLICT (event_id) DO UPDATE SET last_seen_snapshot=EXCLUDED.last_seen_snapshot " +
        "RETURNING event_id",
        [serial, snapshotId, JSON.stringify(logs)],
      );
      if (result.length !== logs.length) return error(503, "INCOMPLETE_LOGS");
      return reply(200, {ok:true, acknowledged:logs.length, storedOrRefreshed:result.length, snapshotId});
    }

    if (!integer(body.userCount, 1, 500) || !integer(body.deviceLogCount, 0, 1000000)) {
      return error(400, "INVALID_EXPECTED_COUNTS");
    }
    const receipt = await db.begin(async (tx) => {
      const counts = await tx.unsafe(
        "SELECT (SELECT count(*)::int FROM sport_center.gym_x904_lan_users " +
        "WHERE device_serial=$1 AND last_seen_snapshot=$2::uuid) AS users," +
        "(SELECT count(*)::int FROM sport_center.gym_x904_lan_logs " +
        "WHERE device_serial=$1 AND last_seen_snapshot=$2::uuid) AS logs",
        [serial, snapshotId],
      );
      const users = Number(counts[0]?.users ?? -1);
      const logs = Number(counts[0]?.logs ?? -1);
      if (users !== body.userCount || logs !== body.deviceLogCount) {
        return {completed:false,users,logs};
      }
      await tx.unsafe(
        "INSERT INTO sport_center.gym_x904_lan_state " +
        "(device_serial,last_snapshot_id,user_count,device_log_count,stored_log_count) " +
        "VALUES ($1,$2::uuid,$3,$4,$5) " +
        "ON CONFLICT (device_serial) DO UPDATE SET " +
        "last_snapshot_id=EXCLUDED.last_snapshot_id,user_count=EXCLUDED.user_count," +
        "device_log_count=EXCLUDED.device_log_count,stored_log_count=EXCLUDED.stored_log_count," +
        "last_authenticated_at=now(),last_complete_at=now()",
        [serial, snapshotId, users, logs, logs],
      );
      return {completed:true,users,logs};
    });
    if (!receipt.completed) return reply(409, {ok:false,error:"INCOMPLETE_SNAPSHOT",users:receipt.users,logs:receipt.logs});
    return reply(200, {ok:true,verifiedStored:true,users:receipt.users,logs:receipt.logs,snapshotId});
  } catch (cause) {
    const value = cause && typeof cause === "object" && "code" in cause
      ? (cause as { code?: unknown }).code : undefined;
    const code = typeof value === "string" ? value.replace(/[^A-Za-z0-9_]/g, "").slice(0, 16) : "UNKNOWN";
    console.error("X904_DEV_STORAGE_FAILURE", match[1], code);
    return reply(503, { ok: false, error: "DEV_STORAGE_UNAVAILABLE", errorClass: code });
  }
});
