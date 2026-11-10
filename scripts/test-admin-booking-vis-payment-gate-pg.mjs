import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const requireApi = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { Client } = requireApi("pg");
const url = new URL(process.env.ADMIN_VIS_ISOLATED_DATABASE_URL ||
  "postgresql://postgres:isolated_dev_fixture_only@127.0.0.1:55443/postgres");
if (url.hostname !== "127.0.0.1" || url.port !== "55443" ||
    url.username !== "postgres" || url.pathname !== "/postgres") {
  throw new Error("ISOLATED_POSTGRES_REQUIRED");
}
const functionText = readFileSync(new URL("./fixtures/20261110_admin_vis_dev_payment_trigger.sql", import.meta.url), "utf8").trim();
if (!functionText.includes("identity_type='card'") || !functionText.includes("b.source='admin'")) {
  throw new Error("DEV_FUNCTION_NOT_MIGRATED");
}
const db = new Client({ connectionString: url.href });
await db.connect();
let passed = 0;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  console.log("PASS", label);
  passed++;
};
try {
  await db.query("BEGIN");
  await db.query(`CREATE SCHEMA sport_center;
    CREATE TABLE sport_center.sport_bookings (id int primary key, source text not null);
    CREATE TABLE sport_center.x904_nonmember_daily_access (
      access_id int primary key, booking_id int not null, identity_type text not null,
      payment_id int, confirmed_at timestamptz, expires_at timestamptz,
      access_state text not null, verification_state text not null
    );
    CREATE TABLE sport_center.sport_payments (
      id int primary key, booking_id int not null, status text not null,
      confirmed_at timestamptz, paid_at timestamptz
    );`);
  await db.query(functionText.endsWith(";") ? functionText : functionText + ";");
  await db.query(`CREATE TRIGGER trg_link_admin_vis_payment
    AFTER INSERT OR UPDATE OF status ON sport_center.sport_payments
    FOR EACH ROW EXECUTE FUNCTION sport_center.link_x904_nonmember_daily_payment();`);
  await db.query(`INSERT INTO sport_center.sport_bookings(id,source) VALUES
    (101,'admin'),(102,'admin'),(103,'web'),(104,'gym_public_guest');
    INSERT INTO sport_center.x904_nonmember_daily_access
      (access_id,booking_id,identity_type,access_state,verification_state)
    VALUES (1,101,'card','pending','pending'),
           (2,102,'pin','pending','verified'),
           (3,103,'card','pending','pending'),
           (4,104,'pin','review_required','review_required');
    INSERT INTO sport_center.sport_payments(id,booking_id,status,confirmed_at)
    VALUES(201,101,'pending',now()),(202,102,'pending',now()),
          (203,103,'pending',now()),(204,104,'pending',now());
    UPDATE sport_center.sport_payments SET status='confirmed';`);
  const rows = (await db.query(`SELECT access_id,verification_state,access_state,
    payment_id,confirmed_at IS NOT NULL linked, expires_at IS NOT NULL expiry
    FROM sport_center.x904_nonmember_daily_access ORDER BY access_id`)).rows;
  check(rows[0], { access_id:1,verification_state:"pending",access_state:"pending",
    payment_id:201,linked:true,expiry:true }, "Admin VIS: paid but handover remains pending");
  check(rows[1].verification_state,"verified","Admin ordinary PIN: verified path unchanged");
  check(rows[2].verification_state,"verified","Web card: previous payment path unchanged");
  check(rows[3].verification_state,"verified","DEV guest PIN: previous payment semantics unchanged");
  await db.query("UPDATE sport_center.x904_nonmember_daily_access SET access_state='active' WHERE access_id=1");
  await db.query("UPDATE sport_center.sport_payments SET status='rejected' WHERE id=201");
  check((await db.query("SELECT access_state FROM sport_center.x904_nonmember_daily_access WHERE access_id=1")).rows[0].access_state,
    "pending","Revoked admin payment removes active entitlement");
  await db.query("UPDATE sport_center.sport_payments SET status='confirmed' WHERE id=201");
  check((await db.query("SELECT verification_state FROM sport_center.x904_nonmember_daily_access WHERE access_id=1")).rows[0].verification_state,
    "pending","Re-confirmed payment still cannot bypass VIS handover");
  await db.query("ROLLBACK");
  console.log(`ISOLATED_PAYMENT_VIS_GATE_PASS ${passed}/${passed}`);
} catch (e) {
  await db.query("ROLLBACK").catch(()=>{});
  throw e;
} finally {
  await db.end();
}
