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

test("ADMIN LAPANGAN E2E: paid VIS stays closed before physical handover; activates and suspends with ACK", async () => {
  const now = new Date("2026-11-06T01:00:00Z");
  const booked = 9801;
  const pay = 9801;
  const pin = "78";
  process.env.GYM_X904_NONMEMBER_ONLY_PIN = pin;
  try {
    // The shared isolated fixture seeds an unrelated unpaid VIS001 record (#9001).
    // Release only that synthetic fixture so this case tests a separate booking.
    await run("UPDATE sport_center.x904_nonmember_daily_access SET access_state='expired' WHERE booking_id=9001 AND access_state='pending'");
    // Reuse only the DEV-confirmed payment trigger; never touch actual production.
    const devTrigger = readFileSync("../../scripts/fixtures/20261110_admin_vis_dev_payment_trigger.sql","utf8");
    await run(devTrigger);
    await run(`INSERT INTO sport_center.sport_bookings (id,booking_date,start_time,source,status,order_number,customer_name,grand_total,total_price)
      VALUES (9801,'2026-11-06','06:00','admin','confirmed','TEST-ADMIN-9801','VIS 001',30000,30000);
      INSERT INTO sport_center.x904_nonmember_daily_access
      (device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,booking_id,verification_state,access_state)
      VALUES ('TDBD234200545','card','VIS001','78',338,'VIS 001',9801,'pending','pending');
      INSERT INTO sport_center.sport_payments(id,booking_id,status,amount,confirmed_at,proof_url)
      VALUES (9801,9801,'pending',30000,'2026-11-06T01:00:00Z','/fixture/evidence.png');
      UPDATE sport_center.sport_payments SET status='confirmed' WHERE id=9801;`);
    const grant = (await run("SELECT access_id,verification_state,payment_id,confirmed_at,expires_at FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9801")).rows[0];
    expect(grant.payment_id).toBe(pay);
    expect(grant.verification_state).toBe("pending");
    const accessId = Number(grant.access_id);
    await addSnapshot(new Date(now.getTime()-1000),pin,"VIS 001",2);
    await processX904NonmemberDailyAccess(db as any,new Date(now.getTime()+100));
    expect(await commandFor("ACTIVATE_USER",accessId)).toBeUndefined();

    // Operator's authenticated handover endpoint is separately contract-tested.
    // Here simulate its sole allowed DB transition to verify the *actual worker*.
    await run("UPDATE sport_center.x904_nonmember_daily_access SET verification_state='verified' WHERE booking_id=9801 AND verification_state='pending'");
    await processX904NonmemberDailyAccess(db as any,new Date(now.getTime()+500));
    const first = await commandFor("ACTIVATE_USER",accessId);
    expect(first?.payload).toMatchObject({expectedUid:338,accessId,source:"AUTO_NONMEMBER_GYM_12H"});
    expect((await run("SELECT count(*)::int n FROM sport_center.x904_user_commands WHERE command_type='ACTIVATE_USER' AND payload->>'accessId'=$1",[String(accessId)])).rows[0].n).toBe(1);
    const actAt = new Date(now.getTime()+3000);
    await ack(String(first.command_id),actAt,pin,"VIS 001",338,1);
    await processX904NonmemberDailyAccess(db as any,new Date(actAt.getTime()+2000));
    expect((await run("SELECT access_state FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9801")).rows[0].access_state).toBe("active");

    // Before 23:00 WIB the grant expires at exactly 12h after verified activation.
    const effective = (await run("SELECT expires_at FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9801")).rows[0];
    const expires = new Date(effective.expires_at);
    await addSnapshot(new Date(expires.getTime()+1000),pin,"VIS 001",1);
    await processX904NonmemberDailyAccess(db as any,new Date(expires.getTime()+2000));
    const stop = await commandFor("SUSPEND_USER",accessId);
    expect(stop?.payload).toMatchObject({expectedUid:338,accessId,source:"AUTO_NONMEMBER_GYM_12H"});
    await ack(String(stop.command_id),new Date(expires.getTime()+3500),pin,"VIS 001",338,2);
    await processX904NonmemberDailyAccess(db as any,new Date(expires.getTime()+6000));
    const final = (await run("SELECT access_state FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9801")).rows[0];
    expect(final.access_state).toBe("expired");
    expect((await run("SELECT count(*)::int n FROM sport_center.x904_user_commands WHERE payload->>'accessId'=$1",[String(accessId)])).rows[0].n).toBe(2);
  } finally {
    delete process.env.GYM_X904_NONMEMBER_ONLY_PIN;
  }
});

