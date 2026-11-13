import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { pool as appDatabasePool } from "@workspace/db";
import { readFileSync } from "node:fs";
import { processX904NonmemberDailyAccess } from "./x904NonmemberDailyAccessWorker";
import { processX904NewOrdinaryUserDefaultSuspend } from "./x904NewOrdinaryUserDefaultSuspend";
import { autoReserveVisAfterFundsVerified, collectReservedVisCard, returnVerifiedVisCard, recoverUnallocatedPaidGymVis } from "./x904GymVisitorCardReservations";

// All paid access scenarios use 08:00 WIB on 2026-11-06 as a stable
// simulated confirmation time. A wall-clock now() fixture would unpredictably
// fall after closing and invalidate 06:00–23:00 operating-hours assertions.
const url = process.env.X904_NONMEMBER_ISOLATED_PG_URL;
if (!url || !/^postgres(?:ql)?:\/\/[^@/]+@127\.0\.0\.1:5544[45]\/x904_nonmember(?:_safe[0-9]?)?(?:\?|$)/.test(url)) throw new Error("NONMEMBER_ISOLATED_DATABASE_REQUIRED");
const pool = new pg.Pool({ connectionString: url, max: 2 });
const db = drizzle(pool);
const run = (query: string, params?: unknown[]) => pool.query(query, params);
const envKeys = ["GYM_X904_NONMEMBER_ACCESS_ENABLED","GYM_X904_MANUAL_ACCESS_ENABLED","GYM_X904_USER_WRITE_ENABLED","GYM_X904_AUTOMATIC_REQUESTED_BY","GYM_X904_NONMEMBER_ONLY_PIN","GYM_X904_NONMEMBER_ALLOWED_PINS","GYM_X904_NEW_USER_DEFAULT_SUSPEND_ENABLED","GYM_X904_NEW_USER_BASELINE_AT","GYM_X904_NEW_USER_ONLY_PIN"] as const;
const oldEnv = envKeys.map(key => process.env[key]);
const migration = readFileSync("migrations/20261031_x904_nonmember_daily_access.sql","utf8");
const activationClockMigration = readFileSync("migrations/20261102_x904_nonmember_verified_activation_clock.sql","utf8");
const businessHoursMigration = readFileSync("migrations/20261105_x904_nonmember_2300_wib_cutoff.sql","utf8");
const liveAccessIndexMigration = readFileSync("migrations/20261107_x904_review_required_not_live.sql","utf8");

beforeAll(async () => {
  await run("CREATE SCHEMA sport_center");
  await run(`CREATE TABLE sport_center.users(id int primary key,name text,registration_source text,account_status text,email text,password_hash text,role text NOT NULL DEFAULT 'customer');
    CREATE TABLE sport_center.audit_logs(id serial primary key,user_id int,user_name text,user_role text,action text NOT NULL,entity text,entity_id int,"before" jsonb,"after" jsonb,ip_address text,user_agent text,created_at timestamptz DEFAULT now());
    CREATE TABLE sport_center.gym_x904_member_mapping(membership_id int,user_pin text,device_serial text,status text);
    CREATE TABLE sport_center.sport_bookings(id int primary key, booking_date text NOT NULL DEFAULT '2026-11-06', start_time text NOT NULL DEFAULT '06:00', source text, notes text, status text NOT NULL DEFAULT 'confirmed');
    CREATE TABLE sport_center.sport_payments(id int primary key,booking_id int references sport_center.sport_bookings(id),status text,confirmed_at timestamptz,paid_at timestamptz);
    CREATE TABLE sport_center.gym_x904_access_snapshots(snapshot_id bigserial primary key,device_serial text,observed_at timestamptz,user_count int,users jsonb);
    CREATE TABLE sport_center.x904_user_commands(
      command_id uuid primary key default gen_random_uuid(),device_serial text not null,
      command_type text not null,user_pin text not null,payload jsonb not null,
      requested_by bigint not null,idempotency_key text not null unique,
      attempts int not null default 0,state text not null default 'queued',
      result jsonb,created_at timestamptz not null default now(),completed_at timestamptz,
      lease_token uuid,leased_until timestamptz);
    CREATE UNIQUE INDEX x904_one_active_test ON sport_center.x904_user_commands(device_serial,user_pin)
      WHERE state IN ('queued','claimed');`);
  await run(migration);
  await run(activationClockMigration);
  await run(businessHoursMigration);
  await run(liveAccessIndexMigration);
  // Supabase roles are absent from bare PostgreSQL; create only in isolated fixture.
  await run("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; END $$");
  await run("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$");
  await run("ALTER TABLE sport_center.x904_nonmember_daily_access ADD COLUMN visitor_name text");
  await run(`ALTER TABLE sport_center.sport_bookings
    ADD COLUMN order_number text,
    ADD COLUMN customer_name text,
    ADD COLUMN grand_total numeric,
    ADD COLUMN total_price numeric;
    ALTER TABLE sport_center.sport_payments
    ADD COLUMN amount numeric,
    ADD COLUMN proof_url text,
    ADD COLUMN reference_number text,
    ADD COLUMN provider_reference text,
    ADD COLUMN provider_trade_no text,
    ADD COLUMN merchant_trade_no text;`);
  await run(readFileSync("migrations/20261106_gym_vis_card_reservations.sql","utf8"));

  // Registry is isolated to this disposable PostgreSQL test database.
  await run(readFileSync("sql/x904_verified_nonmember_identities.sql", "utf8"));
  await run(`CREATE TABLE sport_center.gym_x904_lan_users(
    device_serial text,user_pin text,device_uid integer,display_name text,device_role integer);
    INSERT INTO sport_center.gym_x904_lan_users VALUES
      ('TDBD234200545','601',601,'TEST VERIFIED',0),
      ('TDBD234200545','602',602,'TEST REVOKED',0),
      ('TDBD234200545','603',603,'TEST RACE',0),
      ('TDBD234200545','13',13,'VIS 003',0),
      ('TDBD234200545','17',17,'VIS 004',0),
      ('TDBD234200545','90',339,'VIS 002',0),
      ('TDBD234200545','15',15,'VIS 006',0);`);
  await run(`INSERT INTO sport_center.users(id,name,registration_source,account_status,email,password_hash,role) VALUES(301,'X904 AUTOMATION SERVICE','system_x904_automation','inactive',null,null,'staff'),(302,'CI ACTIVE STAFF','isolated-test','active',null,null,'staff');
    INSERT INTO sport_center.sport_bookings(id) VALUES(9001);
    INSERT INTO sport_center.x904_nonmember_daily_access(device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,booking_id)
    VALUES('TDBD234200545','card','VIS001','78',338,'VIS 001',9001);
    INSERT INTO sport_center.sport_payments(id,booking_id,status) VALUES(9101,9001,'pending');`);
  process.env.GYM_X904_NONMEMBER_ACCESS_ENABLED = "true";
  process.env.GYM_X904_MANUAL_ACCESS_ENABLED = "true";
  process.env.GYM_X904_USER_WRITE_ENABLED = "true";
  process.env.GYM_X904_AUTOMATIC_REQUESTED_BY = "301";
  process.env.GYM_X904_NONMEMBER_ALLOWED_PINS = "15,78,90,13,17,11,237,500,501,502,503,504";
});
afterAll(async () => {
  envKeys.forEach((key,i) => oldEnv[i] === undefined ? delete process.env[key] : process.env[key] = oldEnv[i]!);
  await appDatabasePool.end();
  await pool.end();
});
const addSnapshot = async (at: Date, pin: string, name: string, group: number, role = 0) => run(`INSERT INTO sport_center.gym_x904_access_snapshots(device_serial,observed_at,user_count,users)
  VALUES('TDBD234200545','${at.toISOString()}',1,
  jsonb_build_array(jsonb_build_object('pin','${pin}','name','${name}','role',${role},'group',${group},'enabled',true)))`);
const commandFor = async (type: string, accessId: number) => (await run(`SELECT command_id,payload FROM sport_center.x904_user_commands
  WHERE command_type='${type}' AND payload->>'accessId'='${accessId}' ORDER BY created_at DESC,command_id DESC LIMIT 1`)).rows[0];
const ack = async (id: string, at: Date, pin: string, name: string, uid: number, group: number) => {
  await run(`UPDATE sport_center.x904_user_commands SET state='completed',completed_at='${at.toISOString()}',
    result=jsonb_build_object('readBackConfirmed',true,'deviceUid',${uid},'afterGroup',${group})
    WHERE command_id='${id}'`);
  await addSnapshot(new Date(at.getTime()+1000),pin,name,group);
};

test("pending payment holds; confirmed VIS payment activates, retries DEVICE_BUSY once, then suspends after 12h", async () => {
  await processX904NonmemberDailyAccess(db as any,new Date());
  expect((await run("SELECT count(*)::int n FROM sport_center.x904_user_commands")).rows[0].n).toBe(0);

  await run("UPDATE sport_center.sport_payments SET status='confirmed',confirmed_at='2026-11-06T01:00:00Z' WHERE id=9101");
  const payment = (await run("SELECT confirmed_at,expires_at FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9001")).rows[0];
  expect(new Date(payment.expires_at).getTime()-new Date(payment.confirmed_at).getTime()).toBe(12*60*60*1000);
  const start = new Date(payment.confirmed_at);
  await addSnapshot(new Date(start.getTime()-1000),'78','VIS 001',2);
  await processX904NonmemberDailyAccess(db as any,new Date(start.getTime()+100));
  const firstActivate = await commandFor("ACTIVATE_USER",1);
  expect(firstActivate?.payload).toMatchObject({source:"AUTO_NONMEMBER_GYM_12H",accessId:1,expectedUid:338,attempt:1});

  const busyAt = new Date(start.getTime()+2000);
  await run(`UPDATE sport_center.x904_user_commands SET state='failed',attempts=1,completed_at='${busyAt.toISOString()}',
    result=jsonb_build_object('readBackConfirmed',false,'errorCode','DEVICE_BUSY')
    WHERE command_id='${firstActivate.command_id}'`);
  await addSnapshot(new Date(busyAt.getTime()+1000),'78','VIS 001',2);
  await processX904NonmemberDailyAccess(db as any,new Date(busyAt.getTime()+61_000));
  const retryActivate = await commandFor("ACTIVATE_USER",1);
  expect(retryActivate?.command_id).not.toBe(firstActivate.command_id);
  expect(retryActivate?.payload).toMatchObject({attempt:2});
  expect((await run("SELECT count(*)::int n FROM sport_center.x904_user_commands WHERE command_type='ACTIVATE_USER' AND payload->>'accessId'='1'")).rows[0].n).toBe(2);

  const activateAck = new Date(busyAt.getTime()+63_000);
  await ack(String(retryActivate.command_id),activateAck,'78','VIS 001',338,1);
  await processX904NonmemberDailyAccess(db as any,new Date(activateAck.getTime()+2000));
  expect((await run("SELECT access_state FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9001")).rows[0].access_state).toBe("active");
  const verifiedClock = (await run("SELECT activated_at,expires_at FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9001")).rows[0];
  expect(new Date(verifiedClock.activated_at).getTime()).toBe(activateAck.getTime());
  expect(new Date(verifiedClock.expires_at).getTime()-activateAck.getTime()).toBe(12*60*60*1000);

  const expiredAt = new Date(activateAck.getTime()+12*60*60*1000+1000);
  await addSnapshot(expiredAt,'78','VIS 001',1);
  await processX904NonmemberDailyAccess(db as any,new Date(expiredAt.getTime()+100));
  const suspend = await commandFor("SUSPEND_USER",1);
  expect(suspend?.payload).toMatchObject({source:"AUTO_NONMEMBER_GYM_12H",accessId:1,expectedUid:338});
  const suspendAck = new Date(expiredAt.getTime()+2000);
  await ack(String(suspend.command_id),suspendAck,'78','VIS 001',338,2);
  await processX904NonmemberDailyAccess(db as any,new Date(suspendAck.getTime()+2000));
  expect((await run("SELECT access_state FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9001")).rows[0].access_state).toBe("expired");
  expect((await run("SELECT count(*)::int n FROM sport_center.x904_user_commands")).rows[0].n).toBe(3);
});

