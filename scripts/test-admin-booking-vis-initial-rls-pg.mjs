import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const requireApi=createRequire(new URL("../artifacts/api-server/package.json",import.meta.url));
const {Client}=requireApi("pg");
const url=new URL(process.env.ADMIN_VIS_RLS_TEST_URL || "postgresql://postgres:isolated_worker_test@127.0.0.1:55445/x904_nonmember");
if(url.hostname!=="127.0.0.1"||url.port!=="55445"||url.username!=="postgres"||url.pathname!=="/x904_nonmember") throw Error("ISOLATED_DATABASE_REQUIRED");
const sql=readFileSync(new URL("../artifacts/api-server/migrations/20261110_admin_booking_vis_initial_pending_rls.sql",import.meta.url),"utf8");
const db=new Client({connectionString:url.href});
await db.connect();
const exec=(query,params)=>db.query(query,params);
let passed=0;
function check(result,label){assert.equal(result,true,label);console.log("PASS",label);passed++}
async function denied(query,label) {
  await exec("SAVEPOINT check_denied");
  let err;
  try {await exec(query)}catch(e){err=e}
  await exec("ROLLBACK TO SAVEPOINT check_denied");
  await exec("RELEASE SAVEPOINT check_denied");
  check(err?.code==="42501",label);
}
try {
 await exec("BEGIN");
 await exec(`CREATE ROLE sport_center_app NOLOGIN;
 CREATE SCHEMA sport_center;
 CREATE TABLE sport_center.sport_facilities(id int primary key,name text,category text,booking_mode text);
 CREATE TABLE sport_center.sport_bookings(id int primary key,facility_id int,source text,payer_type text,booking_type text,status text,booking_date text);
 CREATE TABLE sport_center.x904_nonmember_daily_access(
 id int generated always as identity primary key,device_serial text,identity_type text,identity_label text,user_pin text,device_uid int,
 access_state text,verification_state text,activated_at timestamptz,payment_id int,confirmed_at timestamptz,expires_at timestamptz,booking_id int
 );
 ALTER TABLE sport_center.x904_nonmember_daily_access ENABLE ROW LEVEL SECURITY;
 GRANT USAGE ON SCHEMA sport_center TO sport_center_app;
 GRANT SELECT ON sport_center.sport_bookings,sport_center.sport_facilities TO sport_center_app;
 GRANT INSERT,SELECT ON sport_center.x904_nonmember_daily_access TO sport_center_app;
 GRANT USAGE ON SEQUENCE sport_center.x904_nonmember_daily_access_id_seq TO sport_center_app;
 INSERT INTO sport_center.sport_facilities VALUES(1,'Gym','Gym','walk_in'),(2,'Badminton','Badminton','time_slot');
 INSERT INTO sport_center.sport_bookings VALUES
 (101,1,'admin','personal','regular','pending_payment',to_char(now() AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD')),
 (102,1,'web','personal','regular','pending_payment',to_char(now() AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD')),
 (103,1,'admin','personal','regular','cancelled',to_char(now() AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD')),
 (104,2,'admin','personal','regular','pending_payment',to_char(now() AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD')),
 (105,1,'admin','company','regular','pending_payment',to_char(now() AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD')); `);
 const insert=(id,label="VIS001",pin="78",uid=338,verification="pending",payment="NULL")=>
 `INSERT INTO sport_center.x904_nonmember_daily_access
 (device_serial,identity_type,identity_label,user_pin,device_uid,access_state,verification_state,activated_at,payment_id,confirmed_at,expires_at,booking_id)
 VALUES('TDBD234200545','card','${label}','${pin}',${uid},'pending','${verification}',NULL,${payment},NULL,NULL,${id})`;
 await exec("SET LOCAL ROLE sport_center_app");
 await denied(insert(101),"Baseline before new policy blocks admin VIS pending creation");
 await exec("RESET ROLE");
 await exec(sql);
 await exec("SET LOCAL ROLE sport_center_app");
 await exec(insert(101));
 await exec("RESET ROLE");
 check((await exec("SELECT count(*)::int n FROM sport_center.x904_nonmember_daily_access")).rows[0].n===1,"Role-limited valid unpaid admin Gym VIS permitted");
 await exec("SET LOCAL ROLE sport_center_app");
 await denied(insert(102),"Web source cannot use admin policy");
 await denied(insert(103),"Cancelled admin booking denied");
 await denied(insert(104),"Non-Gym facility denied");
 await denied(insert(105),"Corporate booking denied");
 await denied(insert(101,"VIS001","78",999),"Wrong UID denied");
 await denied(insert(101,"VIS001","78",338,"verified"),"Premature verified entitlement denied");
 await denied(insert(101,"VIS001","78",338,"pending","200"),"Premature payment link denied");
 await denied(insert(101,"VIS002","78",338),"Mismatched card PIN denied");
 await exec("RESET ROLE");
 check((await exec("SELECT count(*)::int n FROM pg_policies WHERE schemaname='sport_center' AND policyname='x904_nonmember_app_admin_card_initial_pending_insert' AND roles::text LIKE '%sport_center_app%'")).rows[0].n===1,"Policy only targets app role");
 await exec("ROLLBACK");
 console.log(`ADMIN_VIS_RLS_PASS ${passed}/${passed} (all fixtures rolled back)`);
} catch(e) {await exec("ROLLBACK").catch(()=>{});throw e} finally {await db.end()}
