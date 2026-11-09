// Read-only CI gate: the real DEV pooler must expose the same checkout RLS
// repairs proven necessary in PROD. Never connect to PROD or mutate rows.
import pg from "pg";

const raw = process.env.SUPABASE_DATABASE_URL_DEV || "";
const expectedDevRef = "xssrfshdrtdfupgqwfdw";
let url;
try { url = new URL(raw); } catch {
  console.error("DEV_X904_RLS_BLOCKED: DEV database URL missing/invalid");
  process.exit(1);
}
const devOnly = url.hostname.endsWith(".pooler.supabase.com")
  && decodeURIComponent(url.username) === `postgres.${expectedDevRef}`
  && ["5432","6543"].includes(url.port) && Boolean(url.password);
if (!devOnly) {
  console.error("DEV_X904_RLS_BLOCKED: refusing non-DEV pooler target");
  process.exit(1);
}
const client = new pg.Client({
  connectionString: raw,
  connectionTimeoutMillis: 8000,
  statement_timeout: 5000,
  query_timeout: 8000,
});
try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  const result = await client.query(`
    SELECT tablename,policyname,cmd,roles,qual,with_check
    FROM pg_policies
    WHERE schemaname='sport_center'
      AND (
        (tablename='x904_verified_nonmember_identities'
          AND policyname='gym_nonmember_registry_backend_share_lock')
        OR
        (tablename='x904_nonmember_daily_access'
          AND policyname='x904_nonmember_app_public_pin_review_insert')
      )
  `);
  const byName = new Map(result.rows.map(row => [row.policyname, row]));
  const lock = byName.get("gym_nonmember_registry_backend_share_lock");
  const held = byName.get("x904_nonmember_app_public_pin_review_insert");
  const lockPass = lock?.cmd === "UPDATE"
    && lock?.roles?.includes("sport_center_app")
    && lock?.qual === "true" && lock?.with_check === "false";
  const heldRule = held?.with_check || "";
  const heldPass = held?.cmd === "INSERT"
    && held?.roles?.includes("sport_center_app")
    && ["review_required","pending_payment","gym_public_guest",
        "revoked_at IS NULL","payment_id IS NULL","activated_at IS NULL",
        "gym_x904_member_mapping","x904_verified_nonmember_identities"]
      .every(value => heldRule.includes(value));
  if (!lockPass || !heldPass) {
    throw new Error(`DEV_X904_RLS_DRIFT: share_lock=${Boolean(lockPass)} held_proof_insert=${Boolean(heldPass)}`);
  }
  console.log("DEV_X904_CHECKOUT_RLS_PARITY_PASS (actual DEV catalog, read-only)");
} catch (err) {
  console.error("DEV_X904_RLS_GATE_FAILED:", err.message);
  process.exitCode = 1;
} finally {
  try { await client.query("ROLLBACK"); } catch {}
  await client.end().catch(() => {});
}