test("refund of an active paid nonmember queues suspend; protected PINs do not auto-suspend", async () => {
  await run(`INSERT INTO sport_center.sport_bookings(id) VALUES(9002);
    INSERT INTO sport_center.x904_nonmember_daily_access(device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,booking_id)
    VALUES('TDBD234200545','pin','PIN:500','500',500,'TEST NONMEMBER',9002);
    INSERT INTO sport_center.sport_payments(id,booking_id,status) VALUES(9102,9002,'pending');
    UPDATE sport_center.sport_payments SET status='confirmed',confirmed_at='2026-11-06T01:00:00Z' WHERE id=9102;`);
  const payment = (await run("SELECT confirmed_at FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9002")).rows[0];
  const start = new Date(payment.confirmed_at);
  await addSnapshot(new Date(start.getTime()-1000),'500','TEST NONMEMBER',2);
  await processX904NonmemberDailyAccess(db as any,new Date(start.getTime()+100));
  const activation = await commandFor("ACTIVATE_USER",2);
  const activationAck = new Date(start.getTime()+2000);
  await ack(String(activation.command_id),activationAck,'500','TEST NONMEMBER',500,1);
  await processX904NonmemberDailyAccess(db as any,new Date(activationAck.getTime()+2000));
  expect((await run("SELECT access_state FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9002")).rows[0].access_state).toBe("active");

  await run("UPDATE sport_center.sport_payments SET status='refunded' WHERE id=9102");
  await addSnapshot(new Date(activationAck.getTime()+3000),'500','TEST NONMEMBER',1);
  await processX904NonmemberDailyAccess(db as any,new Date(activationAck.getTime()+4000));
  const refundSuspend = await commandFor("SUSPEND_USER",2);
  expect(refundSuspend?.payload).toMatchObject({source:"AUTO_NONMEMBER_GYM_12H",accessId:2,expectedUid:500});
});

test("PIN 237 remains protected from activation and suspension by nonmember worker", async () => {
  await run(`INSERT INTO sport_center.sport_bookings(id) VALUES(9003);
    INSERT INTO sport_center.x904_nonmember_daily_access(device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,booking_id)
    VALUES('TDBD234200545','pin','PIN:237','237',237,'SANDI',9003);
    INSERT INTO sport_center.sport_payments(id,booking_id,status) VALUES(9103,9003,'pending');
    UPDATE sport_center.sport_payments SET status='confirmed',confirmed_at='2026-11-06T01:00:00Z' WHERE id=9103;`);
  await processX904NonmemberDailyAccess(db as any,new Date());
  expect(await commandFor("ACTIVATE_USER",3)).toBeUndefined();
  expect(await commandFor("SUSPEND_USER",3)).toBeUndefined();
  expect((await run("SELECT access_state FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9003")).rows[0].access_state).toBe("review_required");
});

test("wrong UID in ACK never marks access active", async () => {
  await run("INSERT INTO sport_center.sport_bookings(id) VALUES(9004)");
  await run("INSERT INTO sport_center.x904_nonmember_daily_access(device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,booking_id) VALUES('TDBD234200545','pin','PIN:501','501',501,'NEGATIVE UID',9004)");
  await run("INSERT INTO sport_center.sport_payments(id,booking_id,status) VALUES(9104,9004,'pending')");
  await run("UPDATE sport_center.sport_payments SET status='confirmed',confirmed_at='2026-11-06T01:00:00Z' WHERE id=9104");
  const start = new Date((await run("SELECT confirmed_at FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9004")).rows[0].confirmed_at);
  await addSnapshot(new Date(start.getTime()-1000),'501','NEGATIVE UID',2);
  await processX904NonmemberDailyAccess(db as any,new Date(start.getTime()+100));
  const command=await commandFor("ACTIVATE_USER",4);
  expect(command).toBeTruthy();
  const at=new Date(start.getTime()+2000);
  await ack(String(command.command_id),at,'501','NEGATIVE UID',999,1);
  await processX904NonmemberDailyAccess(db as any,new Date(at.getTime()+2000));
  const state=(await run("SELECT access_state,activated_at FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9004")).rows[0];
  expect(state.access_state).not.toBe("active");
  expect(state.activated_at).toBeNull();
});

test("cancelled payment before activation never queues activation", async () => {
  await run("INSERT INTO sport_center.sport_bookings(id) VALUES(9005)");
  await run("INSERT INTO sport_center.x904_nonmember_daily_access(device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,booking_id) VALUES('TDBD234200545','pin','PIN:502','502',502,'CANCELLED ACCESS',9005)");
  await run("INSERT INTO sport_center.sport_payments(id,booking_id,status) VALUES(9105,9005,'pending')");
  await run("UPDATE sport_center.sport_payments SET status='confirmed',confirmed_at='2026-11-06T01:00:00Z' WHERE id=9105");
  await run("UPDATE sport_center.sport_payments SET status='cancelled' WHERE id=9105");
  const start=new Date((await run("SELECT confirmed_at FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9005")).rows[0].confirmed_at);
  await addSnapshot(new Date(start.getTime()-1000),'502','CANCELLED ACCESS',2);
  await processX904NonmemberDailyAccess(db as any,new Date(start.getTime()+100));
  expect(await commandFor("ACTIVATE_USER",5)).toBeUndefined();
  const state=(await run("SELECT access_state,activated_at FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9005")).rows[0];
  expect(state.access_state).not.toBe("active");
  expect(state.activated_at).toBeNull();
});

test("completed SUSPEND ACK cannot be reused as ACTIVATE ACK", async () => {
  await run("INSERT INTO sport_center.sport_bookings(id) VALUES(9006)");
  await run("INSERT INTO sport_center.x904_nonmember_daily_access(device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,booking_id) VALUES('TDBD234200545','pin','PIN:503','503',503,'SUSPEND ACK',9006)");
  await run("INSERT INTO sport_center.sport_payments(id,booking_id,status) VALUES(9106,9006,'pending')");
  await run("UPDATE sport_center.sport_payments SET status='confirmed',confirmed_at='2026-11-06T01:00:00Z' WHERE id=9106");
  const start=new Date((await run("SELECT confirmed_at FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9006")).rows[0].confirmed_at);
  const accessId=Number((await run("SELECT access_id FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9006")).rows[0].access_id);
  const ackAt=new Date(start.getTime()+2000);
  await run(`INSERT INTO sport_center.x904_user_commands(device_serial,command_type,user_pin,payload,requested_by,idempotency_key,state,completed_at,result)
    VALUES('TDBD234200545','SUSPEND_USER','503',
      jsonb_build_object('source','AUTO_NONMEMBER_GYM_12H','accessId',${accessId}),301,'negative-suspend-ack-${accessId}','completed',
      '${ackAt.toISOString()}',jsonb_build_object('readBackConfirmed',true,'deviceUid',503,'afterGroup',1))`);
  await addSnapshot(new Date(ackAt.getTime()+1000),'503','SUSPEND ACK',1);
  await processX904NonmemberDailyAccess(db as any,new Date(ackAt.getTime()+2000));
  const state=(await run("SELECT access_state,activated_at FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9006")).rows[0];
  expect(state.access_state).not.toBe('active');
  expect(state.activated_at).toBeNull();
});

test("cancelled payment cannot suspend pre-existing Group 1 without verified activation", async () => {
  await run("INSERT INTO sport_center.sport_bookings(id) VALUES(9007)");
  await run("INSERT INTO sport_center.x904_nonmember_daily_access(device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,booking_id) VALUES('TDBD234200545','pin','PIN:504','504',504,'EXISTING GROUP ONE',9007)");
  await run("INSERT INTO sport_center.sport_payments(id,booking_id,status) VALUES(9107,9007,'pending')");
  await run("UPDATE sport_center.sport_payments SET status='confirmed',confirmed_at='2026-11-06T01:00:00Z' WHERE id=9107");
  await run("UPDATE sport_center.sport_payments SET status='cancelled' WHERE id=9107");
  const start=new Date((await run("SELECT confirmed_at FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9007")).rows[0].confirmed_at);
  await addSnapshot(new Date(start.getTime()-1000),'504','EXISTING GROUP ONE',1);
  await processX904NonmemberDailyAccess(db as any,new Date(start.getTime()+100));
  expect(await commandFor('SUSPEND_USER',7)).toBeUndefined();
  const state=(await run("SELECT access_state,activated_at FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9007")).rows[0];
  expect(state.access_state).toBe('review_required');
  expect(state.activated_at).toBeNull();
});

test("VIS006 existing Group 1 must not receive automatic suspend before paid activation", async () => {
  await run("INSERT INTO sport_center.sport_bookings(id) VALUES(9008)");
  await run("INSERT INTO sport_center.x904_nonmember_daily_access(device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,booking_id) VALUES('TDBD234200545','card','VIS006','15',15,'VIS 006',9008)");
  await run("INSERT INTO sport_center.sport_payments(id,booking_id,status) VALUES(9108,9008,'pending')");
  await run("UPDATE sport_center.sport_payments SET status='confirmed',confirmed_at='2026-11-06T01:00:00Z' WHERE id=9108");
  await run("UPDATE sport_center.sport_payments SET status='cancelled' WHERE id=9108");
  const start=new Date((await run("SELECT confirmed_at FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9008")).rows[0].confirmed_at);
  await addSnapshot(new Date(start.getTime()-1000),'15','VIS 006',1);
  await processX904NonmemberDailyAccess(db as any,new Date(start.getTime()+100));
  expect(await commandFor('SUSPEND_USER',8)).toBeUndefined();
  expect((await run("SELECT activated_at FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9008")).rows[0].activated_at).toBeNull();
});

test("VIS006 rollout guard rejects invalid PIN and excludes all other PINs", async () => {
  process.env.GYM_X904_NONMEMBER_ONLY_PIN = 'invalid';
  await processX904NonmemberDailyAccess(db as any,new Date());
  process.env.GYM_X904_NONMEMBER_ONLY_PIN = '15';
  const prior=(await run("SELECT count(*)::int AS n FROM sport_center.x904_user_commands WHERE user_pin <> '15'")).rows[0].n;
  await processX904NonmemberDailyAccess(db as any,new Date());
  const after=(await run("SELECT count(*)::int AS n FROM sport_center.x904_user_commands WHERE user_pin <> '15'")).rows[0].n;
  expect(after).toBe(prior);
  delete process.env.GYM_X904_NONMEMBER_ONLY_PIN;
});

test('VIS006 unpaid review_required is held without an unauthorized X904 suspend', async () => {
  process.env.GYM_X904_NONMEMBER_ONLY_PIN = '15';
  try {
    await run("DELETE FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9008");
    await run("INSERT INTO sport_center.sport_bookings(id) VALUES(9099)");
    await run("INSERT INTO sport_center.x904_nonmember_daily_access(device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,booking_id) VALUES('TDBD234200545','card','VIS006','15',15,'VIS 006',9099)");
    const access=(await run("SELECT access_id FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9099")).rows[0].access_id;
    await run("UPDATE sport_center.x904_nonmember_daily_access SET access_state='review_required' WHERE access_id="+access);
    const at=new Date();
    await addSnapshot(new Date(at.getTime()-1000),'15','VIS 006',1);
    await processX904NonmemberDailyAccess(db as any,at);
    expect(await commandFor('SUSPEND_USER',access)).toBeUndefined();
    expect(await commandFor('ACTIVATE_USER',access)).toBeUndefined();
    const state=(await run("SELECT access_state,payment_id,activated_at FROM sport_center.x904_nonmember_daily_access WHERE access_id="+access)).rows[0];
    expect(state).toMatchObject({access_state:'review_required',payment_id:null,activated_at:null});
  } finally {delete process.env.GYM_X904_NONMEMBER_ONLY_PIN;}
});

test('paid VIS006 review_required becomes expired after verified suspend and newer Group2 snapshot', async () => {
  process.env.GYM_X904_NONMEMBER_ONLY_PIN='15';
  try {
    await run("DELETE FROM sport_center.x904_nonmember_daily_access WHERE booking_id IN (9008,9099)");
    await run("INSERT INTO sport_center.sport_bookings(id) VALUES(9100)");
    await run("INSERT INTO sport_center.x904_nonmember_daily_access(device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,booking_id) VALUES('TDBD234200545','card','VIS006','15',15,'VIS 006',9100)");
    await run("INSERT INTO sport_center.sport_payments(id,booking_id,status) VALUES(9200,9100,'pending')");
    await run("UPDATE sport_center.sport_payments SET status='confirmed',confirmed_at='2026-11-06T01:00:00Z' WHERE id=9200");
    const a=(await run('SELECT access_id,confirmed_at FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9100')).rows[0];
    const access=Number(a.access_id), start=new Date(a.confirmed_at);
    const activated=new Date(start.getTime()+3000), expires=new Date(activated.getTime()+12*3600000);
    await run(`UPDATE sport_center.x904_nonmember_daily_access SET activated_at='${activated.toISOString()}',expires_at='${expires.toISOString()}',access_state='review_required' WHERE access_id=${access}`);
    const ackAt=new Date(expires.getTime()+3000);
    await run(`INSERT INTO sport_center.x904_user_commands(device_serial,command_type,user_pin,payload,requested_by,idempotency_key,state,completed_at,result) VALUES('TDBD234200545','SUSPEND_USER','15',jsonb_build_object('source','AUTO_NONMEMBER_GYM_12H','accessId',${access}),301,'review-reconcile-${access}','completed','${ackAt.toISOString()}',jsonb_build_object('readBackConfirmed',true,'deviceUid',15,'afterGroup',2))`);
    await addSnapshot(new Date(ackAt.getTime()+1000),'15','VIS 006',2);
    await processX904NonmemberDailyAccess(db as any,new Date(ackAt.getTime()+2000));
    expect((await run(`SELECT access_state FROM sport_center.x904_nonmember_daily_access WHERE access_id=${access}`)).rows[0].access_state).toBe('expired');
    expect((await run(`SELECT count(*)::int n FROM sport_center.x904_user_commands WHERE payload->>'accessId'='${access}'`)).rows[0].n).toBe(1);
  } finally { delete process.env.GYM_X904_NONMEMBER_ONLY_PIN; }
});