test("ADMIN LAPANGAN E2E: confirmed ordinary PIN gets one activation and is suspended on expiry", async () => {
  const start = new Date("2026-11-06T01:00:00Z");
  process.env.GYM_X904_NONMEMBER_ONLY_PIN="604";
  try {
    await run(`INSERT INTO sport_center.sport_bookings
      (id,booking_date,start_time,source,status,order_number,customer_name,grand_total,total_price)
      VALUES(9802,'2026-11-06','06:00','admin','confirmed','TEST-ADMIN-9802','TEST ADMIN PIN',30000,30000);
      INSERT INTO sport_center.x904_nonmember_daily_access
      (device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,booking_id,verification_state,access_state)
      VALUES('TDBD234200545','pin','PIN:604','604',604,'TEST ADMIN PIN',9802,'verified','pending');
      INSERT INTO sport_center.sport_payments(id,booking_id,status,amount,confirmed_at,proof_url)
      VALUES(9802,9802,'pending',30000,'2026-11-06T01:00:00Z','/fixture/pin-payment.png');
      UPDATE sport_center.sport_payments SET status='confirmed' WHERE id=9802;`);
    const grant=(await run("SELECT access_id,verification_state,payment_id FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9802")).rows[0];
    expect(grant.verification_state).toBe("verified");
    expect(grant.payment_id).toBe(9802);
    const accessId=Number(grant.access_id);
    await addSnapshot(new Date(start.getTime()-1000),"604","TEST ADMIN PIN",2);
    await processX904NonmemberDailyAccess(db as any,new Date(start.getTime()+100));
    const activate=await commandFor("ACTIVATE_USER",accessId);
    expect(activate?.payload).toMatchObject({source:"AUTO_NONMEMBER_GYM_12H",accessId,expectedUid:604});
    const actAt=new Date(start.getTime()+3000);
    await ack(String(activate.command_id),actAt,"604","TEST ADMIN PIN",604,1);
    await processX904NonmemberDailyAccess(db as any,new Date(actAt.getTime()+2000));
    expect((await run("SELECT access_state FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9802")).rows[0].access_state).toBe("active");
    const expires=new Date((await run("SELECT expires_at FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9802")).rows[0].expires_at);
    await addSnapshot(new Date(expires.getTime()+1000),"604","TEST ADMIN PIN",1);
    await processX904NonmemberDailyAccess(db as any,new Date(expires.getTime()+2000));
    const suspend=await commandFor("SUSPEND_USER",accessId);
    expect(suspend?.payload).toMatchObject({source:"AUTO_NONMEMBER_GYM_12H",accessId,expectedUid:604});
    await ack(String(suspend.command_id),new Date(expires.getTime()+3500),"604","TEST ADMIN PIN",604,2);
    await processX904NonmemberDailyAccess(db as any,new Date(expires.getTime()+6000));
    expect((await run("SELECT access_state FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9802")).rows[0].access_state).toBe("expired");
    expect((await run("SELECT count(*)::int n FROM sport_center.x904_user_commands WHERE payload->>'accessId'=$1",[String(accessId)])).rows[0].n).toBe(2);
  } finally {
    delete process.env.GYM_X904_NONMEMBER_ONLY_PIN;
  }
});

