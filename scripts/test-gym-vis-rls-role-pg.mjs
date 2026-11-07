import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const requireApi = createRequire(new URL('../artifacts/api-server/package.json', import.meta.url));
const { Client } = requireApi('pg');
const url = new URL(process.env.VIS_RLS_TEST_DATABASE_URL || 'postgresql://postgres:test_only@127.0.0.1:5432/vis_rls_ci');
if (url.hostname !== '127.0.0.1' || url.pathname !== '/vis_rls_ci' || url.username !== 'postgres') {
  throw Error('VIS_RLS_ISOLATED_POSTGRES_REQUIRED');
}
const device = 'TDBD234200545';
const migration = readFileSync(new URL('../artifacts/api-server/migrations/20261107_gym_vis_app_role_rls.sql', import.meta.url),'utf8');
const db = new Client({connectionString:url.href});

test('real PostgreSQL RLS: idempotency, drift, valid and invalid DML', async () => {
 await db.connect();
 try {
  await db.query("CREATE ROLE sport_center_app NOLOGIN");
  await db.query("CREATE SCHEMA sport_center");
  await db.query("GRANT USAGE ON SCHEMA sport_center TO sport_center_app");
  await db.query(`CREATE TYPE sport_center.booking_status AS ENUM ('pending','confirmed');
    CREATE TYPE sport_center.payment_status AS ENUM ('pending','confirmed');
    CREATE TABLE sport_center.sport_bookings (id integer PRIMARY KEY,source text,status sport_center.booking_status);
    CREATE TABLE sport_center.sport_payments (id integer PRIMARY KEY,booking_id integer,status sport_center.payment_status);
    CREATE TABLE sport_center.gym_vis_card_reservations (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,booking_id integer,payment_id integer,
      device_serial text DEFAULT 'TDBD234200545',card_code text,user_pin text,
      device_uid integer,state text DEFAULT 'reserved',funds_reference text,funds_verified_by text
    );
    CREATE TABLE sport_center.x904_nonmember_daily_access (
      device_serial text,identity_type text,identity_label text,user_pin text,
      device_uid integer,verified_name text,booking_id integer,payment_id integer,
      confirmed_at timestamptz,expires_at timestamptz,
      verification_state text,access_state text,activated_at timestamptz
    );
    INSERT INTO sport_center.sport_bookings VALUES
      (101,'gym_public_guest','confirmed'),
      (102,'gym_public_guest','pending'),
      (103,'gym_public_guest','confirmed'),
      (104,'other','confirmed');
    INSERT INTO sport_center.sport_payments VALUES
      (201,101,'confirmed'),(202,102,'confirmed'),
      (203,103,'pending'),(204,104,'confirmed');`);
  await db.query(migration);
  await db.query(migration);
  const policyCount=await db.query("SELECT count(*)::int n FROM pg_policies WHERE schemaname='sport_center' AND tablename IN ('gym_vis_card_reservations','x904_nonmember_daily_access')");
  assert.equal(policyCount.rows[0].n,6,'rerun must keep six policies');
  await db.query('BEGIN');
  await db.query('SET LOCAL ROLE sport_center_app');
  assert.equal((await db.query("SELECT current_user role")).rows[0].role,'sport_center_app');
  assert.equal((await db.query("SELECT row_security_active('sport_center.gym_vis_card_reservations') value")).rows[0].value,true);
  const reserve=(booking,payment,card,pin,uid)=>db.query(
    `INSERT INTO sport_center.gym_vis_card_reservations
      (booking_id,payment_id,device_serial,card_code,user_pin,device_uid,state,funds_reference,funds_verified_by)
      VALUES ($1,$2,$3,$4,$5,$6,'reserved','CI-TEST','CI-TEST')`,
    [booking,payment,device,card,pin,uid]
  );
  const denied=async (fn,name)=>{
    await db.query('SAVEPOINT negative_case');
    let deniedByRls=false;
    try { await fn(); } catch(e) {deniedByRls = e.code === '42501';}
    await db.query('ROLLBACK TO SAVEPOINT negative_case');
    await db.query('RELEASE SAVEPOINT negative_case');
    assert.equal(deniedByRls,true,name+' must be denied by RLS');
  };
  await reserve(101,201,'VIS002','90',339);
  await denied(()=>reserve(102,202,'VIS003','13',13),'pending booking');
  await denied(()=>reserve(103,203,'VIS003','13',13),'pending payment');
  await denied(()=>reserve(104,204,'VIS003','13',13),'non-gym booking');
  await denied(()=>reserve(101,201,'VIS003','11',11),'invalid card pairing');
  await db.query("UPDATE sport_center.gym_vis_card_reservations SET state='collected' WHERE booking_id=101");
  await denied(()=>db.query("UPDATE sport_center.gym_vis_card_reservations SET device_uid=999 WHERE booking_id=101"),'invalid UID update');
  await db.query("UPDATE sport_center.gym_vis_card_reservations SET state='returned' WHERE booking_id=101");
  await denied(()=>db.query(`INSERT INTO sport_center.x904_nonmember_daily_access
    (device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,booking_id,payment_id,confirmed_at,expires_at,verification_state,access_state)
    VALUES ($1,'card','VIS002','90',339,'VIS 002',101,201,now(),now()+interval '12 hours','verified','pending')`,[device]),'premature verified paid grant');
  await db.query(`INSERT INTO sport_center.x904_nonmember_daily_access
    (device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,booking_id,payment_id,confirmed_at,expires_at,verification_state,access_state)
    VALUES ($1,'card','VIS002','90',339,'VIS 002',101,201,now(),now()+interval '12 hours','pending','pending')`,[device]);
  assert.equal((await db.query("SELECT count(*)::int n FROM sport_center.x904_nonmember_daily_access")).rows[0].n,1);
  await db.query('ROLLBACK');
  assert.equal((await db.query("SELECT count(*)::int n FROM sport_center.gym_vis_card_reservations")).rows[0].n,0,'test rows rolled back');
  // Negative drift test: mutate a policy in a disposable test database only.
  await db.query('BEGIN');
  await db.query('ALTER POLICY gym_vis_app_select ON sport_center.gym_vis_card_reservations USING (true)');
  let driftRejected=false;
  try { await db.query(migration); }
  catch(e) { driftRejected = e.message.includes('VIS_POLICY_DRIFT'); }
  await db.query('ROLLBACK');
  assert.equal(driftRejected,true,'policy drift must abort migration');
 } finally { await db.end(); }
});