test("registry verified nonmember enqueues once, revoked and mid-cycle revoked never enqueue", async () => {
  const device = "TDBD234200545";
  const at = new Date();
  const addRegistry = async (pin: string, state: "verified" | "revoked") => {
    await run(`INSERT INTO sport_center.x904_verified_nonmember_identities
      (device_serial,user_pin,device_uid,display_name,verification_state,verified_by,verified_at,revoked_at)
      VALUES ('${device}','${pin}',${Number(pin)},'${pin === "601" ? "TEST VERIFIED" : pin === "602" ? "TEST REVOKED" : "TEST RACE"}',
       '${state}','isolated-test',now(),${state === "revoked" ? "now()" : "null"})`);
  };
  await addRegistry("601", "verified");
  await addRegistry("602", "verified");
  await addRegistry("603", "verified");
  process.env.GYM_X904_NONMEMBER_ONLY_PIN = "601";
  try {
    await addSnapshot(new Date(at.getTime() - 1000), "601", "TEST VERIFIED", 1);
    await processX904NonmemberDailyAccess(db as any, at);
    const count = async (pin: string) => Number((await run(`SELECT count(*)::int AS n
      FROM sport_center.x904_user_commands
      WHERE user_pin='${pin}' AND command_type='SUSPEND_USER'
        AND payload->>'source'='AUTO_NONMEMBER_LEGACY_VERIFIED'`)).rows[0].n);
    expect(await count("601")).toBe(1);
    await processX904NonmemberDailyAccess(db as any, at);
    expect(await count("601")).toBe(1);

    process.env.GYM_X904_NONMEMBER_ONLY_PIN = "602";
    await run(`UPDATE sport_center.x904_verified_nonmember_identities
      SET verification_state='revoked',revoked_at=now()
      WHERE device_serial='${device}' AND user_pin='602'`);
    await addSnapshot(new Date(at.getTime() - 1000), "602", "TEST REVOKED", 1);
    await processX904NonmemberDailyAccess(db as any, at);
    expect(await count("602")).toBe(0);

    // Revoke after the initial registry SELECT but before its transaction:
    // the transaction must re-read and reject the stale approval.
    process.env.GYM_X904_NONMEMBER_ONLY_PIN = "603";
    await addSnapshot(new Date(at.getTime() - 1000), "603", "TEST RACE", 1);
    let revokedDuringRead = false;
    const raceStore = {
      execute: async (statement: any) => {
        const result = await db.execute(statement);
        if (!revokedDuringRead && result.rows.some((r: any) => r.user_pin === "603" && r.device_uid === 603)) {
          revokedDuringRead = true;
          await run(`UPDATE sport_center.x904_verified_nonmember_identities
            SET verification_state='revoked',revoked_at=now()
            WHERE device_serial='${device}' AND user_pin='603'`);
        }
        return result;
      },
      transaction: db.transaction.bind(db),
    };
    await processX904NonmemberDailyAccess(raceStore as any, at);
    expect(revokedDuringRead).toBe(true);
    expect(await count("603")).toBe(0);
  } finally {
    delete process.env.GYM_X904_NONMEMBER_ONLY_PIN;
  }
});

test("public booking with verified ordinary X904 PIN: pending payment holds, confirmed grant activates once, ACK starts 12h, expiry suspends", async () => {
  // Disposable database only: no live booking, bank transaction or device command.
  const pin = "604", uid = 604, name = "CI VERIFIED PIN";
  const bookingId = 9604, paymentId = 9704;
  const paidAt = new Date("2026-11-06T01:00:00Z"); // 08:00 WIB
  process.env.GYM_X904_NONMEMBER_ONLY_PIN = pin;
  try {
    await run("INSERT INTO sport_center.gym_x904_lan_users VALUES ('TDBD234200545',$1,$2,$3,0)", [pin,uid,name]);
    await run(`INSERT INTO sport_center.x904_verified_nonmember_identities
      (device_serial,user_pin,device_uid,display_name,verification_state,verified_by,verified_at)
      VALUES ('TDBD234200545',$1,$2,$3,'verified','ci-operator',now())`, [pin,uid,name]);
    await run(`INSERT INTO sport_center.sport_bookings
      (id,booking_date,start_time,source,notes,status,order_number,customer_name,total_price)
      VALUES ($1,'2026-11-06','08:00','gym_public_guest',
      'Gym mandiri; nama cocok dengan registry X904; verifikasi petugas wajib',
      'pending_payment','SC-CI-PIN-9604',$2,30000)`, [bookingId,name]);
    await run(`INSERT INTO sport_center.x904_nonmember_daily_access
      (device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,
       booking_id,verification_state,access_state)
      VALUES ('TDBD234200545','pin','PIN REGISTERED',$1,$2,$3,$4,'verified','pending')`,
      [pin,uid,name,bookingId]);
    await run("INSERT INTO sport_center.sport_payments (id,booking_id,status) VALUES ($1,$2,'pending')",
      [paymentId,bookingId]);
    const accessId = Number((await run("SELECT access_id FROM sport_center.x904_nonmember_daily_access WHERE booking_id=$1",[bookingId])).rows[0].access_id);
    await addSnapshot(new Date(paidAt.getTime()-1000),pin,name,2);
    await processX904NonmemberDailyAccess(db as any,paidAt);
    expect(await commandFor("ACTIVATE_USER",accessId)).toBeUndefined();

    // Admin-approved payment is a simulated DB status, never a real bank mutation.
    await run("UPDATE sport_center.sport_bookings SET status='confirmed' WHERE id=$1",[bookingId]);
    await run("UPDATE sport_center.sport_payments SET status='confirmed',confirmed_at=$2 WHERE id=$1",[paymentId,paidAt]);
    const linked = (await run("SELECT payment_id,verification_state,access_state,confirmed_at FROM sport_center.x904_nonmember_daily_access WHERE access_id=$1",[accessId])).rows[0];
    expect(linked).toMatchObject({payment_id:paymentId,verification_state:"verified",access_state:"pending"});
    expect(linked.confirmed_at).toBeTruthy();
    await addSnapshot(new Date(paidAt.getTime()+1000),pin,name,2);
    await processX904NonmemberDailyAccess(db as any,new Date(paidAt.getTime()+2000));
    const activate = await commandFor("ACTIVATE_USER",accessId);
    expect(activate?.payload).toMatchObject({expectedUid:uid,source:"AUTO_NONMEMBER_GYM_12H",accessId});
    await processX904NonmemberDailyAccess(db as any,new Date(paidAt.getTime()+2500));
    expect(Number((await run("SELECT count(*)::int n FROM sport_center.x904_user_commands WHERE command_type='ACTIVATE_USER' AND payload->>'accessId'=$1",[String(accessId)])).rows[0].n)).toBe(1);

    const activatedAt=new Date(paidAt.getTime()+4000);
    await ack(String(activate.command_id),activatedAt,pin,name,uid,1);
    await processX904NonmemberDailyAccess(db as any,new Date(activatedAt.getTime()+2000));
    const active=(await run("SELECT access_state,activated_at,expires_at FROM sport_center.x904_nonmember_daily_access WHERE access_id=$1",[accessId])).rows[0];
    expect(active.access_state).toBe("active");
    expect(new Date(active.activated_at).getTime()).toBe(activatedAt.getTime());
    expect(new Date(active.expires_at).getTime()-activatedAt.getTime()).toBe(12*60*60*1000);

    const afterExpiry = new Date(new Date(active.expires_at).getTime()+3000);
    await addSnapshot(new Date(afterExpiry.getTime()-1000),pin,name,1);
    await processX904NonmemberDailyAccess(db as any,afterExpiry);
    const suspend=await commandFor("SUSPEND_USER",accessId);
    expect(suspend?.payload).toMatchObject({expectedUid:uid,source:"AUTO_NONMEMBER_GYM_12H",accessId});
    await ack(String(suspend.command_id),new Date(afterExpiry.getTime()+1000),pin,name,uid,2);
    await processX904NonmemberDailyAccess(db as any,new Date(afterExpiry.getTime()+3000));
    expect((await run("SELECT access_state FROM sport_center.x904_nonmember_daily_access WHERE access_id=$1",[accessId])).rows[0].access_state).toBe("expired");
    expect(Number((await run("SELECT count(*)::int n FROM sport_center.x904_user_commands WHERE payload->>'accessId'=$1",[String(accessId)])).rows[0].n)).toBe(2);
  } finally {
    delete process.env.GYM_X904_NONMEMBER_ONLY_PIN;
  }
});

test("real worker: paid VIS003 activates from one confirmation without fake handover, then cancels to suspend", async()=>{
  const at = new Date("2026-11-06T01:00:00Z");
  process.env.GYM_X904_NONMEMBER_ONLY_PIN = "13";
  try {
    await run("INSERT INTO sport_center.sport_bookings (id,source,notes,status) VALUES (9123,'gym_public_guest','Kartu VIS001–VIS006 menunggu pilihan','confirmed')");
    await run("INSERT INTO sport_center.x904_nonmember_daily_access (device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,booking_id) VALUES ('TDBD234200545','card','VIS003','13',13,'VIS 003',9123)");
    await run("INSERT INTO sport_center.sport_payments(id,booking_id,status) VALUES(9223,9123,'pending')");
    await run("UPDATE sport_center.sport_payments SET status='confirmed',confirmed_at='2026-11-06T01:00:00Z' WHERE id=9223");
    const linked = (await run("SELECT access_id,payment_id FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9123")).rows[0];
    expect(Number(linked.payment_id)).toBe(9223);
    await run("INSERT INTO sport_center.gym_vis_card_reservations (booking_id,payment_id,card_code,user_pin,device_uid,state,funds_reference,funds_verified_by) VALUES(9123,9223,'VIS003','13',13,'reserved','CI-BANK-9123','CI_STAFF')");
    await addSnapshot(new Date(at.getTime()-1000),'13','VIS 003',2);
    await processX904NonmemberDailyAccess(db as any,new Date(at.getTime()+100));
    expect(await commandFor("ACTIVATE_USER",Number(linked.access_id))).toBeTruthy();
    expect((await run("SELECT state,collected_at FROM sport_center.gym_vis_card_reservations WHERE booking_id=9123")).rows[0]).toMatchObject({state:"reserved",collected_at:null});
    await run("UPDATE sport_center.gym_vis_card_reservations SET state='collected',collected_at='2026-11-06T01:00:00Z' WHERE booking_id=9123");
    await addSnapshot(new Date(at.getTime()+200),'13','VIS 003',2);
    await processX904NonmemberDailyAccess(db as any,new Date(at.getTime()+500));
    const activate=await commandFor("ACTIVATE_USER",Number(linked.access_id));
    expect(activate).toBeTruthy();
    expect(activate?.payload).toMatchObject({expectedUid:13,source:"AUTO_NONMEMBER_GYM_12H"});
    await processX904NonmemberDailyAccess(db as any,new Date(at.getTime()+800));
    expect((await run("SELECT count(*)::int AS n FROM sport_center.x904_user_commands WHERE command_type='ACTIVATE_USER' AND user_pin='13'")).rows[0].n).toBe(1);
    const ackAt=new Date(at.getTime()+1500);
    await ack(String(activate.command_id),ackAt,'13','VIS 003',13,1);
    await processX904NonmemberDailyAccess(db as any,new Date(at.getTime()+4000));
    expect((await run("SELECT access_state FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9123")).rows[0].access_state).toBe("active");
    await run("UPDATE sport_center.sport_bookings SET status='cancelled' WHERE id=9123");
    await addSnapshot(new Date(at.getTime()+5000),'13','VIS 003',1);
    await processX904NonmemberDailyAccess(db as any,new Date(at.getTime()+7000));
    const suspended=await commandFor("SUSPEND_USER",Number(linked.access_id));
    expect(suspended).toBeTruthy();
    expect(suspended?.payload).toMatchObject({expectedUid:13,source:"AUTO_NONMEMBER_GYM_12H"});
  } finally {delete process.env.GYM_X904_NONMEMBER_ONLY_PIN;}
});

