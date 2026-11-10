import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const requireApi=createRequire(new URL("../artifacts/api-server/package.json",import.meta.url));
const {Client}=requireApi("pg");
const url=new URL(process.env.ADMIN_VIS_RLS_TEST_URL ||
  "postgresql://postgres:isolated_worker_test@127.0.0.1:55445/x904_nonmember");
if(url.hostname!=="127.0.0.1"||url.port!=="55445"||
   url.username!=="postgres"||url.pathname!=="/x904_nonmember")
  throw new Error("ISOLATED_LOCAL_POSTGRES_REQUIRED");
const db=new Client({connectionString:url.href});
await db.connect();
let passed=0;
const query=(sql)=>db.query(sql);
const check=(ok,name)=>{ assert.equal(ok,true,name); console.log("PASS",name); passed++; };
async function denied(sql,name){
  await query("SAVEPOINT isolated_denied");
  let code=null;
  try {await query(sql)}catch(e){code=e.code}
  await query("ROLLBACK TO SAVEPOINT isolated_denied");
  await query("RELEASE SAVEPOINT isolated_denied");
  check(code==="42501",name);
}
const migration=readFileSync(new URL(
  "../artifacts/api-server/migrations/20261110_admin_vis_physical_handover_return_rls.sql",
  import.meta.url),"utf8");
const correction=readFileSync(new URL(
  "../artifacts/api-server/migrations/20261110_admin_vis_rls_match_outer_booking.sql",
  import.meta.url),"utf8");
try {
  await query("BEGIN");
  await query(`
    CREATE ROLE sport_center_app NOLOGIN;
    CREATE SCHEMA sport_center;
    CREATE TABLE sport_center.sport_bookings(
      id integer primary key, source text, status text, booking_date text
    );
    CREATE TABLE sport_center.sport_payments(
      id integer primary key,booking_id integer,status text,confirmed_at timestamptz
    );
    CREATE TABLE sport_center.gym_vis_card_reservations(
      id bigint generated always as identity primary key,
      booking_id integer unique,payment_id integer,device_serial text,card_code text,
      user_pin text,device_uid integer,state text, funds_reference text,
      funds_verified_by text,collected_at timestamptz,returned_at timestamptz
    );
    ALTER TABLE sport_center.gym_vis_card_reservations ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA sport_center TO sport_center_app;
    GRANT SELECT ON sport_center.sport_bookings,sport_center.sport_payments TO sport_center_app;
    GRANT SELECT,INSERT,UPDATE ON sport_center.gym_vis_card_reservations TO sport_center_app;
    GRANT USAGE ON SEQUENCE sport_center.gym_vis_card_reservations_id_seq TO sport_center_app;
    -- Existing production policy behavior: SELECT and UPDATE are already
    -- available for the backend app role. Only INSERT must be added here.
    CREATE POLICY gym_vis_app_select ON sport_center.gym_vis_card_reservations
      FOR SELECT TO sport_center_app USING(device_serial='TDBD234200545');
    CREATE POLICY gym_vis_app_update ON sport_center.gym_vis_card_reservations
      FOR UPDATE TO sport_center_app
      USING(device_serial='TDBD234200545')
      WITH CHECK(device_serial='TDBD234200545');
    INSERT INTO sport_center.sport_bookings VALUES
      (1,'admin','confirmed',to_char(now() AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD')),
      (2,'web','confirmed',to_char(now() AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD')),
      (3,'admin','pending_payment',to_char(now() AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD')),
      (4,'admin','confirmed',to_char(now() AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD'));
    INSERT INTO sport_center.sport_payments VALUES
      (11,1,'confirmed',now()),(12,2,'confirmed',now()),
      (13,3,'pending',NULL),(14,4,'confirmed',now());
  `);
  const insert=(booking,payment,ref='ADMINVIS-HANDOVER-'+payment,
    state='collected',collected='now()',actor='STAFF-HANDOVER-302')=>
    `INSERT INTO sport_center.gym_vis_card_reservations(
      booking_id,payment_id,device_serial,card_code,user_pin,device_uid,
      state,funds_reference,funds_verified_by,collected_at)
      VALUES(${booking},${payment},'TDBD234200545','VIS001','78',338,
        '${state}','${ref}','${actor}',${collected})`;
  await query("SET LOCAL ROLE sport_center_app");
  await denied(insert(1,11),"Baseline: direct-admin physical claim blocked before RLS migration");
  await query("RESET ROLE");
  await query(migration);
  await query(correction);
  check(correction.includes("b.id=gym_vis_card_reservations.booking_id") &&
    correction.includes("p.id=gym_vis_card_reservations.payment_id"),
    "Migration and DEV correction explicitly bind the outer booking and payment");
  await query("SET LOCAL ROLE sport_center_app");
  await query(insert(1,11));
  check((await query("SELECT count(*)::int n FROM sport_center.gym_vis_card_reservations")).rows[0].n===1,
    "Admin Lapangan physical handover is allowed with confirmed payment");
  await denied(insert(2,12),"Web booking cannot claim using admin policy");
  await denied(insert(3,13),"Unconfirmed payment cannot create collected card");
  await denied(insert(3,14),"Confirmed payment from another booking cannot authorize a card");
  await denied(insert(4,14,"ADMINVIS-HANDOVER-14","reserved"),"Reserved without physical collection denied");
  await denied(insert(4,14,"BAD-REFERENCE"),"Forged reference denied");
  await denied(insert(4,14,"ADMINVIS-HANDOVER-14","collected","NULL"),"Absent physical collection timestamp denied");
  await denied(insert(4,14,"ADMINVIS-HANDOVER-14","collected","now()","BANK-CLAIMED"),"Non-staff handover actor denied");
  await query("UPDATE sport_center.gym_vis_card_reservations SET state='returned',returned_at=now() WHERE booking_id=1");
  check((await query("SELECT state FROM sport_center.gym_vis_card_reservations WHERE booking_id=1")).rows[0].state==="returned",
    "Admin Lapangan app role can mark verified physical card return");
  await query("RESET ROLE");
  await query(`INSERT INTO sport_center.gym_vis_card_reservations
    (booking_id,payment_id,device_serial,card_code,user_pin,device_uid,
     state,funds_reference,funds_verified_by,collected_at)
    VALUES(2,12,'TDBD234200545','VIS002','90',339,
      'collected','WEB-OTHER','WEB',now())`);
  await query("SET LOCAL ROLE sport_center_app");
  check((await query("SELECT count(*)::int n FROM sport_center.gym_vis_card_reservations")).rows[0].n===2,
    "Existing backend SELECT policy is unchanged for other reservations");
  await query("RESET ROLE");
  const count=(await query(`SELECT count(*)::int n FROM pg_policies
      WHERE schemaname='sport_center' AND tablename='gym_vis_card_reservations'
        AND roles::text LIKE '%sport_center_app%'`)).rows[0].n;
  check(count===3,"Existing SELECT/UPDATE remain; exactly one new INSERT policy");
  check(!/FOR SELECT|FOR UPDATE/i.test(migration),
    "New migration does not change existing read/update policy semantics");
  await query("ROLLBACK");
  console.log(`ADMIN_VIS_PHYSICAL_RLS_PASS ${passed}/${passed} — no persisted fixture data`);
} catch(e){
  await query("ROLLBACK").catch(()=>{});
  throw e;
} finally {await db.end()}
