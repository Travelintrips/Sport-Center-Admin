import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { readFileSync } from "node:fs";
import { processX904NonmemberDailyAccess } from "./x904NonmemberDailyAccessWorker";

// All paid access scenarios use 08:00 WIB on 2026-11-06 as a stable
// simulated confirmation time. A wall-clock now() fixture would unpredictably
// fall after closing and invalidate 06:00–23:00 operating-hours assertions.
const url = process.env.X904_NONMEMBER_ISOLATED_PG_URL;
if (!url || !/^postgres(?:ql)?:\/\/[^@/]+@127\.0\.0\.1:5544[45]\/x904_nonmember(?:_safe[0-9]?)?(?:\?|$)/.test(url)) throw new Error("NONMEMBER_ISOLATED_DATABASE_REQUIRED");
const pool = new pg.Pool({ connectionString: url, max: 2 });
const db = drizzle(pool);
const run = (query: string) => pool.query(query);
const envKeys = ["GYM_X904_NONMEMBER_ACCESS_ENABLED","GYM_X904_MANUAL_ACCESS_ENABLED","GYM_X904_USER_WRITE_ENABLED","GYM_X904_AUTOMATIC_REQUESTED_BY","GYM_X904_NONMEMBER_ONLY_PIN","GYM_X904_NONMEMBER_ALLOWED_PINS"] as const;
const oldEnv = envKeys.map(key => process.env[key]);
const migration = readFileSync("migrations/20261031_x904_nonmember_daily_access.sql","utf8");
const activationClockMigration = readFileSync("migrations/20261102_x904_nonmember_verified_activation_clock.sql","utf8");
const businessHoursMigration = readFileSync("migrations/20261105_x904_nonmember_2300_wib_cutoff.sql","utf8");

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
  await run("CREATE TABLE sport_center.gym_vis_card_reservations (booking_id int primary key, payment_id int, device_serial text NOT NULL DEFAULT 'TDBD234200545',card_code text NOT NULL, user_pin text NOT NULL, device_uid int NOT NULL,state text NOT NULL DEFAULT 'reserved',collected_at timestamptz)");
  await run(migration);
  await run(activationClockMigration);
  await run(businessHoursMigration);
  // Supabase roles are absent from bare PostgreSQL; create only in isolated fixture.
  await run("CREATE ROLE anon");
  await run("CREATE ROLE authenticated");
  // Registry is isolated to this disposable PostgreSQL test database.
  await run(readFileSync("sql/x904_verified_nonmember_identities.sql", "utf8"));
  await run(`CREATE TABLE sport_center.gym_x904_lan_users(
    device_serial text,user_pin text,device_uid integer,display_name text,device_role integer);
    INSERT INTO sport_center.gym_x904_lan_users VALUES
      ('TDBD234200545','601',601,'TEST VERIFIED',0),
      ('TDBD234200545','602',602,'TEST REVOKED',0),
      ('TDBD234200545','603',603,'TEST RACE',0);`);
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
    await run("INSERT INTO sport_center.gym_vis_card_reservations (booking_id,payment_id,card_code,user_pin,device_uid,state) VALUES(9123,9223,'VIS003','13',13,'reserved')");
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