test("completed gym guest booking keeps an already activated entitlement until expiry", async()=>{
  const pin="11";
  process.env.GYM_X904_NONMEMBER_ONLY_PIN=pin;
  try {
    await run("INSERT INTO sport_center.sport_bookings (id,source,notes,status,booking_date,start_time) VALUES (9199,'gym_public_guest','Kartu VIS001–VIS006 menunggu pilihan','completed','2026-11-07','18:00')");
    await run("INSERT INTO sport_center.sport_payments(id,booking_id,status,confirmed_at) VALUES(9299,9199,'confirmed','2026-11-07T11:00:00Z')");
    await run("INSERT INTO sport_center.x904_nonmember_daily_access (device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,booking_id,payment_id,confirmed_at,expires_at,activated_at,verification_state,access_state) VALUES ('TDBD234200545','card','VIS005','11',11,'VIS 005',9199,9299,'2026-11-07T11:00:00Z','2026-11-07T16:00:00Z','2026-11-07T11:30:00Z','verified','active')");
    const grant=(await run("SELECT access_id FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9199")).rows[0];
    await run("INSERT INTO sport_center.gym_vis_card_reservations (booking_id,payment_id,card_code,user_pin,device_uid,state,collected_at,funds_reference,funds_verified_by) VALUES(9199,9299,'VIS005','11',11,'collected','2026-11-07T11:20:00Z','CI-9199','CI')");
    await addSnapshot(new Date('2026-11-07T12:00:00Z'),'11','VIS 005',1);
    await processX904NonmemberDailyAccess(db as any,new Date('2026-11-07T12:00:30Z'));
    expect(await commandFor("SUSPEND_USER",Number(grant.access_id))).toBeUndefined();
  } finally { delete process.env.GYM_X904_NONMEMBER_ONLY_PIN; }
});

test("real VIS reservation service: one confirmation authorizes grant without falsifying handover", async()=>{
  // Directly call the production service against isolated x904_nonmember_safe2.
  // No app DEV/PROD DB credentials and no physical X904 command.
  const futureDate=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Jakarta",year:"numeric",month:"2-digit",day:"2-digit"})
    .format(new Date(Date.now()+2*86400000));
  const order="SC-CI-VIS-9323";
  await run("INSERT INTO sport_center.sport_bookings(id,booking_date,start_time,source,notes,status,order_number,customer_name,total_price) VALUES (9323,$1,'07:00','gym_public_guest','Kartu VIS001–VIS006 menunggu pilihan','confirmed',$2,'CI NEW VISITOR',30000)",[futureDate,order]);
  await run("INSERT INTO sport_center.sport_payments(id,booking_id,status,confirmed_at,amount,proof_url) VALUES (9423,9323,'confirmed',now(),30000,'ci://validated-proof')");
  // A stale historical review_required row must not block a physically suspended VIS004.
  await run("INSERT INTO sport_center.sport_bookings(id,booking_date,start_time,source,status) VALUES (9322,'2026-11-01','07:00','admin','completed')");
  await run("INSERT INTO sport_center.sport_payments(id,booking_id,status,confirmed_at) VALUES(9422,9322,'confirmed','2026-11-01T01:00:00Z')");
  await run("INSERT INTO sport_center.x904_nonmember_daily_access(device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,booking_id,payment_id,confirmed_at,expires_at,verification_state,access_state) VALUES ('TDBD234200545','card','VIS004','17',17,'VIS 004',9322,9422,'2026-11-01T01:00:00Z','2026-11-01T10:00:00Z','verified','review_required')");
  await addSnapshot(new Date(),'17','VIS 004',2);
  const request={orderNumber:order,officialBankReference:"ADMINPAY-9423",verifiedBy:"CI_ADMIN",officialFundsChecked:true,confirmedPaymentId:9423};
  const reserved=await autoReserveVisAfterFundsVerified(request);
  expect(reserved).toMatchObject({cardCode:"VIS004",state:"reserved",newReservation:true});
  expect((await run("SELECT access_state FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9322")).rows[0].access_state).toBe("expired");
  const grants=await run("SELECT access_state,verification_state,identity_label,user_pin,device_uid,booking_id,payment_id,expires_at FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9323");
  expect(grants.rows).toHaveLength(1);
  expect(grants.rows[0]).toMatchObject({access_state:"pending",verification_state:"verified",identity_label:"VIS004",user_pin:"17",device_uid:17,booking_id:9323,payment_id:9423});
  expect((await run("SELECT count(*)::int AS n FROM sport_center.x904_user_commands WHERE user_pin='17'")).rows[0].n).toBe(0);
  const repeat=await autoReserveVisAfterFundsVerified(request);
  expect(repeat).toMatchObject({cardCode:"VIS004",state:"reserved",newReservation:false});
  expect((await run("SELECT count(*)::int AS n FROM sport_center.gym_vis_card_reservations WHERE booking_id=9323")).rows[0].n).toBe(1);
  const collected=await collectReservedVisCard({orderNumber:order,physicalCardHandedOver:true,collectedBy:"CI_STAFF"});
  expect(collected).toMatchObject({cardCode:"VIS004",state:"collected"});
  const released=await run("SELECT verification_state FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9323");
  expect(released.rows[0].verification_state).toBe("verified");
  expect((await run("SELECT count(*)::int AS n FROM sport_center.x904_user_commands WHERE user_pin='17'")).rows[0].n).toBe(0);
  const replay=await collectReservedVisCard({orderNumber:order,physicalCardHandedOver:true,collectedBy:"CI_STAFF"});
  expect(replay.state).toBe("collected");
});


test("VIS concurrency and failure guards: no double allocation, cross-payment rejected, stale snapshot fails closed", async () => {
  const futureDate=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Jakarta",year:"numeric",month:"2-digit",day:"2-digit"})
    .format(new Date(Date.now()+3*86400000));
  const orderA="SC-CI-CONC-9330", orderB="SC-CI-CONC-9331";
  await run("INSERT INTO sport_center.sport_bookings(id,booking_date,start_time,source,notes,status,order_number,customer_name,total_price) VALUES (9330,$1,'07:00','gym_public_guest','Kartu VIS001–VIS006 menunggu pilihan','confirmed',$2,'CI CONC A',30000)",[futureDate,orderA]);
  await run("INSERT INTO sport_center.sport_bookings(id,booking_date,start_time,source,notes,status,order_number,customer_name,total_price) VALUES (9331,$1,'07:00','gym_public_guest','Kartu VIS001–VIS006 menunggu pilihan','confirmed',$2,'CI CONC B',30000)",[futureDate,orderB]);
  await run("INSERT INTO sport_center.sport_payments(id,booking_id,status,confirmed_at,amount,proof_url) VALUES (9430,9330,'confirmed',now(),30000,'ci://conc-a'),(9431,9331,'confirmed',now(),30000,'ci://conc-b')");
  const users=JSON.stringify([
    {pin:"90",name:"VIS 002",role:0,group:2,enabled:true},
    {pin:"15",name:"VIS 006",role:0,group:2,enabled:true},
  ]);
  await run("INSERT INTO sport_center.gym_x904_access_snapshots(device_serial,observed_at,user_count,users) VALUES('TDBD234200545',now(),2,$1::jsonb)",[users]);

  await expect(autoReserveVisAfterFundsVerified({
    orderNumber:orderA,officialBankReference:"ADMINPAY-9431",verifiedBy:"CI_ADMIN",
    officialFundsChecked:true,confirmedPaymentId:9431,
  })).rejects.toMatchObject({code:"payment_confirmation_changed"});

  const [a,b]=await Promise.all([
    autoReserveVisAfterFundsVerified({orderNumber:orderA,officialBankReference:"ADMINPAY-9430",verifiedBy:"CI_ADMIN",officialFundsChecked:true,confirmedPaymentId:9430}),
    autoReserveVisAfterFundsVerified({orderNumber:orderB,officialBankReference:"ADMINPAY-9431",verifiedBy:"CI_ADMIN",officialFundsChecked:true,confirmedPaymentId:9431}),
  ]);
  expect(new Set([a.cardCode,b.cardCode]).size).toBe(2);
  expect(new Set([a.cardCode,b.cardCode])).toEqual(new Set(["VIS002","VIS006"]));
  expect((await run("SELECT count(*)::int n FROM sport_center.gym_vis_card_reservations WHERE booking_id IN (9330,9331)")).rows[0].n).toBe(2);
  expect((await run("SELECT count(*)::int n FROM sport_center.x904_nonmember_daily_access WHERE booking_id IN (9330,9331)")).rows[0].n).toBe(2);

  const retry=await autoReserveVisAfterFundsVerified({
    orderNumber:orderA,officialBankReference:"ADMINPAY-9430",verifiedBy:"CI_ADMIN",
    officialFundsChecked:true,confirmedPaymentId:9430,
  });
  expect(retry).toMatchObject({cardCode:a.cardCode,newReservation:false});
  expect((await run("SELECT count(*)::int n FROM sport_center.gym_vis_card_reservations WHERE booking_id=9330")).rows[0].n).toBe(1);

  await collectReservedVisCard({orderNumber:orderA,physicalCardHandedOver:true,collectedBy:"CI_STAFF"});
  const pinA=a.cardCode==="VIS002"?"90":"15";
  expect((await run("SELECT count(*)::int n FROM sport_center.x904_user_commands WHERE user_pin=$1",[pinA])).rows[0].n).toBe(0);

  const orderC="SC-CI-STALE-9332";
  await run("INSERT INTO sport_center.sport_bookings(id,booking_date,start_time,source,notes,status,order_number,customer_name,total_price) VALUES (9332,$1,'07:00','gym_public_guest','Kartu VIS001–VIS006 menunggu pilihan','confirmed',$2,'CI STALE',30000)",[futureDate,orderC]);
  await run("INSERT INTO sport_center.sport_payments(id,booking_id,status,confirmed_at,amount,proof_url) VALUES (9432,9332,'confirmed',now(),30000,'ci://stale')");
  await run("INSERT INTO sport_center.gym_x904_access_snapshots(device_serial,observed_at,user_count,users) VALUES('TDBD234200545',now()-interval '6 minutes',2,$1::jsonb)",[users]);
  await expect(autoReserveVisAfterFundsVerified({
    orderNumber:orderC,officialBankReference:"ADMINPAY-9432",verifiedBy:"CI_ADMIN",
    officialFundsChecked:true,confirmedPaymentId:9432,
  })).rejects.toMatchObject({code:"vis_pool_exhausted"});
  expect((await run("SELECT count(*)::int n FROM sport_center.gym_vis_card_reservations WHERE booking_id=9332")).rows[0].n).toBe(0);
  expect((await run("SELECT count(*)::int n FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9332")).rows[0].n).toBe(0);

  const orderD="SC-CI-BUSY-9333";
  await run("INSERT INTO sport_center.sport_bookings(id,booking_date,start_time,source,notes,status,order_number,customer_name,total_price) VALUES (9333,$1,'07:00','gym_public_guest','Kartu VIS001–VIS006 menunggu pilihan','confirmed',$2,'CI BUSY',30000)",[futureDate,orderD]);
  await run("INSERT INTO sport_center.sport_payments(id,booking_id,status,confirmed_at,amount,proof_url) VALUES (9433,9333,'confirmed',now(),30000,'ci://busy')");
  await run("INSERT INTO sport_center.gym_x904_access_snapshots(device_serial,observed_at,user_count,users) VALUES('TDBD234200545',now(),2,$1::jsonb)",[users]);
  await expect(autoReserveVisAfterFundsVerified({
    orderNumber:orderD,officialBankReference:"ADMINPAY-9433",verifiedBy:"CI_ADMIN",
    officialFundsChecked:true,confirmedPaymentId:9433,
  })).rejects.toMatchObject({code:"vis_pool_exhausted"});
  expect((await run("SELECT status FROM sport_center.sport_bookings WHERE id=9333")).rows[0].status).toBe("confirmed");
  expect((await run("SELECT count(*)::int n FROM sport_center.gym_vis_card_reservations WHERE booking_id=9333")).rows[0].n).toBe(0);
  expect((await run("SELECT count(*)::int n FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9333")).rows[0].n).toBe(0);
});

