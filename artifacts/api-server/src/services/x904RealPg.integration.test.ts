import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { processX904AutomaticCommands } from "./x904AutomaticCommandWorker";

const url = process.env.X904_ISOLATED_PG_URL;
if (!url || !url.includes("127.0.0.1:55439/x904_isolated")) throw new Error("ISOLATED_DATABASE_REQUIRED");
const pool = new pg.Pool({connectionString:url,max:2});
const db = drizzle(pool);
const run = (query:string) => pool.query(query);
const keyBase = ["GYM_X904_AUTOMATIC_COMMANDS_ENABLED","GYM_X904_AUTOMATIC_SCOPE","GYM_X904_AUTOMATIC_REQUESTED_BY","GYM_X904_AUTOMATIC_ALLOWED_PINS"] as const;
const previous=keyBase.map(k=>process.env[k]);

beforeAll(async()=>{
  await run("CREATE SCHEMA sport_center");
  await run(`CREATE TABLE sport_center.users(id int,name text,registration_source text,account_status text,email text,password_hash text);
  CREATE TABLE sport_center.x904_automatic_entitlement_events(event_id serial primary key,membership_id int,payment_id int,reason text,event_key text unique,state text default 'pending',processed_at timestamptz,result jsonb);
  CREATE TABLE sport_center.x904_user_commands(command_id serial primary key,device_serial text,command_type text,user_pin text,payload jsonb,requested_by int,idempotency_key text unique,state text default 'queued',created_at timestamptz default now(),completed_at timestamptz,result jsonb);
  CREATE TABLE sport_center.sport_memberships(id int primary key,start_date date,end_date date,status text);
  CREATE TABLE sport_center.gym_x904_member_mapping(membership_id int,user_pin text,device_serial text,status text);
  CREATE TABLE sport_center.gym_x904_lan_users(device_serial text,user_pin text,device_uid int,display_name text,device_role int);
  CREATE TABLE sport_center.sport_membership_payments(id int primary key,membership_id int,period_start date,period_end date,status text,amount int);
  CREATE TABLE sport_center.sport_bookings(id int,membership_payment_id int);
  CREATE TABLE sport_center.gym_x904_access_snapshots(snapshot_id serial primary key,device_serial text,observed_at timestamptz,user_count int,users jsonb)`);
  await run(`INSERT INTO sport_center.users VALUES (301,'X904 AUTOMATION SERVICE','system_x904_automation','inactive',null,null);
  INSERT INTO sport_center.sport_memberships VALUES (99,'2026-10-31','2099-12-31','active');
  INSERT INTO sport_center.gym_x904_member_mapping VALUES (99,'987654','TDBD234200545','verified');
  INSERT INTO sport_center.gym_x904_lan_users VALUES ('TDBD234200545','987654',777,'TEST MEMBER',0);
  INSERT INTO sport_center.sport_membership_payments VALUES (100,99,'2026-10-31','2099-12-31','confirmed',300000);
  INSERT INTO sport_center.sport_bookings VALUES (1,100)`);
  process.env.GYM_X904_AUTOMATIC_COMMANDS_ENABLED="true";
  process.env.GYM_X904_AUTOMATIC_SCOPE="single";
  process.env.GYM_X904_AUTOMATIC_REQUESTED_BY="301";
  process.env.GYM_X904_AUTOMATIC_ALLOWED_PINS="987654";
});
afterAll(async()=>{
  keyBase.forEach((k,i)=>previous[i]===undefined?delete process.env[k]:process.env[k]=previous[i]);
  await pool.end();
});
const cycle=async()=>processX904AutomaticCommands(db as any);
const commands=async()=>Number((await run("SELECT count(*)::int n FROM sport_center.x904_user_commands")).rows[0].n);
const state=async()=>String((await run("SELECT state FROM sport_center.x904_automatic_entitlement_events WHERE membership_id=99")).rows[0]?.state);
test("real PG payment -> one activation -> ACK/readback -> processed; no duplicate", async()=>{
  await run(`INSERT INTO sport_center.gym_x904_access_snapshots(device_serial,observed_at,user_count,users) VALUES ('TDBD234200545',now(),1,jsonb_build_array(jsonb_build_object('pin','987654','name','TEST MEMBER','role',0,'group',2,'enabled',true)))`);
  await run("INSERT INTO sport_center.x904_automatic_entitlement_events(membership_id,payment_id,reason,event_key) VALUES (99,100,'PAYMENT_CONFIRMED','x904-payment-confirmed-100') ON CONFLICT(event_key) DO NOTHING");
  await cycle();
  expect(await commands()).toBe(1);
  expect((await run("SELECT command_type FROM sport_center.x904_user_commands")).rows[0].command_type).toBe("ACTIVATE_USER");
  expect(await state()).toBe("pending");
  await cycle();expect(await commands()).toBe(1);
  await run(`UPDATE sport_center.x904_user_commands SET state='completed',completed_at=now(),result='{"readBackConfirmed":true}'::jsonb WHERE user_pin='987654'`);
  await cycle();expect(await state()).toBe("processed");
  await cycle();expect(await commands()).toBe(1);
});

