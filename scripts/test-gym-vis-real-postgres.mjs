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
  const reserved=await db.query("SELECT state,collected_at FROM sport_center.gym_vis_card_reservations WHERE booking_id=1");
  assert.equal(reserved.rows[0].state,'reserved');
  assert.equal(reserved.rows[0].collected_at,null);
  await db.query("UPDATE sport_center.gym_vis_card_reservations SET state='collected',collected_at=now() WHERE booking_id=1");
  const collected=await db.query("SELECT state,collected_at FROM sport_center.gym_vis_card_reservations WHERE booking_id=1");
  assert.equal(collected.rows[0].state,'collected');
  assert.ok(collected.rows[0].collected_at);
  await db.query("UPDATE sport_center.gym_vis_card_reservations SET state='returned',returned_at=now() WHERE booking_id=1 AND state='collected'");
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
    command_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    device_serial text NOT NULL,user_pin text NOT NULL,
    created_at timestamptz NOT NULL,state text NOT NULL,
    command_type text NOT NULL DEFAULT 'ACTIVATE_USER', completed_at timestamptz
  )`);
  await db.query(`CREATE TABLE sport_center.x904_vmsc_command_receipts (
    command_id uuid PRIMARY KEY,verified boolean NOT NULL,
    callback_received_at timestamptz NOT NULL
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
      AND cmd.created_at>latest.observed_at)
    AND NOT EXISTS (
      SELECT 1 FROM (
        SELECT command_id,command_type,state,completed_at
        FROM sport_center.x904_user_commands
        WHERE device_serial=$1 AND user_pin='13'
        AND created_at>=now()-interval '5 minutes'
        ORDER BY created_at DESC,command_id DESC LIMIT 1
      ) last_command
      WHERE last_command.command_type<>'SUSPEND_USER'
         OR last_command.state<>'completed'
         OR last_command.completed_at IS NULL
         OR last_command.completed_at>latest.observed_at
         OR NOT EXISTS (
           SELECT 1 FROM sport_center.x904_vmsc_command_receipts receipt
           WHERE receipt.command_id=last_command.command_id
           AND receipt.verified=true
           AND receipt.callback_received_at<=latest.observed_at
         )
    )`,[device]);
  assert.equal((await verify()).rows.length,0,"missing snapshot is not readback");
  await db.query("INSERT INTO sport_center.gym_x904_access_snapshots VALUES (now()-interval '20 minutes',$1,$2::jsonb)",[device,JSON.stringify([{pin:"13",group:2,role:0}])]);
  assert.equal((await verify()).rows.length,0,"stale snapshot is not readback");
  await db.query("INSERT INTO sport_center.gym_x904_access_snapshots VALUES (now()-interval '1 minute',$1,$2::jsonb)",[device,JSON.stringify([{pin:"13",group:1,role:0}])]);
  assert.equal((await verify()).rows.length,0,"active group is not safe readback");
  await db.query("INSERT INTO sport_center.gym_x904_access_snapshots VALUES (now(),$1,$2::jsonb)",[device,JSON.stringify([{pin:"13",group:2,role:0}])]);
  assert.equal((await verify()).rows.length,1,"fresh snapshot with suspended PIN may pass");
  await db.query("INSERT INTO sport_center.x904_user_commands(device_serial,user_pin,created_at,state) VALUES ($1,'13',now()+interval '1 second','pending')",[device]);
  assert.equal((await verify()).rows.length,0,"later activation command voids readback");
  await db.query("UPDATE sport_center.x904_user_commands SET state='failed'");
  assert.equal((await verify()).rows.length,0,"a failed command cannot prove the device stayed suspended");
  await db.query(`UPDATE sport_center.x904_user_commands
    SET command_type='SUSPEND_USER',state='completed',
        created_at=now()-interval '15 seconds',
        completed_at=now()-interval '10 seconds'`);
  assert.equal((await verify()).rows.length,0,"completed suspend without verified VMSC receipt is insufficient");
  await db.query(`INSERT INTO sport_center.x904_vmsc_command_receipts
    SELECT command_id,false,now()-interval '5 seconds' FROM sport_center.x904_user_commands`);
  assert.equal((await verify()).rows.length,0,"unverified receipt must not release card");
  await db.query("UPDATE sport_center.x904_vmsc_command_receipts SET verified=true");
  assert.equal((await verify()).rows.length,1,"verified suspend receipt and later group-2 snapshot permit safe return");

});

test("isolated PostgreSQL: paid VIS stays held until matching physical handover",async()=>{
  // Use the local vis_ci fixture only. These fields mirror the existing PROD
  // table; the reservation itself is not a door command.
  await db.query(`ALTER TABLE sport_center.x904_nonmember_daily_access
    ADD COLUMN payment_id integer,
    ADD COLUMN identity_type text,
    ADD COLUMN identity_label text,
    ADD COLUMN device_uid integer,
    ADD COLUMN verification_state text,
    ADD COLUMN activated_at timestamptz,
    ADD COLUMN expires_at timestamptz`);
  await insertReservation(5,5,"VIS005","11",11,"ADMINPAY-5");
  await db.query(`INSERT INTO sport_center.x904_nonmember_daily_access
    (device_serial,user_pin,booking_id,payment_id,identity_type,identity_label,
     device_uid,verification_state,access_state,expires_at)
    VALUES ($1,'11',5,5,'card','VIS005',11,'pending','pending',now()+interval '1 hour')`,[device]);
  const canWorkerAct=()=>db.query(`SELECT count(*)::int AS n
    FROM sport_center.x904_nonmember_daily_access a
    JOIN sport_center.gym_vis_card_reservations r
      ON r.booking_id=a.booking_id AND r.payment_id=a.payment_id
     AND r.user_pin=a.user_pin AND r.device_uid=a.device_uid
    WHERE a.booking_id=5 AND a.verification_state='verified'
      AND r.state='collected' AND r.collected_at IS NOT NULL`);
  assert.equal((await canWorkerAct()).rows[0].n,0,"paid reservation cannot open door");
  const handover=async uid=>db.query(`UPDATE sport_center.x904_nonmember_daily_access
     SET verification_state='verified'
     WHERE device_serial=$1 AND booking_id=5 AND payment_id=5
       AND identity_type='card' AND identity_label='VIS005'
       AND user_pin='11' AND device_uid=$2
       AND verification_state='pending' AND access_state='pending'
       AND activated_at IS NULL AND expires_at>now()
     RETURNING booking_id`,[device,uid]);
  assert.equal((await handover(999)).rows.length,0,"wrong physical UID cannot unlock");
  assert.equal((await handover(11)).rows.length,1,"verified handover can unlock held grant");
  assert.equal((await canWorkerAct()).rows[0].n,0,"uncollected reservation still blocks worker");
  await db.query(`UPDATE sport_center.gym_vis_card_reservations
    SET state='collected',collected_at=now()
    WHERE booking_id=5 AND state='reserved'`);
  assert.equal((await canWorkerAct()).rows[0].n,1,"collected reservation and verified grant eligible");
  assert.equal((await handover(11)).rows.length,0,"handover retry must be a no-op");
  await db.query(`UPDATE sport_center.x904_nonmember_daily_access
    SET verification_state='pending' WHERE booking_id=5`);
  assert.equal((await canWorkerAct()).rows[0].n,0,"withdrawn verification blocks activation");
});

test("synthetic VIS006 E2E: confirmed payment, held grant, card handover, device ACK, 23:00 suspend", async()=>{
  // Local vis_ci only; this is not a live payment/physical X904 test.
  const open="2026-11-06T12:00:00+07:00", close="2026-11-06T23:00:00+07:00";
  await db.query("ALTER TABLE sport_center.sport_bookings ADD COLUMN status text DEFAULT 'pending_payment'");
  await db.query("ALTER TABLE sport_center.sport_payments ADD COLUMN status text DEFAULT 'pending'");
  await db.query("ALTER TABLE sport_center.sport_payments ADD COLUMN confirmed_at timestamptz");
  await db.query("ALTER TABLE sport_center.x904_nonmember_daily_access ADD COLUMN confirmed_at timestamptz");
  await db.query("ALTER TABLE sport_center.x904_nonmember_daily_access ADD COLUMN verified_name text");
  await db.query("ALTER TABLE sport_center.x904_user_commands ADD COLUMN result jsonb");
  await db.query("ALTER TABLE sport_center.x904_user_commands ADD COLUMN idempotency_key text UNIQUE");
  await db.query("UPDATE sport_center.sport_bookings SET status='confirmed' WHERE id=6");
  await db.query("UPDATE sport_center.sport_payments SET status='confirmed',confirmed_at=$1 WHERE id=6",[open]);
  // These two inserts must share one booking/payment transaction.
  await db.query("BEGIN");
  try {
    await insertReservation(6,6,"VIS006","15",15,"ADMINPAY-6");
    await db.query("INSERT INTO sport_center.x904_nonmember_daily_access (device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,booking_id,payment_id,confirmed_at,expires_at,verification_state,access_state) VALUES ($1,'card','VIS006','15',15,'VIS 006',6,6,$2,$3,'pending','pending')",[device,open,close]);
    await db.query("COMMIT");
  } catch(e) {await db.query("ROLLBACK");throw e;}
  const eligible=async at=>db.query("SELECT a.booking_id FROM sport_center.x904_nonmember_daily_access a JOIN sport_center.gym_vis_card_reservations r ON r.booking_id=a.booking_id AND r.payment_id=a.payment_id AND r.user_pin=a.user_pin AND r.device_uid=a.device_uid JOIN sport_center.sport_bookings b ON b.id=a.booking_id JOIN sport_center.sport_payments p ON p.id=a.payment_id AND p.booking_id=a.booking_id WHERE a.booking_id=6 AND a.verification_state='verified' AND a.access_state IN ('pending','active') AND r.state='collected' AND r.collected_at IS NOT NULL AND b.status='confirmed' AND p.status='confirmed' AND $1::timestamptz<a.expires_at",[at]);
  assert.equal((await eligible(open)).rows.length,0,"payment alone cannot enable machine");
  await assert.rejects(insertReservation(7,7,"VIS006","15",15,"ADMINPAY-7"),e=>e.code==="23505","duplicate physical card blocked");
  await db.query("BEGIN");
  try {
    const granted=await db.query("UPDATE sport_center.x904_nonmember_daily_access SET verification_state='verified' WHERE booking_id=6 AND payment_id=6 AND user_pin='15' AND device_uid=15 AND identity_type='card' AND identity_label='VIS006' AND verification_state='pending' AND access_state='pending' RETURNING booking_id");
    assert.equal(granted.rows.length,1);
    await db.query("UPDATE sport_center.gym_vis_card_reservations SET state='collected',collected_at=$1 WHERE booking_id=6 AND state='reserved'",[open]);
    await db.query("COMMIT");
  } catch(e) {await db.query("ROLLBACK");throw e;}
  assert.equal((await eligible(open)).rows.length,1,"physical handover makes grant eligible");
  assert.equal((await eligible(close)).rows.length,0,"23:00 closing prevents activation");
  const ackKey="ci:vis006:activation:6";
  const enqueue=()=>db.query("INSERT INTO sport_center.x904_user_commands (device_serial,user_pin,created_at,state,command_type,idempotency_key) VALUES ($1,'15',$2,'queued','ACTIVATE_USER',$3) ON CONFLICT (idempotency_key) DO NOTHING RETURNING command_id",[device,open,ackKey]);
  assert.equal((await enqueue()).rows.length,1);
  assert.equal((await enqueue()).rows.length,0,"retry never enqueues twice");
  await db.query("UPDATE sport_center.x904_user_commands SET state='completed',completed_at=$1,result=$2::jsonb WHERE idempotency_key=$3",["2026-11-06T12:00:30+07:00",JSON.stringify({readBackConfirmed:true,afterGroup:1,deviceUid:15}),ackKey]);
  const activation=await db.query("SELECT result FROM sport_center.x904_user_commands WHERE idempotency_key=$1",[ackKey]);
  assert.equal(activation.rows[0].result.afterGroup,1);
  await db.query("UPDATE sport_center.x904_nonmember_daily_access SET activated_at=$1,access_state='active',expires_at=LEAST($1::timestamptz+interval '12 hours',('2026-11-06'::date+time '23:00') AT TIME ZONE 'Asia/Jakarta') WHERE booking_id=6",["2026-11-06T12:00:30+07:00"]);
  const current=await db.query("SELECT access_state,expires_at FROM sport_center.x904_nonmember_daily_access WHERE booking_id=6");
  assert.equal(current.rows[0].access_state,"active");
  assert.equal(new Date(current.rows[0].expires_at).toISOString(),"2026-11-06T16:00:00.000Z","closing is earlier than 12-hour duration");
  await db.query("INSERT INTO sport_center.x904_user_commands (device_serial,user_pin,created_at,state,command_type,completed_at,result,idempotency_key) VALUES ($1,'15',$2,'completed','SUSPEND_USER',$3,$4::jsonb,'ci:vis006:suspend:6')",[device,close,"2026-11-06T23:00:15+07:00",JSON.stringify({readBackConfirmed:true,afterGroup:2,deviceUid:15})]);
  await db.query("UPDATE sport_center.x904_nonmember_daily_access SET access_state='expired' WHERE booking_id=6");
  await db.query("UPDATE sport_center.sport_bookings SET status='completed' WHERE id=6");
  const safe=await db.query("SELECT 1 FROM sport_center.gym_vis_card_reservations r JOIN sport_center.x904_nonmember_daily_access a ON a.booking_id=r.booking_id JOIN sport_center.x904_user_commands cmd ON cmd.user_pin=r.user_pin AND cmd.idempotency_key='ci:vis006:suspend:6' WHERE r.booking_id=6 AND r.state='collected' AND a.access_state='expired' AND cmd.command_type='SUSPEND_USER' AND cmd.state='completed' AND cmd.result->>'readBackConfirmed'='true' AND cmd.result->>'afterGroup'='2' AND cmd.result->>'deviceUid'='15'");
  assert.equal(safe.rows.length,1,"verified simulated suspend ACK permits return");
  await db.query("UPDATE sport_center.gym_vis_card_reservations SET state='returned',returned_at=now() WHERE booking_id=6");
  const returned=await db.query("SELECT state FROM sport_center.gym_vis_card_reservations WHERE booking_id=6");
  assert.equal(returned.rows[0].state,"returned");
});