test("public PIN review gate: checkout and confirmed payment alone never activate; staff approval permits verified ACK", async () => {
  // Mirror the current production payment trigger on disposable PostgreSQL.
  // The historical base migration did not distinguish guest PINs; production does.
  await run(`CREATE OR REPLACE FUNCTION sport_center.link_x904_nonmember_daily_payment()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO sport_center, pg_temp AS $fn$
    DECLARE changed boolean := TG_OP = 'INSERT'; is_guest boolean;
    BEGIN
      IF TG_OP = 'UPDATE' THEN changed := OLD.status::text IS DISTINCT FROM NEW.status::text; END IF;
      IF NEW.status::text = 'confirmed' AND changed THEN
        SELECT EXISTS(SELECT 1 FROM sport_center.sport_bookings b
          JOIN sport_center.x904_nonmember_daily_access a ON a.booking_id=b.id
          WHERE b.id=NEW.booking_id AND b.source='gym_public_guest' AND a.identity_type='pin')
          INTO is_guest;
        UPDATE sport_center.x904_nonmember_daily_access a
           SET payment_id=NEW.id,
               confirmed_at=COALESCE(NEW.confirmed_at,NEW.paid_at,now()),
               expires_at=COALESCE(NEW.confirmed_at,NEW.paid_at,now()) + interval '12 hours',
               access_state=CASE WHEN is_guest THEN 'review_required' ELSE 'pending' END,
               verification_state=CASE WHEN is_guest THEN 'review_required' ELSE 'verified' END
         WHERE a.booking_id=NEW.booking_id AND a.payment_id IS NULL;
      ELSIF NEW.status::text IN ('cancelled','rejected','refunded') AND changed THEN
        UPDATE sport_center.x904_nonmember_daily_access
          SET access_state=CASE WHEN access_state IN ('active','expired') THEN 'pending' ELSE access_state END
          WHERE payment_id=NEW.id;
      END IF;
      RETURN NEW;
    END; $fn$`);
  const pin="605", uid=605, name="CI PUBLIC PIN REVIEW", bookingId=9605, paymentId=9705;
  const t=new Date("2026-11-06T01:00:00Z");
  process.env.GYM_X904_NONMEMBER_ONLY_PIN=pin;
  try {
    await run("INSERT INTO sport_center.gym_x904_lan_users VALUES('TDBD234200545',$1,$2,$3,0)",[pin,uid,name]);
    await run(`INSERT INTO sport_center.x904_verified_nonmember_identities
      (device_serial,user_pin,device_uid,display_name,verification_state,verified_by,verified_at)
      VALUES('TDBD234200545',$1,$2,$3,'verified','ci-operator',now())`,[pin,uid,name]);
    // Same initial identity/access states as the anonymous POST /wa/booking route.
    await run(`INSERT INTO sport_center.sport_bookings
      (id,booking_date,start_time,source,notes,status,order_number,customer_name,total_price)
      VALUES($1,'2026-11-06','08:00','gym_public_guest','review_required PIN',
      'pending_payment','SC-CI-PIN-9605',$2,30000)`,[bookingId,name]);
    await run(`INSERT INTO sport_center.x904_nonmember_daily_access
      (device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,
      booking_id,verification_state,access_state)
      VALUES('TDBD234200545','pin','PIN VERIFIED',$1,$2,$3,$4,
      'review_required','review_required')`,[pin,uid,name,bookingId]);
    const accessId=Number((await run("SELECT access_id FROM sport_center.x904_nonmember_daily_access WHERE booking_id=$1",[bookingId])).rows[0].access_id);
    await run("INSERT INTO sport_center.sport_payments(id,booking_id,status) VALUES($1,$2,'pending')",[paymentId,bookingId]);
    await addSnapshot(new Date(t.getTime()-1000),pin,name,2);
    await processX904NonmemberDailyAccess(db as any,t);
    expect(await commandFor("ACTIVATE_USER",accessId)).toBeUndefined();

    await run("UPDATE sport_center.sport_bookings SET status='confirmed' WHERE id=$1",[bookingId]);
    await run("UPDATE sport_center.sport_payments SET status='confirmed',confirmed_at=$2 WHERE id=$1",[paymentId,t]);
    const beforeReview=(await run("SELECT payment_id,verification_state,access_state FROM sport_center.x904_nonmember_daily_access WHERE access_id=$1",[accessId])).rows[0];
    expect(beforeReview).toMatchObject({payment_id:paymentId,verification_state:"review_required",access_state:"review_required"});
    await addSnapshot(new Date(t.getTime()+1000),pin,name,2);
    await processX904NonmemberDailyAccess(db as any,new Date(t.getTime()+2000));
    expect(await commandFor("ACTIVATE_USER",accessId)).toBeUndefined();

    // Simulate an authenticated staff identity check; a bank approval alone cannot do this.
    await run(`UPDATE sport_center.x904_nonmember_daily_access
      SET verification_state='verified',access_state='pending'
      WHERE access_id=$1 AND payment_id=$2`,[accessId,paymentId]);
    await addSnapshot(new Date(t.getTime()+3000),pin,name,2);
    await processX904NonmemberDailyAccess(db as any,new Date(t.getTime()+4000));
    const activate=await commandFor("ACTIVATE_USER",accessId);
    expect(activate?.payload).toMatchObject({expectedUid:uid,source:"AUTO_NONMEMBER_GYM_12H",accessId});
    const ackAt=new Date(t.getTime()+5500);
    await ack(String(activate.command_id),ackAt,pin,name,uid,1);
    await processX904NonmemberDailyAccess(db as any,new Date(t.getTime()+8000));
    const activated=(await run("SELECT access_state,activated_at,expires_at FROM sport_center.x904_nonmember_daily_access WHERE access_id=$1",[accessId])).rows[0];
    expect(activated.access_state).toBe("active");
    expect(new Date(activated.activated_at).getTime()).toBe(ackAt.getTime());
    expect(new Date(activated.expires_at).getTime()-ackAt.getTime()).toBe(12*60*60*1000);

    // End-to-end completion for the anonymous-booking identity review path:
    // expiry must suspend through the same worker, with a matching X904 ACK,
    // never by writing a group or changing the real machine directly.
    const expiryAt = new Date(new Date(activated.expires_at).getTime() + 3000);
    await addSnapshot(new Date(expiryAt.getTime() - 1000), pin, name, 1);
    await processX904NonmemberDailyAccess(db as any, expiryAt);
    const suspension = await commandFor("SUSPEND_USER", accessId);
    expect(suspension?.payload).toMatchObject({
      source: "AUTO_NONMEMBER_GYM_12H", accessId, expectedUid: uid,
    });
    const suspendAckAt = new Date(expiryAt.getTime() + 1000);
    await ack(String(suspension.command_id), suspendAckAt, pin, name, uid, 2);
    await processX904NonmemberDailyAccess(db as any, new Date(suspendAckAt.getTime() + 3000));
    const expiredGrant = (await run(
      "SELECT access_state,activated_at FROM sport_center.x904_nonmember_daily_access WHERE access_id=$1",
      [accessId],
    )).rows[0];
    expect(expiredGrant.access_state).toBe("expired");
    expect(new Date(expiredGrant.activated_at).getTime()).toBe(ackAt.getTime());
    const commandsBeforeRetry = Number((await run(
      "SELECT count(*)::int AS n FROM sport_center.x904_user_commands WHERE payload->>'accessId'=$1",
      [String(accessId)],
    )).rows[0].n);
    expect(commandsBeforeRetry).toBe(2);
    await addSnapshot(new Date(suspendAckAt.getTime() + 4000), pin, name, 2);
    await processX904NonmemberDailyAccess(db as any, new Date(suspendAckAt.getTime() + 5000));
    expect(Number((await run(
      "SELECT count(*)::int AS n FROM sport_center.x904_user_commands WHERE payload->>'accessId'=$1",
      [String(accessId)],
    )).rows[0].n)).toBe(commandsBeforeRetry);
  } finally {
    delete process.env.GYM_X904_NONMEMBER_ONLY_PIN;
  }
});

test("late Gym arrival: booked 20:59, activate 22:40 after session, suspend at 23:00", async () => {
  // Disposable PostgreSQL only. Never use a live PIN, booking, payment or X904.
  const pin = "607", uid = 607, name = "CI CLOSING PIN";
  const bookingId = 9607, paymentId = 9707;
  const paidAt = new Date("2026-11-06T15:40:00Z"); // 22:40 WIB
  process.env.GYM_X904_NONMEMBER_ONLY_PIN = pin;
  try {
    await run("INSERT INTO sport_center.gym_x904_lan_users VALUES('TDBD234200545',$1,$2,$3,0)", [pin, uid, name]);
    await run(`INSERT INTO sport_center.x904_verified_nonmember_identities
      (device_serial,user_pin,device_uid,display_name,verification_state,verified_by,verified_at)
      VALUES('TDBD234200545',$1,$2,$3,'verified','ci-operator',now())`, [pin,uid,name]);
    await run(`INSERT INTO sport_center.sport_bookings
      (id,booking_date,start_time,source,notes,status,order_number,customer_name,total_price)
      VALUES($1,'2026-11-06','20:59','gym_public_guest',
        'Registered PIN booked without login; staff review required',
        'pending_payment','SC-CI-CLOSING-PIN-9607',$2,30000)`, [bookingId,name]);
    await run(`INSERT INTO sport_center.x904_nonmember_daily_access
      (device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,
       booking_id,verification_state,access_state)
      VALUES('TDBD234200545','pin','PIN VERIFIED',$1,$2,$3,$4,
        'review_required','review_required')`, [pin,uid,name,bookingId]);
    await run("INSERT INTO sport_center.sport_payments(id,booking_id,status) VALUES($1,$2,'pending')", [paymentId,bookingId]);
    const accessId = Number((await run(
      "SELECT access_id FROM sport_center.x904_nonmember_daily_access WHERE booking_id=$1",[bookingId],
    )).rows[0].access_id);

    await addSnapshot(new Date(paidAt.getTime()-1000),pin,name,2);
    await processX904NonmemberDailyAccess(db as any,paidAt);
    expect(await commandFor("ACTIVATE_USER",accessId)).toBeUndefined();
    await run("UPDATE sport_center.sport_bookings SET status='confirmed' WHERE id=$1",[bookingId]);
    await run("UPDATE sport_center.sport_payments SET status='confirmed',confirmed_at=$2 WHERE id=$1",[paymentId,paidAt]);
    await processX904NonmemberDailyAccess(db as any,new Date(paidAt.getTime()+1000));
    expect(await commandFor("ACTIVATE_USER",accessId)).toBeUndefined();

    // Operator-attested PIN and funds are separately approved after payment.
    await run(`UPDATE sport_center.x904_nonmember_daily_access
      SET verification_state='verified',access_state='pending'
      WHERE access_id=$1 AND payment_id=$2`,[accessId,paymentId]);
    await addSnapshot(new Date(paidAt.getTime()+2000),pin,name,2);
    await processX904NonmemberDailyAccess(db as any,new Date(paidAt.getTime()+3000));
    const activate = await commandFor("ACTIVATE_USER",accessId);
    expect(activate?.payload).toMatchObject({source:"AUTO_NONMEMBER_GYM_12H",expectedUid:uid,accessId});
    const activationAckAt = new Date("2026-11-06T15:45:00Z"); // 22:45 WIB
    await ack(String(activate.command_id),activationAckAt,pin,name,uid,1);
    await processX904NonmemberDailyAccess(db as any,new Date(activationAckAt.getTime()+2000));
    const active = (await run(
      "SELECT access_state,activated_at,expires_at FROM sport_center.x904_nonmember_daily_access WHERE access_id=$1",
      [accessId],
    )).rows[0];
    expect(active.access_state).toBe("active");
    expect(new Date(active.activated_at).getTime()).toBe(activationAckAt.getTime());
    expect(new Date(active.expires_at).toISOString()).toBe("2026-11-06T16:00:00.000Z");

    // At 22:59 the grant is still live, without premature SUSPEND_USER.
    const beforeClose = new Date("2026-11-06T15:59:00Z");
    await addSnapshot(new Date(beforeClose.getTime()-1000),pin,name,1);
    await processX904NonmemberDailyAccess(db as any,beforeClose);
    expect(await commandFor("SUSPEND_USER",accessId)).toBeUndefined();

    // After 23:00, the real worker must queue the suspend (never a manual command).
    const afterClose = new Date("2026-11-06T16:00:03Z");
    await addSnapshot(new Date(afterClose.getTime()-1000),pin,name,1);
    await processX904NonmemberDailyAccess(db as any,afterClose);
    const suspend = await commandFor("SUSPEND_USER",accessId);
    expect(suspend?.payload).toMatchObject({source:"AUTO_NONMEMBER_GYM_12H",expectedUid:uid,accessId});
    const suspendAckAt = new Date(afterClose.getTime()+1000);
    await ack(String(suspend.command_id),suspendAckAt,pin,name,uid,2);
    await processX904NonmemberDailyAccess(db as any,new Date(suspendAckAt.getTime()+2000));
    expect((await run(
      "SELECT access_state FROM sport_center.x904_nonmember_daily_access WHERE access_id=$1",
      [accessId],
    )).rows[0].access_state).toBe("expired");

    // A past-day booking must neither reopen nor enqueue duplicate suspend commands.
    const tomorrow = new Date("2026-11-07T01:00:00Z"); // 08:00 next day WIB
    await addSnapshot(new Date(tomorrow.getTime()-1000),pin,name,2);
    await processX904NonmemberDailyAccess(db as any,tomorrow);
    expect(Number((await run(
      "SELECT count(*)::int n FROM sport_center.x904_user_commands WHERE payload->>'accessId'=$1",
      [String(accessId)],
    )).rows[0].n)).toBe(2);
  } finally {
    delete process.env.GYM_X904_NONMEMBER_ONLY_PIN;
  }
});

