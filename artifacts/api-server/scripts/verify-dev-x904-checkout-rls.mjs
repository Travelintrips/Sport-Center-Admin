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
const connectionOptions = {
  connectionString: raw,
  connectionTimeoutMillis: 8000,
  statement_timeout: 5000,
  query_timeout: 8000,
};
let client;
try {
  // Retry transient pooler connection refusal without relaxing the DEV-only
  // destination validation or the actual RLS assertions below.
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      client = new pg.Client(connectionOptions);
      await client.connect();
      break;
    } catch (err) {
      // Supabase pooler can report nested lowercase :econnrefused in
      // addition to native Node error codes.
      const diagnostic = [String(err?.code ?? ""), String(err?.message ?? ""), String(err)]
        .join(" ").toUpperCase();
      const transient = ["ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN"]
        .some(code => diagnostic.includes(code));
      await client?.end().catch(() => {});
      if (!transient || attempt === maxAttempts) throw err;
      console.warn(`DEV_X904_RLS_POOLER_RETRY attempt=${attempt} of ${maxAttempts}`);
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
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
  try { await client?.query("ROLLBACK"); } catch {}
  await client.end().catch(() => {});
}
