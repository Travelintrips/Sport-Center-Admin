import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const baselinePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "prod-baseline-20261114.json");
const functionQuery = `SELECT p.proname,pg_get_function_identity_arguments(p.oid) args, md5(pg_get_functiondef(p.oid)) hash
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='sport_center'
 AND (p.proname ILIKE '%x904%' OR p.proname ILIKE '%booking%' OR p.proname ILIKE '%payment%' OR p.proname ILIKE '%checkin%')
 ORDER BY p.proname,args`;
const triggerQuery = `SELECT c.relname table_name,t.tgname,md5(pg_get_triggerdef(t.oid)) hash
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='sport_center' AND NOT t.tgisinternal
 AND c.relname IN ('sport_bookings','sport_payments','gym_x904_lan_logs',
  'gym_x904_auto_checkin_sources','x904_nonmember_daily_access',
  'gym_vis_card_reservations','sport_membership_payments')
 ORDER BY c.relname,t.tgname`;

// No PROD connection is used. The reference hashes are pinned and reviewed in Git.
export function compareParity(expected, actualFunctions, actualTriggers) {
  if (expected.source_database !== "PROD" || expected.functions.length !== 45 || expected.triggers.length !== 14)
    throw new Error("INVALID_PINNED_BASELINE");
  const f = new Map(actualFunctions.map(x => [x.proname + "(" + x.args + ")", x.hash]));
  const t = new Map(actualTriggers.map(x => [x.table_name + "." + x.tgname, x.hash]));
  const missing = [], changed = [];
  for (const x of expected.functions) {
    const key = x.proname + "(" + x.args + ")";
    if (!f.has(key)) missing.push("function:" + key);
    else if (f.get(key) !== x.hash) changed.push("function:" + key);
  }
  for (const x of expected.triggers) {
    const key = x.table_name + "." + x.tgname;
    if (!t.has(key)) missing.push("trigger:" + key);
    else if (t.get(key) !== x.hash) changed.push("trigger:" + key);
  }
  return { ok: missing.length === 0 && changed.length === 0, missing, changed,
    checkedFunctions: expected.functions.length, checkedTriggers: expected.triggers.length };
}

export async function verifyDevParity() {
  const rawUrl = process.env.SUPABASE_DATABASE_URL_DEV || "";
  if (process.env.PARITY_TARGET !== "DEV" ||
      !rawUrl.includes("xssrfshdrtdfupgqwfdw") ||
      rawUrl.includes("nzdweipzckfszczzqtuw") ||
      process.env.SUPABASE_DATABASE_URL)
    throw new Error("PARITY_VERIFICATION_DEV_DATABASE_ONLY");
  const baseline = JSON.parse(readFileSync(baselinePath,"utf8"));
  const url = rawUrl.replace("pooler.supabase.com:6543","pooler.supabase.com:5432");
  const client = new pg.Client({ connectionString:url,
    ...(/supabase\.(co|com|in)/.test(url) ? { ssl: { rejectUnauthorized:false } } : {}) });
  try {
    await client.connect();
    const dbRef = await client.query("SELECT current_database() AS db, current_user AS db_user");
    const [functions,triggers] = await Promise.all([
      client.query(functionQuery), client.query(triggerQuery)
    ]);
    const result = compareParity(baseline,functions.rows,triggers.rows);
    console.log("[dev-parity] baseline",baseline.source_commit.slice(0,12),
      "functions",result.checkedFunctions,"triggers",result.checkedTriggers,
      "result",result.ok ? "PASS" : "BLOCKED");
    if (!result.ok) {
      for(const key of result.missing) console.error("[dev-parity] missing",key);
      for(const key of result.changed) console.error("[dev-parity] drift",key);
      throw new Error("DEV_PROD_BASELINE_DRIFT");
    }
    return result;
  } finally { await client.end().catch(()=>{}); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  verifyDevParity().catch(e => { console.error("[dev-parity]",e.message);process.exitCode=1; });