test("registered PIN checkout row lock works under production-like RLS, registry writes remain denied", async () => {
  // Mimics PROD sport_center_app precisely, including SELECT-only RLS followed
  // by SELECT ... FOR SHARE in POST /api/wa/booking. Disposable PostgreSQL only.
  const pin = "608", uid = 608, name = "CI RLS PIN";
  await run("INSERT INTO sport_center.gym_x904_lan_users VALUES('TDBD234200545',$1,$2,$3,0)",[pin,uid,name]);
  await run(`INSERT INTO sport_center.x904_verified_nonmember_identities
    (device_serial,user_pin,device_uid,display_name,verification_state,verified_by,verified_at)
    VALUES('TDBD234200545',$1,$2,$3,'verified','ci-operator',now())`,[pin,uid,name]);
  await run("CREATE ROLE sport_center_app");
  await run("GRANT USAGE ON SCHEMA sport_center TO sport_center_app");
  await run("GRANT SELECT,UPDATE ON sport_center.x904_verified_nonmember_identities TO sport_center_app");
  await run(`CREATE POLICY gym_nonmember_registry_backend_read
    ON sport_center.x904_verified_nonmember_identities
    FOR SELECT TO sport_center_app USING (true)`);

  const readSql = `SELECT 1 FROM sport_center.x904_verified_nonmember_identities
    WHERE device_serial='TDBD234200545' AND user_pin=$1 AND device_uid=$2
      AND upper(regexp_replace(trim(display_name),'[[:space:]]+',' ','g'))=
          upper(regexp_replace(trim($3::text),'[[:space:]]+',' ','g'))
      AND verification_state='verified' AND revoked_at IS NULL`;
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE sport_center_app");
    expect((await c.query(readSql,[pin,uid,name])).rowCount).toBe(1);
    // The original production regression: visible in plain SELECT but not
    // visible under FOR SHARE because UPDATE RLS policy is absent.
    expect((await c.query(readSql+" FOR SHARE",[pin,uid,name])).rowCount).toBe(0);
    await c.query("ROLLBACK");
  } finally { c.release(); }

  await run(readFileSync("migrations/20261109_x904_verified_registry_for_share_rls.sql","utf8"));
  const app = await pool.connect();
  try {
    await app.query("BEGIN");
    await app.query("SET LOCAL ROLE sport_center_app");
    expect((await app.query(readSql+" FOR SHARE",[pin,uid,name])).rowCount).toBe(1);
    await app.query("ROLLBACK");
    await app.query("BEGIN");
    await app.query("SET LOCAL ROLE sport_center_app");
    await expect(app.query(
      "UPDATE sport_center.x904_verified_nonmember_identities SET display_name='FORGED' WHERE user_pin=$1",
      [pin],
    )).rejects.toThrow(/row-level security policy/i);
    await app.query("ROLLBACK");
  } finally { app.release(); }
  expect((await run("SELECT display_name FROM sport_center.x904_verified_nonmember_identities WHERE user_pin=$1",[pin])).rows[0].display_name).toBe(name);
});

test("production-style RLS accepts only held public registered PIN grant, never active or unauthorized", async () => {
  // RLS integration test uses an isolated localhost PostgreSQL role, not PROD.
  // The earlier registry lock test creates sport_center_app and registry policies.
  const pin = "609", uid = 609, name = "CI PUBLIC REVIEW RLS", bookingId = 9609;
  await run("INSERT INTO sport_center.gym_x904_lan_users VALUES('TDBD234200545',$1,$2,$3,0)",[pin,uid,name]);
  await run(`INSERT INTO sport_center.x904_verified_nonmember_identities
    (device_serial,user_pin,device_uid,display_name,verification_state,verified_by,verified_at)
    VALUES('TDBD234200545',$1,$2,$3,'verified','ci-operator',now())`,[pin,uid,name]);
  await run(`INSERT INTO sport_center.sport_bookings
    (id,booking_date,start_time,source,notes,status,order_number,customer_name,total_price)
    VALUES ($1,'2026-11-09','15:00','gym_public_guest','test','pending_payment','SC-CI-RLS-9609',$2,30000)`,[bookingId,name]);
  await run("GRANT SELECT ON sport_center.sport_bookings, sport_center.gym_x904_member_mapping TO sport_center_app");
  await run("GRANT SELECT, INSERT ON sport_center.x904_nonmember_daily_access TO sport_center_app");
  await run("ALTER TABLE sport_center.x904_nonmember_daily_access ENABLE ROW LEVEL SECURITY");
  // Reproduce the actual restrictive production rule: ordinary backend inserts
  // can create verified pending grants, but not review_required anonymous grants.
  await run(`CREATE POLICY x904_nonmember_app_insert ON sport_center.x904_nonmember_daily_access
    FOR INSERT TO sport_center_app
    WITH CHECK (device_serial='TDBD234200545' AND access_state='pending'
                AND activated_at IS NULL AND verification_state='verified'
                AND payment_id IS NULL AND confirmed_at IS NULL AND expires_at IS NULL)`);

  const insertSql = `INSERT INTO sport_center.x904_nonmember_daily_access
    (device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,
      booking_id,verification_state,access_state)
    VALUES('TDBD234200545','pin','PIN:'||$1,$1,$2,$3,$4,'review_required','review_required')`;
  const conn = await pool.connect();
  const attempt = async (actualUid: number, actualPin = pin) => {
    await conn.query("BEGIN");
    await conn.query("SET LOCAL ROLE sport_center_app");
    try {
      await conn.query(insertSql,[actualPin,actualUid,name,bookingId]);
      await conn.query("ROLLBACK");
      return "allowed";
    } catch (err) {
      await conn.query("ROLLBACK");
      return String((err as { code?: string }).code ?? "error");
    }
  };
  try {
    expect(await attempt(uid)).toBe("42501"); // pre-fix RLS denial
    await run(readFileSync("migrations/20261109_x904_public_pin_review_insert_rls.sql","utf8"));
    expect(await attempt(uid)).toBe("allowed");
    expect(await attempt(uid+1)).toBe("42501"); // cannot forge X904 UID
    expect(await attempt(uid,"237")).toBe("42501"); // special PIN excluded
    expect((await run("SELECT count(*)::int n FROM sport_center.x904_nonmember_daily_access WHERE booking_id=$1",[bookingId])).rows[0].n).toBe(0);
  } finally { conn.release(); }
});

test("single-checkout DB transaction commits held PIN and receipt together, or rolls both back", async () => {
  // Real disposable PostgreSQL with actual PIN registry RLS and protected grant
  // policy. No machine, external payment, PROD DB, or fake verified funds.
  const pin="610",uid=610,name="CI ATOMIC GYM CHECKOUT";
  await run("INSERT INTO sport_center.gym_x904_lan_users VALUES('TDBD234200545',$1,$2,$3,0)",[pin,uid,name]);
  await run(`INSERT INTO sport_center.x904_verified_nonmember_identities
    (device_serial,user_pin,device_uid,display_name,verification_state,verified_by,verified_at)
    VALUES('TDBD234200545',$1,$2,$3,'verified','ci-operator',now())`,[pin,uid,name]);
  await run("GRANT SELECT,INSERT,UPDATE ON sport_center.sport_bookings TO sport_center_app");
  await run("GRANT SELECT,INSERT ON sport_center.sport_payments TO sport_center_app");
  const create = async (bookingId:number,paymentId:number) => {
    const client=await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE sport_center_app");
      await client.query(`INSERT INTO sport_center.sport_bookings
        (id,booking_date,start_time,source,notes,status,order_number,customer_name,total_price)
        VALUES($1,'2026-11-09','16:12','gym_public_guest','single multipart proof',
          'pending_payment',$2,$3,30000)`,[bookingId,`SC-CI-ATOMIC-${bookingId}`,name]);
      await client.query(`INSERT INTO sport_center.x904_nonmember_daily_access
        (device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,
          booking_id,verification_state,access_state)
        VALUES('TDBD234200545','pin','PIN:'||$1,$1,$2,$3,$4,'review_required','review_required')`,
        [pin,uid,name,bookingId]);
      await client.query(`INSERT INTO sport_center.sport_payments
        (id,booking_id,status,amount,proof_url)
        VALUES($1,$2,'pending',30000,'ci://durable-proof-receipt')`,[paymentId,bookingId]);
      await client.query("UPDATE sport_center.sport_bookings SET status='waiting_confirmation' WHERE id=$1",[bookingId]);
      await client.query("COMMIT");
      return "committed";
    } catch(err) {
      await client.query("ROLLBACK");
      return String((err as {code?:string}).code ?? "error");
    } finally {client.release();}
  };
  expect(await create(9610,9710)).toBe("committed");
  expect((await run("SELECT status FROM sport_center.sport_bookings WHERE id=9610")).rows[0].status).toBe("waiting_confirmation");
  expect((await run("SELECT status,proof_url FROM sport_center.sport_payments WHERE booking_id=9610")).rows[0])
    .toMatchObject({status:"pending",proof_url:"ci://durable-proof-receipt"});
  expect((await run("SELECT verification_state,access_state,payment_id FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9610")).rows[0])
    .toMatchObject({verification_state:"review_required",access_state:"review_required",payment_id:null});
  const grantId=Number((await run("SELECT access_id FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9610")).rows[0].access_id);
  expect(await commandFor("ACTIVATE_USER",grantId)).toBeUndefined();
  // A late payment INSERT error must roll back booking and grant too.
  expect(await create(9611,9710)).toBe("23505");
  expect((await run("SELECT count(*)::int n FROM sport_center.sport_bookings WHERE id=9611")).rows[0].n).toBe(0);
  expect((await run("SELECT count(*)::int n FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9611")).rows[0].n).toBe(0);
  expect((await run("SELECT count(*)::int n FROM sport_center.sport_payments WHERE booking_id=9611")).rows[0].n).toBe(0);
});

