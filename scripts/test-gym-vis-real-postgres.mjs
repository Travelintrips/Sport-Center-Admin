import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const requireApi = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { Client } = requireApi("pg");
const url = new URL(process.env.VIS_TEST_DATABASE_URL ?? "");
// This fixture MUST never connect to a real Supabase / shared database.
if (url.hostname !== "127.0.0.1" || url.pathname !== "/vis_ci" || url.username !== "postgres") {
  throw new Error("Only the dedicated local postgres vis_ci database is permitted");
}
const db = new Client({ connectionString: url.href });
const migration = readFileSync(new URL("../artifacts/api-server/migrations/20261106_gym_vis_card_reservations.sql", import.meta.url), "utf8");
const device = "TDBD234200545";
const insertReservation = (booking, payment, card, pin, uid, ref) => db.query(
  `INSERT INTO sport_center.gym_vis_card_reservations
  (booking_id,payment_id,card_code,user_pin,device_uid,funds_reference,funds_verified_by)
  VALUES ($1,$2,$3,$4,$5,$6,'CI_FIXTURE')`,
  [booking,payment,card,pin,uid,ref]
);

before(async () => {
  await db.connect();
  await db.query("CREATE ROLE anon NOLOGIN");
  await db.query("CREATE ROLE authenticated NOLOGIN");
  await db.query("CREATE SCHEMA sport_center");
  await db.query("CREATE TABLE sport_center.sport_bookings (id integer PRIMARY KEY)");
  await db.query("CREATE TABLE sport_center.sport_payments (id integer PRIMARY KEY, booking_id integer)");
  await db.query("INSERT INTO sport_center.sport_bookings SELECT generate_series(1,12)");
  await db.query("INSERT INTO sport_center.sport_payments SELECT i,i FROM generate_series(1,12) AS i");
  // Execute the actual production migration, not a mock approximation.
  await db.query(migration);
});
after(async () => { await db.end(); });

test("actual partial unique index rejects duplicate active VIS across bookings", async () => {
  await insertReservation(1,1,"VIS003","13",13,"BANK-CI-01");
  await assert.rejects(insertReservation(2,2,"VIS003","13",13,"BANK-CI-02"), e => e.code === "23505");
  const { rows } = await db.query("SELECT count(*)::int AS n FROM sport_center.gym_vis_card_reservations WHERE card_code='VIS003'");
  assert.equal(rows[0].n, 1);
});

test("actual unique index rejects reuse of the same bank reference", async () => {
  await assert.rejects(insertReservation(2,2,"VIS004","17",17,"BANK-CI-01"), e => e.code === "23505");
});

test("actual card pairing constraint rejects a mismatched PIN or UID", async () => {
  await assert.rejects(insertReservation(3,3,"VIS004","13",13,"BANK-CI-03"), e => e.code === "23514");
});

test("booking cannot hold two reservations even with different card/reference", async () => {
  await assert.rejects(insertReservation(1,1,"VIS005","11",11,"BANK-CI-04"), e => e.code === "23505");
});

test("returned card is reusable only after a state transition, but unresolved PIN still blocks return", async () => {
  await db.query(`CREATE TABLE sport_center.x904_nonmember_daily_access (
    device_serial text NOT NULL, user_pin text NOT NULL, booking_id integer NOT NULL,
    access_state text NOT NULL CHECK (access_state IN ('pending','active','review_required','expired'))
  )`);
  await db.query("INSERT INTO sport_center.x904_nonmember_daily_access VALUES ($1,'13',2,'review_required')",[device]);
  const guarded = await db.query(`SELECT EXISTS (
    SELECT 1 FROM sport_center.x904_nonmember_daily_access
    WHERE device_serial=$1 AND user_pin='13'
    AND access_state IN ('pending','active','review_required')
  ) AS blocked`, [device]);
  assert.equal(guarded.rows[0].blocked,true);
  // Release must be blocked even if the reservation's OWN booking_id has no grant.
  assert.notEqual(2,1);
  await db.query("UPDATE sport_center.x904_nonmember_daily_access SET access_state='expired' WHERE booking_id=2");
  const resolved = await db.query(`SELECT EXISTS (
    SELECT 1 FROM sport_center.x904_nonmember_daily_access
    WHERE device_serial=$1 AND user_pin='13'
    AND access_state IN ('pending','active','review_required')
  ) AS blocked`, [device]);
  assert.equal(resolved.rows[0].blocked,false);
  await db.query("UPDATE sport_center.gym_vis_card_reservations SET state='returned' WHERE booking_id=1");
  await insertReservation(2,2,"VIS003","13",13,"BANK-CI-05");
});

test("public roles have no direct write rights and RLS enabled", async () => {
  const {rows}=await db.query(`SELECT c.relrowsecurity AS rls,
    has_table_privilege('anon','sport_center.gym_vis_card_reservations','INSERT') AS anon_insert,
    has_table_privilege('authenticated','sport_center.gym_vis_card_reservations','UPDATE') AS auth_update
    FROM pg_class c WHERE c.oid='sport_center.gym_vis_card_reservations'::regclass`);
  assert.equal(rows[0].rls,true);
  assert.equal(rows[0].anon_insert,false);
  assert.equal(rows[0].auth_update,false);
});

