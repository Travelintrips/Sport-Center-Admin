import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { pool as appDatabasePool } from "@workspace/db";
import { readFileSync } from "node:fs";
import { processX904NonmemberDailyAccess } from "./x904NonmemberDailyAccessWorker";
import { processX904NewOrdinaryUserDefaultSuspend } from "./x904NewOrdinaryUserDefaultSuspend";
import { autoReserveVisAfterFundsVerified, collectReservedVisCard } from "./x904GymVisitorCardReservations";

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
  await run(`CREATE TABLE sport_center.users(id int primary key,name text,registration_source text,account_status text,email text,password_hash text);
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
  await run("CREATE ROLE anon");
  await run("CREATE ROLE authenticated");
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
  await run(`INSERT INTO sport_center.users VALUES(301,'X904 AUTOMATION SERVICE','system_x904_automation','inactive',null,null);
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

test("real worker: new VIS003 cannot activate while reserved; activates only after handover, then cancels to suspend", async()=>{
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
    expect(await commandFor("ACTIVATE_USER",Number(linked.access_id))).toBeUndefined();
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

test("real VIS reservation service: admin-confirmed payment creates one held grant and only card handover releases it", async()=>{
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
  expect(grants.rows[0]).toMatchObject({access_state:"pending",verification_state:"pending",identity_label:"VIS004",user_pin:"17",device_uid:17,booking_id:9323,payment_id:9423});
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
  } finally {
    delete process.env.GYM_X904_NONMEMBER_ONLY_PIN;
  }
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
    await run("INSERT INTO sport_center.sport_payments(id,booking_id,status,confirmed_at) VALUES($1,$2,'confirmed',now())",[pay,id]);
    const accessId=Number((await run("SELECT access_id FROM sport_center.x904_nonmember_daily_access WHERE booking_id=$1",[id])).rows[0].access_id);
    const before=(await run("SELECT verification_state,access_state FROM sport_center.x904_nonmember_daily_access WHERE access_id=$1",[accessId])).rows[0];
    expect(before).toMatchObject({verification_state:"review_required",access_state:"review_required"});

    const anonymous=await request.post(endpoint).send({identityChecked:true,officialFundsChecked:true,officialBankReference:"CI-BANK-9706"});
    expect(anonymous.status).toBe(403);
    const token=createToken(301,"staff");
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
  // Isolated local PostgreSQL; never send machine commands to a real X904.
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