test("HTTP staff PIN approval: rejects anonymous and unverified funds, then releases a real isolated grant", async () => {
  // This invokes the real Express bookings router, not a copied approval function.
  // All writes are scoped to disposable 127.0.0.1 PostgreSQL. No external X904 device.
  process.env.SESSION_SECRET ||= "ci-isolated-x904-pin-http-test-secret";
  const { default: express } = await import("express");
  const { default: supertest } = await import("supertest");
  const { default: bookingsRouter } = await import("../routes/bookings.js");
  const { default: whatsappRouter } = await import("../routes/whatsapp.js");
  const { createToken } = await import("../lib/auth.js");
  const app = express();
  app.use(express.json());
  app.use("/api", bookingsRouter);
  app.use("/api", whatsappRouter);
  const request = supertest(app);
  const id=9606, pay=9706, pin="606", uid=606, name="CI HTTP PIN STAFF";
  const dateParts=new Intl.DateTimeFormat("en-CA",{
    timeZone:"Asia/Jakarta",year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(new Date());
  const wd=Object.fromEntries(dateParts.map(p=>[p.type,p.value]));
  const today=`${wd.year}-${wd.month}-${wd.day}`;
  const hour=Number(new Intl.DateTimeFormat("en-GB",{
    timeZone:"Asia/Jakarta",hour:"2-digit",hourCycle:"h23"
  }).format(new Date()));
  const endpoint=`/api/bookings/${id}/x904-guest-pin-approve`;
  // Real public booking HTTP route: reject incomplete checkout before any DB write.
  const incomplete=await request.post("/api/wa/booking").send({publicGymGuest:true});
  expect(incomplete.status).toBe(400);
  expect(incomplete.body).toHaveProperty("error");

  process.env.GYM_X904_NONMEMBER_ONLY_PIN=pin;
  try {
    await run("INSERT INTO sport_center.gym_x904_lan_users VALUES('TDBD234200545',$1,$2,$3,0)",[pin,uid,name]);
    await run(`INSERT INTO sport_center.x904_verified_nonmember_identities
      (device_serial,user_pin,device_uid,display_name,verification_state,verified_by,verified_at)
      VALUES('TDBD234200545',$1,$2,$3,'verified','ci-operator',now())`,[pin,uid,name]);
    await run(`INSERT INTO sport_center.sport_bookings
      (id,booking_date,start_time,source,notes,status,order_number,customer_name,total_price)
      VALUES($1,$2,'08:00','gym_public_guest','review_required PIN',
      'confirmed','SC-CI-HTTP-PIN-9606',$3,30000)`,[id,today,name]);
    await run(`INSERT INTO sport_center.x904_nonmember_daily_access
      (device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,
       booking_id,verification_state,access_state)
      VALUES('TDBD234200545','pin','PIN VERIFIED',$1,$2,$3,$4,
       'review_required','review_required')`,[pin,uid,name,id]);
    await run("INSERT INTO sport_center.sport_payments(id,booking_id,status,confirmed_at,amount,proof_url) VALUES($1,$2,'confirmed',now(),30000,'ci://validated-proof')",[pay,id]);
    const accessId=Number((await run("SELECT access_id FROM sport_center.x904_nonmember_daily_access WHERE booking_id=$1",[id])).rows[0].access_id);
    const before=(await run("SELECT verification_state,access_state FROM sport_center.x904_nonmember_daily_access WHERE access_id=$1",[accessId])).rows[0];
    expect(before).toMatchObject({verification_state:"review_required",access_state:"review_required"});

    const anonymous=await request.post(endpoint).send({identityChecked:true,officialFundsChecked:true,officialBankReference:"CI-BANK-9706"});
    expect(anonymous.status).toBe(401);
    const token=createToken(302,"staff");
    const invalid=await request.post(endpoint).set("Authorization",`Bearer ${token}`)
      .send({identityChecked:true,officialFundsChecked:false,officialBankReference:"CI-BANK-9706"});
    expect(invalid.status).toBe(400);
    const afterRejected=(await run("SELECT verification_state,access_state FROM sport_center.x904_nonmember_daily_access WHERE access_id=$1",[accessId])).rows[0];
    expect(afterRejected).toMatchObject({verification_state:"review_required",access_state:"review_required"});

    if (hour>=6 && hour<23) {
      const approved=await request.post(endpoint).set("Authorization",`Bearer ${token}`)
        .send({identityChecked:true,officialFundsChecked:true,officialBankReference:"CI-BANK-9706"});
      expect(approved.status).toBe(200);
      expect(approved.body).toMatchObject({success:true,accessState:"pending"});
      const grant=(await run("SELECT verification_state,access_state FROM sport_center.x904_nonmember_daily_access WHERE access_id=$1",[accessId])).rows[0];
      expect(grant).toMatchObject({verification_state:"verified",access_state:"pending"});
      // HTTP approval must not directly enqueue a command. Worker alone does so.
      expect(await commandFor("ACTIVATE_USER",accessId)).toBeUndefined();
    } else {
      const outsideHours=await request.post(endpoint).set("Authorization",`Bearer ${token}`)
        .send({identityChecked:true,officialFundsChecked:true,officialBankReference:"CI-BANK-9706"});
      expect(outsideHours.status).toBe(409);
      expect((await run("SELECT access_state FROM sport_center.x904_nonmember_daily_access WHERE access_id=$1",[accessId])).rows[0].access_state).toBe("review_required");
    }
  } finally { delete process.env.GYM_X904_NONMEMBER_ONLY_PIN; }
});


test("new on-device role-0 PIN alone queues one initial suspend; role 4/14 and historical pins untouched", async () => {
  // Isolate snapshot history from earlier scenarios with later simulated timestamps.
  await run("DELETE FROM sport_center.gym_x904_access_snapshots");
  // Isolated local PostgreSQL; never send machine commands to a real X904.
  // Previous scenarios may insert simulated snapshots after this clock.
  // Reset only the future slice of the disposable fixture, preserving the
  // historical observations used to detect reused PINs.
  await run("DELETE FROM sport_center.gym_x904_access_snapshots WHERE observed_at >= '2026-11-08T23:59:00Z'");
  process.env.GYM_X904_NEW_USER_DEFAULT_SUSPEND_ENABLED = "true";
  process.env.GYM_X904_NEW_USER_BASELINE_AT = "2026-11-08T23:59:00.000Z";
  // First sighting at 00:01; worker only processes at 00:03, after a new
  // snapshot replaced the immediately preceding snapshot.
  const at = new Date("2026-11-09T00:03:00.000Z");
  try {
    await run(`INSERT INTO sport_center.gym_x904_lan_users(device_serial,user_pin,device_uid,display_name,device_role)
      VALUES ('TDBD234200545','650',650,'NEW ROLE ZERO',0),
             ('TDBD234200545','651',651,'NEW ROLE FOUR',4),
             ('TDBD234200545','652',652,'NEW ROLE FOURTEEN',14),
             ('TDBD234200545','653',653,'OLDER USER',0)`);
    await run(`INSERT INTO sport_center.gym_x904_access_snapshots
      (device_serial,observed_at,user_count,users)
      VALUES ('TDBD234200545','2026-11-09T00:00:00Z',1,
        '[{"pin":"653","name":"OLDER USER","role":0,"group":1,"enabled":true}]'::jsonb)`);
    await run(`INSERT INTO sport_center.gym_x904_access_snapshots
      (device_serial,observed_at,user_count,users)
      VALUES ('TDBD234200545','2026-11-09T00:01:00Z',4,
        '[{"pin":"653","name":"OLDER USER","role":0,"group":1,"enabled":true},
          {"pin":"650","name":"NEW ROLE ZERO","role":0,"group":1,"enabled":true},
          {"pin":"651","name":"NEW ROLE FOUR","role":4,"group":1,"enabled":true},
          {"pin":"652","name":"NEW ROLE FOURTEEN","role":14,"group":1,"enabled":true}]'::jsonb)`);
    await run(`INSERT INTO sport_center.gym_x904_access_snapshots
      (device_serial,observed_at,user_count,users)
      SELECT 'TDBD234200545','2026-11-09T00:02:00Z',user_count,users
      FROM sport_center.gym_x904_access_snapshots
      WHERE device_serial='TDBD234200545' ORDER BY snapshot_id DESC LIMIT 1`);
    await processX904NewOrdinaryUserDefaultSuspend(db as any, at);
    await processX904NewOrdinaryUserDefaultSuspend(db as any, at);
    const cmds = (await run(`SELECT user_pin,command_type,payload,state
      FROM sport_center.x904_user_commands
      WHERE payload->>'source'='AUTO_NEW_ORDINARY_USER_DEFAULT_SUSPEND'`)).rows;
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toMatchObject({
      user_pin:"650",command_type:"SUSPEND_USER",state:"queued",
      payload:{expectedUid:650,expectedName:"NEW ROLE ZERO",expectedRole:0,
        firstObservedAt:"2026-11-09T00:01:00.000Z",
        suspendDeadlineAt:"2026-11-09T00:31:00.000Z"}
    });
    // No automatic commands for 651 role4, 652 role14 or existing 653.
    expect(cmds.some((c:any) => ["651","652","653"].includes(c.user_pin))).toBe(false);
  } finally {
    delete process.env.GYM_X904_NEW_USER_DEFAULT_SUSPEND_ENABLED;
    delete process.env.GYM_X904_NEW_USER_BASELINE_AT;
  }
});


test("unrestricted role-0 rollout handles two fresh PINs and protects special, mapped, registered and reused PINs", async () => {
  process.env.GYM_X904_NEW_USER_DEFAULT_SUSPEND_ENABLED="true";
  process.env.GYM_X904_NEW_USER_BASELINE_AT="2026-11-08T23:59:00.000Z";
  delete process.env.GYM_X904_NEW_USER_ONLY_PIN;
  try {
    await run(`INSERT INTO sport_center.gym_x904_lan_users(device_serial,user_pin,device_uid,display_name,device_role)
      VALUES ('TDBD234200545','660',660,'NEW MULTI SPACE',0),
             ('TDBD234200545','661',661,'SECOND ORDINARY',0),
             ('TDBD234200545','662',662,'NEW SPECIAL FOUR',4),
             ('TDBD234200545','663',663,'NEW SPECIAL ADMIN',14),
             ('TDBD234200545','664',664,'NEW MAPPED MEMBER',0),
             ('TDBD234200545','665',665,'NEW REGISTERED',0),
             ('TDBD234200545','668',668,'REUSED HISTORICAL',0)`);
    await run("INSERT INTO sport_center.gym_x904_member_mapping(membership_id,user_pin,device_serial) VALUES(9664,'664','TDBD234200545')");
    await run(`INSERT INTO sport_center.x904_verified_nonmember_identities
      (device_serial,user_pin,device_uid,display_name,verification_state,verified_by,verified_at)
      VALUES ('TDBD234200545','665',665,'NEW REGISTERED','verified','ci',now())`);
    await run(`INSERT INTO sport_center.gym_x904_access_snapshots(device_serial,observed_at,user_count,users)
      SELECT 'TDBD234200545','2026-11-09T00:03:00Z',user_count+1,
        users || '[{"pin":"668","name":"REUSED HISTORICAL","role":0,"group":1,"enabled":true}]'::jsonb
      FROM sport_center.gym_x904_access_snapshots
      WHERE device_serial='TDBD234200545' ORDER BY snapshot_id DESC LIMIT 1`);
    await run(`INSERT INTO sport_center.gym_x904_access_snapshots(device_serial,observed_at,user_count,users)
      SELECT 'TDBD234200545','2026-11-09T00:04:00Z',user_count-1,
        (SELECT jsonb_agg(item) FROM jsonb_array_elements(users) item WHERE item->>'pin'<>'668')
      FROM sport_center.gym_x904_access_snapshots
      WHERE device_serial='TDBD234200545' ORDER BY snapshot_id DESC LIMIT 1`);
    await run(`INSERT INTO sport_center.gym_x904_access_snapshots(device_serial,observed_at,user_count,users)
      SELECT 'TDBD234200545','2026-11-09T00:05:00Z',user_count+7,
        users || '[
          {"pin":"660","name":"NEW MULTI SPACE","role":0,"group":1,"enabled":true},
          {"pin":"661","name":"SECOND ORDINARY","role":0,"group":1,"enabled":true},
          {"pin":"662","name":"NEW SPECIAL FOUR","role":4,"group":1,"enabled":true},
          {"pin":"663","name":"NEW SPECIAL ADMIN","role":14,"group":1,"enabled":true},
          {"pin":"664","name":"NEW MAPPED MEMBER","role":0,"group":1,"enabled":true},
          {"pin":"665","name":"NEW REGISTERED","role":0,"group":1,"enabled":true},
          {"pin":"668","name":"REUSED HISTORICAL","role":0,"group":1,"enabled":true}
        ]'::jsonb
      FROM sport_center.gym_x904_access_snapshots
      WHERE device_serial='TDBD234200545' ORDER BY snapshot_id DESC LIMIT 1`);
    const at=new Date("2026-11-09T00:06:00.000Z");
    await processX904NewOrdinaryUserDefaultSuspend(db as any,at);
    await processX904NewOrdinaryUserDefaultSuspend(db as any,at);
    const rows=(await run(`SELECT user_pin,command_type,state,payload FROM sport_center.x904_user_commands
      WHERE payload->>'source'='AUTO_NEW_ORDINARY_USER_DEFAULT_SUSPEND' ORDER BY user_pin`)).rows;
    expect(rows.map((r:any)=>r.user_pin)).toEqual(["650","660","661"]);
    expect(rows.every((r:any)=>r.command_type==="SUSPEND_USER" && r.state==="queued")).toBe(true);
    expect(rows.find((r:any)=>r.user_pin==="660").payload).toMatchObject({
      expectedUid:660,expectedName:"NEW MULTI SPACE",expectedRole:0,
      firstObservedAt:"2026-11-09T00:05:00.000Z",
      suspendDeadlineAt:"2026-11-09T00:35:00.000Z"
    });
  } finally {
    delete process.env.GYM_X904_NEW_USER_DEFAULT_SUSPEND_ENABLED;
    delete process.env.GYM_X904_NEW_USER_BASELINE_AT;
  }
});


test("collector outage does not freeze later enrollment; no duplicate on retry", async () => {
  process.env.GYM_X904_NEW_USER_DEFAULT_SUSPEND_ENABLED="true";
  process.env.GYM_X904_NEW_USER_BASELINE_AT="2026-11-08T23:59:00.000Z";
  delete process.env.GYM_X904_NEW_USER_ONLY_PIN;
  try {
    await run(`INSERT INTO sport_center.gym_x904_lan_users(device_serial,user_pin,device_uid,display_name,device_role)
      VALUES('TDBD234200545','670',670,'POST GAP VISITOR',0)`);
    // A 15-minute collection gap follows earlier complete snapshots. A clean
    // baseline after recovery must permit NEW enrollments, not old PINs.
    await run(`INSERT INTO sport_center.gym_x904_access_snapshots(device_serial,observed_at,user_count,users)
      SELECT 'TDBD234200545','2026-11-09T00:20:00Z',user_count,users
      FROM sport_center.gym_x904_access_snapshots
      WHERE device_serial='TDBD234200545' ORDER BY snapshot_id DESC LIMIT 1`);
    await run(`INSERT INTO sport_center.gym_x904_access_snapshots(device_serial,observed_at,user_count,users)
      SELECT 'TDBD234200545','2026-11-09T00:21:00Z',user_count+1,
        users || '[{"pin":"670","name":"POST GAP VISITOR","role":0,"group":1,"enabled":true}]'::jsonb
      FROM sport_center.gym_x904_access_snapshots
      WHERE device_serial='TDBD234200545' ORDER BY snapshot_id DESC LIMIT 1`);
    const time=new Date("2026-11-09T00:22:00.000Z");
    await processX904NewOrdinaryUserDefaultSuspend(db as any,time);
    await processX904NewOrdinaryUserDefaultSuspend(db as any,time);
    const matches=(await run(`SELECT user_pin,command_type,state,payload FROM sport_center.x904_user_commands
      WHERE user_pin='670' AND payload->>'source'='AUTO_NEW_ORDINARY_USER_DEFAULT_SUSPEND'`)).rows;
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({user_pin:"670",command_type:"SUSPEND_USER",state:"queued",
      payload:{expectedUid:670,expectedRole:0,firstObservedAt:"2026-11-09T00:21:00.000Z",
        suspendDeadlineAt:"2026-11-09T00:51:00.000Z"}});
    const old=(await run(`SELECT user_pin FROM sport_center.x904_user_commands
      WHERE user_pin IN ('662','663','664','665','668') AND
        payload->>'source'='AUTO_NEW_ORDINARY_USER_DEFAULT_SUSPEND'`)).rows;
    expect(old).toHaveLength(0);
  } finally {
    delete process.env.GYM_X904_NEW_USER_DEFAULT_SUSPEND_ENABLED;
    delete process.env.GYM_X904_NEW_USER_BASELINE_AT;
  }
});

test("existing confirmed VIS001 booking recovers pending grant and queues one activation without second admin click", async () => {
  const at = new Date("2026-11-06T01:30:00Z");
  process.env.GYM_X904_NONMEMBER_ONLY_PIN = "78";
  try {
    await run("INSERT INTO sport_center.sport_bookings(id,booking_date,start_time,source,notes,status,customer_name,grand_total,total_price) VALUES (9850,'2026-11-06','12:00','gym_public_guest','Kartu VIS001–VIS006 menunggu pilihan','confirmed','CI VIS FANDI',30000,30000)");
    await run("INSERT INTO sport_center.sport_payments(id,booking_id,status,confirmed_at,amount,proof_url) VALUES (9950,9850,'confirmed','2026-11-06T01:00:00Z',30000,'ci://confirmed-payment')");
    await run("INSERT INTO sport_center.x904_nonmember_daily_access(device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,visitor_name,booking_id,payment_id,confirmed_at,expires_at,verification_state,access_state) VALUES ('TDBD234200545','card','VIS001','78',338,'VIS 001','CI VIS FANDI',9850,9950,'2026-11-06T01:00:00Z','2026-11-06T16:00:00Z','pending','pending')");
    await run("INSERT INTO sport_center.gym_vis_card_reservations(booking_id,payment_id,card_code,user_pin,device_uid,state,funds_reference,funds_verified_by,funds_verified_at) VALUES(9850,9950,'VIS001','78',338,'reserved','ADMINPAY-9950','CI_ADMIN','2026-11-06T01:00:10Z')");
    await addSnapshot(new Date(at.getTime()-1000),'78','VIS 001',2);
    await processX904NonmemberDailyAccess(db as any,at);
    const linked = (await run("SELECT access_id,access_state,verification_state FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9850")).rows[0];
    expect(linked).toMatchObject({access_state:"pending",verification_state:"verified"});
    const queued = await commandFor("ACTIVATE_USER",Number(linked.access_id));
    expect(queued?.payload).toMatchObject({expectedUid:338,accessId:Number(linked.access_id)});
    await processX904NonmemberDailyAccess(db as any,at);
    expect((await run("SELECT count(*)::int n FROM sport_center.x904_user_commands WHERE command_type='ACTIVATE_USER' AND payload->>'accessId'=$1",[String(linked.access_id)])).rows[0].n).toBe(1);
    expect((await run("SELECT state,collected_at FROM sport_center.gym_vis_card_reservations WHERE booking_id=9850")).rows[0]).toMatchObject({state:"reserved",collected_at:null});
  } finally { delete process.env.GYM_X904_NONMEMBER_ONLY_PIN; }
});


test("paid public Gym booking without VIS recovers after temporary inventory failure without a second payment", async () => {
  const day = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Jakarta", year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const midday = new Date(day + "T12:00:00+07:00");
  const order="CI-RECOVER-NO-CARD-15101";
  await run("INSERT INTO sport_center.sport_bookings(id,booking_date,start_time,source,notes,status,order_number,customer_name,grand_total,total_price) VALUES(15101,$1,'10:00','gym_public_guest','Kartu VIS001–VIS006 menunggu pilihan','confirmed',$2,'CI RECOVERY',30000,30000)",[day,order]);
  await run("INSERT INTO sport_center.sport_payments(id,booking_id,status,confirmed_at,amount) VALUES(16101,15101,'confirmed',now(),30000)");
  await addSnapshot(new Date(),"11","VIS 005",2);
  // The earlier payment confirmation is real within the fixture, but a
  // missing proof must never cause a VIS grant or additional payment row.
  expect(await recoverUnallocatedPaidGymVis(midday)).toBe(0);
  expect((await run("SELECT count(*)::int n FROM sport_center.gym_vis_card_reservations WHERE booking_id=15101")).rows[0].n).toBe(0);
  await run("UPDATE sport_center.sport_payments SET proof_url='ci://valid-bank-receipt' WHERE id=16101");
  expect(await recoverUnallocatedPaidGymVis(midday)).toBe(1);
  const recovered=(await run("SELECT r.card_code,r.state,a.verification_state,a.access_state FROM sport_center.gym_vis_card_reservations r JOIN sport_center.x904_nonmember_daily_access a ON a.booking_id=r.booking_id WHERE r.booking_id=15101")).rows;
  expect(recovered).toMatchObject([{card_code:"VIS005",state:"reserved",verification_state:"verified",access_state:"pending"}]);
  expect(await recoverUnallocatedPaidGymVis(midday)).toBe(0);
  expect((await run("SELECT count(*)::int n FROM sport_center.sport_payments WHERE booking_id=15101")).rows[0].n).toBe(1);
  expect((await run("SELECT count(*)::int n FROM sport_center.gym_vis_card_reservations WHERE booking_id=15101")).rows[0].n).toBe(1);
});

test.each([
  ["VIS001","78",338], ["VIS002","90",339], ["VIS003","13",13],
  ["VIS004","17",17], ["VIS005","11",11], ["VIS006","15",15],
])("isolated six-card lifecycle %s: one paid approval, ACK, suspend, return and reuse", async (code,pin,uid) => {
  const n=Number(code.slice(-3)), bookingId=11000+n, paymentId=12000+n;
  const newBookingId=13000+n, newPaymentId=14000+n;
  const machineName="VIS "+String(n).padStart(3,"0");
  const t=new Date("2026-11-06T01:40:00Z");
  process.env.GYM_X904_NONMEMBER_ONLY_PIN=pin;
  try {
    // Disposable localhost database only. Prior scenarios have already run.
    await run("DELETE FROM sport_center.gym_vis_card_reservations WHERE user_pin=$1",[pin]);
    await run("DELETE FROM sport_center.x904_user_commands WHERE user_pin=$1",[pin]);
    await run("DELETE FROM sport_center.x904_nonmember_daily_access WHERE user_pin=$1",[pin]);
    await run("DELETE FROM sport_center.gym_x904_member_mapping WHERE user_pin=$1",[pin]);
    await run("DELETE FROM sport_center.gym_x904_lan_users WHERE user_pin=$1",[pin]);
    await run("INSERT INTO sport_center.gym_x904_lan_users VALUES ('TDBD234200545',$1,$2,$3,0)",[pin,uid,machineName]);
    await run("INSERT INTO sport_center.sport_bookings(id,booking_date,start_time,source,notes,status,order_number,customer_name,grand_total,total_price) VALUES($1,'2026-11-06','12:00','gym_public_guest','Kartu VIS001–VIS006 menunggu pilihan','confirmed',$2,'CI SIX CARDS',30000,30000)",[bookingId,"CI-PAID-"+code]);
    await run("INSERT INTO sport_center.sport_payments(id,booking_id,status,confirmed_at,amount,proof_url) VALUES($1,$2,'confirmed','2026-11-06T01:39:00Z',30000,'ci://mock-receipt')",[paymentId,bookingId]);
    // Simulate a previously reserved and paid card requiring no second approval.
    await run("INSERT INTO sport_center.x904_nonmember_daily_access(device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,visitor_name,booking_id,payment_id,confirmed_at,expires_at,verification_state,access_state) VALUES('TDBD234200545','card',$1,$2,$3,$4,'CI SIX CARDS',$5,$6,'2026-11-06T01:39:00Z','2026-11-06T16:00:00Z','pending','pending')",[code,pin,uid,machineName,bookingId,paymentId]);
    await run("INSERT INTO sport_center.gym_vis_card_reservations(booking_id,payment_id,card_code,user_pin,device_uid,state,funds_reference,funds_verified_by) VALUES($1,$2,$3,$4,$5,'reserved',$6,'CI_STAFF')",[bookingId,paymentId,code,pin,uid,"ADMINPAY-"+paymentId]);
    const accessId=Number((await run("SELECT access_id FROM sport_center.x904_nonmember_daily_access WHERE booking_id=$1",[bookingId])).rows[0].access_id);
    await addSnapshot(new Date(t.getTime()-1000),pin,machineName,2);
    await processX904NonmemberDailyAccess(db as any,t);
    expect((await run("SELECT verification_state FROM sport_center.x904_nonmember_daily_access WHERE access_id=$1",[accessId])).rows[0].verification_state).toBe("verified");
    const activation=await commandFor("ACTIVATE_USER",accessId);
    expect(activation?.payload).toMatchObject({accessId,expectedUid:uid});
    await processX904NonmemberDailyAccess(db as any,t);
    expect((await run("SELECT count(*)::int n FROM sport_center.x904_user_commands WHERE command_type='ACTIVATE_USER' AND payload->>'accessId'=$1",[String(accessId)])).rows[0].n).toBe(1);
    const activateAt=new Date(t.getTime()+2000);
    await ack(String(activation.command_id),activateAt,pin,machineName,uid,1);
    await processX904NonmemberDailyAccess(db as any,new Date(t.getTime()+4000));
    const active=(await run("SELECT access_state,activated_at,expires_at FROM sport_center.x904_nonmember_daily_access WHERE access_id=$1",[accessId])).rows[0];
    expect(active.access_state).toBe("active");
    expect(new Date(active.activated_at).getTime()).toBe(activateAt.getTime());
    const expires=new Date(active.expires_at);
    expect(expires.getTime()).toBe(Math.min(activateAt.getTime()+12*3600000,Date.parse("2026-11-06T16:00:00Z")));
    await addSnapshot(new Date(expires.getTime()+1000),pin,machineName,1);
    await processX904NonmemberDailyAccess(db as any,new Date(expires.getTime()+2000));
    const suspension=await commandFor("SUSPEND_USER",accessId);
    expect(suspension?.payload).toMatchObject({accessId,expectedUid:uid});
    await ack(String(suspension.command_id),new Date(expires.getTime()+3000),pin,machineName,uid,2);
    await processX904NonmemberDailyAccess(db as any,new Date(expires.getTime()+5000));
    expect((await run("SELECT access_state FROM sport_center.x904_nonmember_daily_access WHERE access_id=$1",[accessId])).rows[0].access_state).toBe("expired");
    // The device + payment lifecycle must never pretend a physical handover happened.
    expect((await run("SELECT state,collected_at FROM sport_center.gym_vis_card_reservations WHERE booking_id=$1",[bookingId])).rows[0]).toMatchObject({state:"reserved",collected_at:null});
    await run("UPDATE sport_center.sport_bookings SET status='completed' WHERE id=$1",[bookingId]);
    // Return checks use a fresh physical snapshot, not historical test-clock evidence.
    await run("UPDATE sport_center.x904_user_commands SET completed_at=now() WHERE command_id=$1",[suspension.command_id]);
    await addSnapshot(new Date(Date.now()+1000),pin,machineName,2);
    const returned=await returnVerifiedVisCard({orderNumber:"CI-PAID-"+code,physicalCardReturned:true,x904ReadbackChecked:true,returnedBy:"CI_STAFF"});
    expect(returned.state).toBe("returned");
    expect((await run("SELECT state FROM sport_center.gym_vis_card_reservations WHERE booking_id=$1",[bookingId])).rows[0].state).toBe("returned");
    // Reuse through the original production allocator, not a second fake worker.
    const date=new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Jakarta"});
    await run("INSERT INTO sport_center.sport_bookings(id,booking_date,start_time,source,notes,status,order_number,customer_name,grand_total,total_price) VALUES($1,$2,'12:00','gym_public_guest','Kartu VIS001–VIS006 menunggu pilihan','confirmed',$3,'CI NEXT VISITOR',30000,30000)",[newBookingId,date,"CI-REUSE-"+code]);
    await run("INSERT INTO sport_center.sport_payments(id,booking_id,status,confirmed_at,amount,proof_url) VALUES($1,$2,'confirmed',now(),30000,'ci://next-receipt')",[newPaymentId,newBookingId]);
    await addSnapshot(new Date(),pin,machineName,2);
    const reuse=await autoReserveVisAfterFundsVerified({orderNumber:"CI-REUSE-"+code,officialBankReference:"ADMINPAY-"+newPaymentId,confirmedPaymentId:newPaymentId,officialFundsChecked:true,verifiedBy:"CI_STAFF"});
    expect(reuse).toMatchObject({cardCode:code,state:"reserved",newReservation:true});
    const again=await autoReserveVisAfterFundsVerified({orderNumber:"CI-REUSE-"+code,officialBankReference:"ADMINPAY-"+newPaymentId,confirmedPaymentId:newPaymentId,officialFundsChecked:true,verifiedBy:"CI_STAFF"});
    expect(again).toMatchObject({cardCode:code,state:"reserved",newReservation:false});
  } finally {
    delete process.env.GYM_X904_NONMEMBER_ONLY_PIN;
  }
});