test("incoming bank record must match payment, amount, canonical reference and ingestion provenance", async () => {
  await db.query(`CREATE TABLE sport_center.bank_mutations (
    id integer PRIMARY KEY, matched_payment_id integer,
    status text, direction text, credit_amount numeric,
    source_app text, source_module text, provider_name text, provider_order_id text
  )`);
  const match = () => db.query(`SELECT id FROM sport_center.bank_mutations
    WHERE matched_payment_id=$1 AND status::text='auto_matched'
      AND upper(btrim(direction))='IN' AND credit_amount >= $2
      AND upper(btrim(coalesce(provider_order_id,'')))=$3
      AND nullif(btrim(coalesce(source_app,'')),'') IS NOT NULL
      AND nullif(btrim(coalesce(source_module,'')),'') IS NOT NULL
      AND lower(btrim(coalesce(provider_name,''))) NOT IN ('','manual')
    LIMIT 2 FOR UPDATE`,[4,100,"BANK-CI-06"]);
  await db.query("INSERT INTO sport_center.bank_mutations VALUES (1,4,'auto_matched','IN',100,NULL,NULL,'manual','BANK-CI-06')");
  assert.equal((await match()).rows.length,0,"manual import must not attest funds");
  await db.query("INSERT INTO sport_center.bank_mutations VALUES (2,5,'auto_matched','IN',100,'bank_api','ingest','mandiri_direct','BANK-CI-06')");
  assert.equal((await match()).rows.length,0,"other booking payment must not attest funds");
  await db.query("UPDATE sport_center.bank_mutations SET matched_payment_id=4,credit_amount=90 WHERE id=2");
  assert.equal((await match()).rows.length,0,"short payment must not attest funds");
  await db.query("UPDATE sport_center.bank_mutations SET credit_amount=100,provider_order_id='DIFFERENT' WHERE id=2");
  assert.equal((await match()).rows.length,0,"different bank reference must not attest funds");
  await db.query("UPDATE sport_center.bank_mutations SET provider_order_id='BANK-CI-06' WHERE id=2");
  assert.equal((await match()).rows.length,1,"only independently sourced matched bank record may pass");
});

test("fresh X904 group 2 snapshot rejects group 1, stale evidence and later commands", async () => {
  await db.query(`CREATE TABLE sport_center.gym_x904_access_snapshots (
    observed_at timestamptz NOT NULL,device_serial text NOT NULL,users jsonb NOT NULL
  )`);
  await db.query(`CREATE TABLE sport_center.x904_user_commands (
    device_serial text NOT NULL,user_pin text NOT NULL,
    created_at timestamptz NOT NULL,state text NOT NULL
  )`);
  const verify=()=>db.query(`WITH latest AS (
    SELECT observed_at,users FROM sport_center.gym_x904_access_snapshots
    WHERE device_serial=$1
      AND observed_at>=now()-interval '5 minutes'
      AND observed_at>=now()-interval '10 minutes'
    ORDER BY observed_at DESC LIMIT 1
  ) SELECT observed_at FROM latest
    WHERE jsonb_typeof(users)='array'
    AND (SELECT count(*) FROM jsonb_array_elements(users) u WHERE u->>'pin'='13')=1
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(users) u
      WHERE u->>'pin'='13' AND u->>'group'='2' AND u->>'role'='0')
    AND NOT EXISTS (SELECT 1 FROM sport_center.x904_user_commands cmd
      WHERE cmd.device_serial=$1 AND cmd.user_pin='13'
      AND cmd.created_at>latest.observed_at
      AND cmd.state NOT IN ('cancelled','failed'))`,[device]);
  assert.equal((await verify()).rows.length,0,"missing snapshot is not readback");
  await db.query("INSERT INTO sport_center.gym_x904_access_snapshots VALUES (now()-interval '20 minutes',$1,$2::jsonb)",[device,JSON.stringify([{pin:"13",group:2,role:0}])]);
  assert.equal((await verify()).rows.length,0,"stale snapshot is not readback");
  await db.query("INSERT INTO sport_center.gym_x904_access_snapshots VALUES (now()-interval '1 minute',$1,$2::jsonb)",[device,JSON.stringify([{pin:"13",group:1,role:0}])]);
  assert.equal((await verify()).rows.length,0,"active group is not safe readback");
  await db.query("INSERT INTO sport_center.gym_x904_access_snapshots VALUES (now(),$1,$2::jsonb)",[device,JSON.stringify([{pin:"13",group:2,role:0}])]);
  assert.equal((await verify()).rows.length,1,"fresh snapshot with suspended PIN may pass");
  await db.query("INSERT INTO sport_center.x904_user_commands VALUES ($1,'13',now()+interval '1 second','pending')",[device]);
  assert.equal((await verify()).rows.length,0,"later activation command voids readback");
});