test("ADMIN LAPANGAN E2E: confirmed payment on cancelled booking cannot issue ACTIVATE_USER", async () => {
  const start=new Date("2026-11-06T01:00:00Z");
  process.env.GYM_X904_NONMEMBER_ONLY_PIN="605";
  try {
    await run(`INSERT INTO sport_center.sport_bookings
      (id,booking_date,start_time,source,status,order_number,customer_name,grand_total,total_price)
      VALUES(9803,'2026-11-06','06:00','admin','cancelled','TEST-ADMIN-9803','TEST CANCELLED',30000,30000);
      INSERT INTO sport_center.x904_nonmember_daily_access
      (device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,booking_id,verification_state,access_state)
      VALUES('TDBD234200545','pin','PIN:605','605',605,'TEST CANCELLED',9803,'verified','pending');
      INSERT INTO sport_center.sport_payments(id,booking_id,status,amount,confirmed_at,proof_url)
      VALUES(9803,9803,'pending',30000,'2026-11-06T01:00:00Z','/fixture/evidence.png');
      UPDATE sport_center.sport_payments SET status='confirmed' WHERE id=9803;`);
    const accessId=Number((await run("SELECT access_id FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9803")).rows[0].access_id);
    await addSnapshot(new Date(start.getTime()-1000),"605","TEST CANCELLED",2);
    await processX904NonmemberDailyAccess(db as any,new Date(start.getTime()+100));
    expect(await commandFor("ACTIVATE_USER",accessId)).toBeUndefined();
  } finally {
    delete process.env.GYM_X904_NONMEMBER_ONLY_PIN;
  }
});