test("unconfirmed payment never triggers activation", async()=>{
  await run("UPDATE sport_center.sport_membership_payments SET status='pending_payment' WHERE id=100");
  await run("INSERT INTO sport_center.x904_automatic_entitlement_events(membership_id,payment_id,reason,event_key) VALUES (99,101,'PAYMENT_CONFIRMED','test-unconfirmed-101')");
  await cycle();
  expect(await commands()).toBe(1);
  expect((await run("SELECT state FROM sport_center.x904_automatic_entitlement_events WHERE event_key='test-unconfirmed-101'")).rows[0].state).toBe("pending");
});

test("temporary device failure is review_required, never silently retried or duplicated", async()=>{
  await run("DELETE FROM sport_center.x904_automatic_entitlement_events");
  await run("DELETE FROM sport_center.x904_user_commands");
  await run("UPDATE sport_center.sport_membership_payments SET status='confirmed' WHERE id=100");
  await run("INSERT INTO sport_center.x904_automatic_entitlement_events(membership_id,payment_id,reason,event_key) VALUES (99,102,'PAYMENT_CONFIRMED','test-device-busy-102')");
  await cycle();expect(await commands()).toBe(1);
  await run("UPDATE sport_center.x904_user_commands SET state='failed',result=jsonb_build_object('errorCode','DEVICE_TIMEOUT','readBackConfirmed',false)");
  await cycle();
  expect((await run("SELECT state FROM sport_center.x904_automatic_entitlement_events WHERE event_key='test-device-busy-102'")).rows[0].state).toBe("review_required");
  await cycle();expect(await commands()).toBe(1);
});

test("claimed command survives worker retry and final ACK without duplication", async()=>{
  await run("DELETE FROM sport_center.x904_automatic_entitlement_events");
  await run("DELETE FROM sport_center.x904_user_commands");
  await run("INSERT INTO sport_center.x904_automatic_entitlement_events(membership_id,payment_id,reason,event_key) VALUES (99,103,'PAYMENT_CONFIRMED','test-retry-claimed-103')");
  await cycle();expect(await commands()).toBe(1);
  await run("UPDATE sport_center.x904_user_commands SET state='claimed'");
  await cycle();expect(await commands()).toBe(1);
  expect((await run("SELECT state FROM sport_center.x904_automatic_entitlement_events WHERE event_key='test-retry-claimed-103'")).rows[0].state).toBe("pending");
  await run("UPDATE sport_center.x904_user_commands SET state='completed',completed_at=now(),result=jsonb_build_object('readBackConfirmed',true)");
  await cycle();
  expect((await run("SELECT state FROM sport_center.x904_automatic_entitlement_events WHERE event_key='test-retry-claimed-103'")).rows[0].state).toBe("processed");
  expect(await commands()).toBe(1);
});

test("DEVICE_BUSY retries once after cooldown and fresh Group 2 readback", async()=>{
  await run("DELETE FROM sport_center.x904_automatic_entitlement_events");
  await run("DELETE FROM sport_center.x904_user_commands");
  await run("INSERT INTO sport_center.x904_automatic_entitlement_events(membership_id,payment_id,reason,event_key) VALUES (99,104,'PAYMENT_CONFIRMED','test-retry-busy-104')");
  await cycle();expect(await commands()).toBe(1);
  await run("UPDATE sport_center.x904_user_commands SET state='failed',completed_at=now()-interval '2 minutes',result=jsonb_build_object('errorCode','DEVICE_BUSY','readBackConfirmed',false)");
  await run(`INSERT INTO sport_center.gym_x904_access_snapshots(device_serial,observed_at,user_count,users) VALUES ('TDBD234200545',now(),1,jsonb_build_array(jsonb_build_object('pin','987654','name','TEST MEMBER','role',0,'group',2,'enabled',true)))`);
  await cycle();expect(await commands()).toBe(2);
  expect((await run("SELECT count(DISTINCT idempotency_key)::int n FROM sport_center.x904_user_commands")).rows[0].n).toBe(2);
  await cycle();expect(await commands()).toBe(2);
  await run("UPDATE sport_center.x904_user_commands SET state='completed',completed_at=now(),result=jsonb_build_object('readBackConfirmed',true) WHERE state='queued'");
  await cycle();
  expect((await run("SELECT state FROM sport_center.x904_automatic_entitlement_events WHERE event_key='test-retry-busy-104'")).rows[0].state).toBe("processed");
});

test("DEVICE_BUSY exhausts three attempts and requires review", async()=>{
  await run("DELETE FROM sport_center.x904_automatic_entitlement_events");
  await run("DELETE FROM sport_center.x904_user_commands");
  await run("INSERT INTO sport_center.x904_automatic_entitlement_events(membership_id,payment_id,reason,event_key) VALUES (99,105,'PAYMENT_CONFIRMED','test-busy-limit-105')");
  await cycle();
  for(let n=1;n<=3;n++){
    await run("UPDATE sport_center.x904_user_commands SET state='failed',completed_at=now()-interval '2 minutes',result=jsonb_build_object('errorCode','DEVICE_BUSY','readBackConfirmed',false) WHERE state='queued'");
    await run(`INSERT INTO sport_center.gym_x904_access_snapshots(device_serial,observed_at,user_count,users) VALUES ('TDBD234200545',now(),1,jsonb_build_array(jsonb_build_object('pin','987654','name','TEST MEMBER','role',0,'group',2,'enabled',true)))`);
    await cycle();
    expect(await commands()).toBe(n<3?n+1:3);
  }
  expect((await run("SELECT state FROM sport_center.x904_automatic_entitlement_events WHERE event_key='test-busy-limit-105'")).rows[0].state).toBe("review_required");
});