test("ADMIN LAPANGAN HTTP: actual VIS handover rejects invalid requests and releases exactly one paid grant", async () => {
  process.env.SESSION_SECRET ||= "isolated-admin-vis-http-test";
  const { default: express } = await import("express");
  const { default: supertest } = await import("supertest");
  const { default: bookingsRouter } = await import("../routes/bookings.js");
  const { createToken } = await import("../lib/auth.js");
  const app=express();
  app.use(express.json()); app.use("/api",bookingsRouter);
  const request=supertest(app);
  await run(readFileSync("../../scripts/fixtures/20261110_admin_vis_dev_payment_trigger.sql","utf8"));
  const id=9811,pay=9811;
  const dateParts=new Intl.DateTimeFormat("en-CA",{
    timeZone:"Asia/Jakarta",year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(new Date());
  const wd=Object.fromEntries(dateParts.map(p=>[p.type,p.value]));
  const today=`${wd.year}-${wd.month}-${wd.day}`;
  const hour=Number(new Intl.DateTimeFormat("en-GB",{
    timeZone:"Asia/Jakarta",hour:"2-digit",hourCycle:"h23"
  }).format(new Date()));
  const url=`/api/bookings/${id}/x904-admin-card-handover`;
  await run("ALTER TABLE sport_center.users ADD COLUMN IF NOT EXISTS role text");
  // Keep the X904 automation service (301) inactive and immutable.
  // HTTP requests use a separate synthetic operator, as in production.
  await run("INSERT INTO sport_center.users(id,name,registration_source,account_status,role) VALUES(302,'CI ADMIN BOOKING','ci','active','staff')");
  const token=createToken(302,"staff");
  // The shared fixture's VIS001 entitlement is not a new live customer.
  await run("UPDATE sport_center.x904_nonmember_daily_access SET access_state='expired' WHERE booking_id=9001 AND access_state='pending'");
  await run("INSERT INTO sport_center.gym_x904_lan_users VALUES('TDBD234200545','78',338,'VIS 001',0)");
  await run(`INSERT INTO sport_center.sport_bookings
    (id,booking_date,start_time,source,status,order_number,customer_name,grand_total,total_price)
    VALUES($1,$2,'06:00','admin','confirmed','TEST-ADMIN-HTTP-9811','VIS 001',30000,30000)`,[id,today]);
  await run(`INSERT INTO sport_center.x904_nonmember_daily_access
    (device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,booking_id,verification_state,access_state)
    VALUES('TDBD234200545','card','VIS001','78',338,'VIS 001',9811,'pending','pending')`);
  await run(`INSERT INTO sport_center.sport_payments
    (id,booking_id,status,amount,confirmed_at,proof_url)
    VALUES(9811,9811,'pending',30000,now(),'/fixture/valid-confirmed-proof.png');
    UPDATE sport_center.sport_payments SET status='confirmed' WHERE id=9811`);
  const accessId=Number((await run("SELECT access_id FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9811")).rows[0].access_id);
  const unauth=await request.post(url).send({identityChecked:true,physicalCardHandedOver:true});
  expect([401,403]).toContain(unauth.status);
  const denied=await request.post(url).set("Authorization",`Bearer ${token}`)
    .send({identityChecked:true,physicalCardHandedOver:false});
  expect(denied.status).toBe(400);
  expect((await run("SELECT verification_state FROM sport_center.x904_nonmember_daily_access WHERE access_id=$1",[accessId])).rows[0].verification_state).toBe("pending");
  await addSnapshot(new Date(),"78","VIS 001",2);
  if (hour>=6 && hour<23) {
    const approved=await request.post(url).set("Authorization",`Bearer ${token}`)
      .send({identityChecked:true,physicalCardHandedOver:true});
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({success:true,accessId,cardCode:"VIS001",accessState:"pending"});
    expect((await run("SELECT verification_state FROM sport_center.x904_nonmember_daily_access WHERE access_id=$1",[accessId])).rows[0].verification_state).toBe("verified");
    const replay=await request.post(url).set("Authorization",`Bearer ${token}`)
      .send({identityChecked:true,physicalCardHandedOver:true});
    expect(replay.status).toBe(409); // no second handover
    expect(await commandFor("ACTIVATE_USER",accessId)).toBeUndefined(); // worker owns commands
  } else {
    const closed=await request.post(url).set("Authorization",`Bearer ${token}`)
      .send({identityChecked:true,physicalCardHandedOver:true});
    expect(closed.status).toBe(409);
  }
});


test("ADMIN LAPANGAN EXPIRY: never handed-over paid VIS closes after booking day without X904 commands", async () => {
  process.env.GYM_X904_NONMEMBER_ONLY_PIN="15";
  try {
    await run(readFileSync("../../scripts/fixtures/20261110_admin_vis_dev_payment_trigger.sql","utf8"));
    await run(`INSERT INTO sport_center.sport_bookings
      (id,booking_date,start_time,source,status,order_number,customer_name,grand_total,total_price)
      VALUES(9901,'2026-11-06','06:00','admin','confirmed','ADMIN-EXPIRY-9901','VIS 006',30000,30000);
      INSERT INTO sport_center.x904_nonmember_daily_access
      (device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,booking_id,verification_state,access_state)
      VALUES('TDBD234200545','card','VIS006','15',15,'VIS 006',9901,'pending','pending');
      INSERT INTO sport_center.sport_payments(id,booking_id,status,amount,confirmed_at,proof_url)
      VALUES(9901,9901,'pending',30000,'2026-11-06T01:00:00Z','/fixture/payment.png');
      UPDATE sport_center.sport_payments SET status='confirmed' WHERE id=9901;`);
    const accessId=Number((await run("SELECT access_id FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9901")).rows[0].access_id);
    expect((await run("SELECT verification_state FROM sport_center.x904_nonmember_daily_access WHERE access_id=$1",[accessId])).rows[0].verification_state).toBe("pending");
    const at=new Date("2026-11-07T01:00:00Z");
    // Prior HTTP fixtures may have wall-clock snapshots newer than this
    // historical simulated date. This is a disposable PostgreSQL test only.
    await run("DELETE FROM sport_center.gym_x904_access_snapshots WHERE observed_at > $1",[at]);
    await addSnapshot(new Date(at.getTime()-1000),"15","VIS 006",2);
    await processX904NonmemberDailyAccess(db as any,at);
    expect((await run("SELECT access_state FROM sport_center.x904_nonmember_daily_access WHERE access_id=$1",[accessId])).rows[0].access_state).toBe("expired");
    expect(await commandFor("ACTIVATE_USER",accessId)).toBeUndefined();
    expect(await commandFor("SUSPEND_USER",accessId)).toBeUndefined();
    await processX904NonmemberDailyAccess(db as any,new Date(at.getTime()+2000));
    expect((await run("SELECT access_state FROM sport_center.x904_nonmember_daily_access WHERE access_id=$1",[accessId])).rows[0].access_state).toBe("expired");
  } finally { delete process.env.GYM_X904_NONMEMBER_ONLY_PIN; }
});

test("ADMIN LAPANGAN EXPIRY: Group1, stale snapshot and command in flight block unactivated card cleanup", async () => {
  process.env.GYM_X904_NONMEMBER_ONLY_PIN="90";
  try {
    await run(`INSERT INTO sport_center.sport_bookings
      (id,booking_date,start_time,source,status,order_number,customer_name,total_price)
      VALUES(9902,'2026-11-06','06:00','admin','pending_payment','ADMIN-EXPIRY-9902','VIS 002',30000);
      INSERT INTO sport_center.x904_nonmember_daily_access
      (device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,booking_id,verification_state,access_state)
      VALUES('TDBD234200545','card','VIS002','90',339,'VIS 002',9902,'pending','pending');`);
    const id=Number((await run("SELECT access_id FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9902")).rows[0].access_id);
    const at=new Date("2026-11-07T01:00:00Z");
    await run("DELETE FROM sport_center.gym_x904_access_snapshots WHERE observed_at > $1",[at]);
    await addSnapshot(new Date(at.getTime()-1000),"90","VIS 002",1);
    await processX904NonmemberDailyAccess(db as any,at);
    expect((await run("SELECT access_state FROM sport_center.x904_nonmember_daily_access WHERE access_id=$1",[id])).rows[0].access_state).toBe("pending");
    await addSnapshot(new Date(at.getTime()-1000),"90","VIS 002",2);
    await run(`INSERT INTO sport_center.x904_user_commands
      (device_serial,command_type,user_pin,payload,requested_by,idempotency_key)
      VALUES('TDBD234200545','SUSPEND_USER','90','{}'::jsonb,301,'ADMIN-EXPIRY-9902-INFLIGHT')`);
    await processX904NonmemberDailyAccess(db as any,at);
    expect((await run("SELECT access_state FROM sport_center.x904_nonmember_daily_access WHERE access_id=$1",[id])).rows[0].access_state).toBe("pending");
    await run("UPDATE sport_center.x904_user_commands SET state='failed' WHERE idempotency_key='ADMIN-EXPIRY-9902-INFLIGHT'");
    await addSnapshot(new Date(at.getTime()-20*60_000),"90","VIS 002",2);
    await processX904NonmemberDailyAccess(db as any,at);
    expect((await run("SELECT access_state FROM sport_center.x904_nonmember_daily_access WHERE access_id=$1",[id])).rows[0].access_state).toBe("pending");
    await addSnapshot(new Date(at.getTime()+1000),"90","VIS 002",2);
    await processX904NonmemberDailyAccess(db as any,new Date(at.getTime()+2000));
    expect((await run("SELECT access_state FROM sport_center.x904_nonmember_daily_access WHERE access_id=$1",[id])).rows[0].access_state).toBe("expired");
    expect(await commandFor("ACTIVATE_USER",id)).toBeUndefined();
  } finally { delete process.env.GYM_X904_NONMEMBER_ONLY_PIN; }
});

test("ADMIN LAPANGAN EXPIRY: same-day unused VIS stays pending until 23:00 WIB", async () => {
  process.env.GYM_X904_NONMEMBER_ONLY_PIN="13";
  try {
    const at=new Date("2026-11-06T12:00:00Z"); // 19:00 WIB; before closing
    await run("DELETE FROM sport_center.gym_x904_access_snapshots WHERE observed_at > $1",[at]);
    await run(`INSERT INTO sport_center.sport_bookings
      (id,booking_date,start_time,source,status,order_number,customer_name,total_price)
      VALUES(9903,'2026-11-06','06:00','admin','confirmed','ADMIN-EXPIRY-9903','VIS 003',30000);
      INSERT INTO sport_center.x904_nonmember_daily_access
      (device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,booking_id,verification_state,access_state)
      VALUES('TDBD234200545','card','VIS003','13',13,'VIS 003',9903,'pending','pending');`);
    const id=Number((await run("SELECT access_id FROM sport_center.x904_nonmember_daily_access WHERE booking_id=9903")).rows[0].access_id);
    await addSnapshot(new Date(at.getTime()-1000),"13","VIS 003",2);
    await processX904NonmemberDailyAccess(db as any,at);
    expect((await run("SELECT access_state FROM sport_center.x904_nonmember_daily_access WHERE access_id=$1",[id])).rows[0].access_state).toBe("pending");
    await addSnapshot(new Date("2026-11-06T15:59:59Z"),"13","VIS 003",2);
    await processX904NonmemberDailyAccess(db as any,new Date("2026-11-06T16:00:00Z"));
    expect((await run("SELECT access_state FROM sport_center.x904_nonmember_daily_access WHERE access_id=$1",[id])).rows[0].access_state).toBe("expired");
  } finally { delete process.env.GYM_X904_NONMEMBER_ONLY_PIN; }
});
