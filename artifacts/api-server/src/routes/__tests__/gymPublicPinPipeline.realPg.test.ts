import {
  jest,
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  test,
  expect,
} from "@jest/globals";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { SQL } from "drizzle-orm";
import pg from "pg";
import { readFileSync } from "node:fs";
import { processX904NonmemberDailyAccess } from "../../services/x904NonmemberDailyAccessWorker";
import {
  pool as appPool,
  db, usersTable, settingsTable, paymentSettlementConfigsTable, facilityCompanyMappingsTable,
  facilitiesTable,
  bookingsTable,
  paymentsTable,
  bookingHistoryTable,
  waActionTokensTable,
  auditLogsTable,
} from "@workspace/db";

// Real multipart checkout, identity lookup, payment enrichment, HTTP payment
// confirmation, payment-to-grant trigger, mandatory audit, PIN approval and worker.
// The application connects as sport_center_app (no superuser or RLS bypass).
// External OCR, blob storage, transport and accounting projection/startup are stubs.
// Device ACKs and snapshots are simulated fixtures, never physical-device evidence.
// This suite refuses DEV/PROD: explicitly disposable localhost databases only.
const url = process.env.GYM_PIN_PIPELINE_PG_URL;
const suite = url ? describe : describe.skip;
if (url && (!/^postgresql:\/\/postgres:[^@]+@127\.0\.0\.1:55444\/pin700_pipeline_isolated$/.test(url)
 || !/^postgresql:\/\/sport_center_app:[^@]+@127\.0\.0\.1:55444\/pin700_pipeline_isolated$/.test(process.env.SUPABASE_DATABASE_URL_DEV || '')
 || process.env.NODE_ENV !== 'test')) throw new Error('ISOLATED_PIN_PIPELINE_REQUIRED');
const pool = new pg.Pool({connectionString:url,max:3});
suite("PIN payment and access pipeline: real HTTP, triggers, RLS and worker", () => {
  let request: any;
  let storageFailure = false;
  let scanAmount = 30000;
  let storageCalls = 0;
  let order = 0;
  const today = '2026-11-10';
  const clock = new Date('2026-11-10T01:00:00Z');
  let token = '';
  let adminToken = '';
  let disabledToken = '';
  let demotedToken = '';
  const clockOptions = { doNotFake: ['nextTick','performance','hrtime','queueMicrotask','setImmediate','clearImmediate','setInterval','clearInterval','setTimeout','clearTimeout'] as any };
  const quote = (v: unknown) => "'" + String(v).replace(/'/g, "''") + "'";
  const ident = (v: string) => '"' + v.replace(/"/g, '""') + '"';
  const dialect = new PgDialect();
  async function makeTable(table: any) {
    const cfg = getTableConfig(table);
    const columns = [];
    for (const c of cfg.columns as any[]) {
      let type = c.getSQLType();
      if (c.enum) {
        const en = c.enum;
        const name = `${ident(en.schema || "sport_center")}.${ident(en.enumName)}`;
        await pool.query(
          `DO $$ BEGIN CREATE TYPE ${name} AS ENUM (${en.enumValues.map(quote).join(",")}); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
        );
        type = name;
      }
      let def = "";
      if (c.default !== undefined) {
        if (c.default instanceof SQL) def = dialect.sqlToQuery(c.default).sql;
        else if (
          typeof c.default === "boolean" ||
          typeof c.default === "number"
        )
          def = String(c.default);
        else if (typeof c.default === "object")
          def = quote(JSON.stringify(c.default)) + "::jsonb";
        else def = quote(c.default);
      }
      columns.push(
        `${ident(c.name)} ${type}${c.notNull ? " NOT NULL" : ""}${def ? " DEFAULT " + def : ""}${c.primary ? " PRIMARY KEY" : ""}${c.isUnique ? " UNIQUE" : ""}`,
      );
    }
    await pool.query(
      `CREATE TABLE ${ident(cfg.schema!)}.${ident(cfg.name)} (${columns.join(",")})`,
    );
  }
  beforeAll(async () => {
    const exists = await pool.query(
      "SELECT to_regnamespace('sport_center') AS existing",
    );
    if (exists.rows[0].existing)
      throw new Error("ISOLATED_CHECKOUT_DATABASE_MUST_BE_EMPTY");
    await pool.query("CREATE SCHEMA sport_center");
    for (const t of [
      usersTable, settingsTable, paymentSettlementConfigsTable, facilityCompanyMappingsTable,
      facilitiesTable,
      bookingsTable,
      paymentsTable,
      bookingHistoryTable,
      waActionTokensTable,
      auditLogsTable,
    ])
      await makeTable(t);
    await pool.query(`CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE ROLE sport_center_app LOGIN PASSWORD 'pipeline_local_only' NOSUPERUSER NOBYPASSRLS;
      CREATE TABLE public.companies(id int primary key,code text,name text,company_name text,is_active boolean);
      INSERT INTO public.companies VALUES(5,'CST','TEST MERCHANT','TEST MERCHANT',true);
      INSERT INTO sport_center.sport_settings(bank_account,app_url) VALUES('TEST-ACCOUNT','https://isolated.invalid');
      INSERT INTO sport_center.facility_company_mappings(facility_id,company_id,effective_from) VALUES(6,5,'2026-01-01');
      ALTER TABLE sport_center.payment_settlement_configs ADD COLUMN mdr_rate numeric DEFAULT 0, ADD COLUMN fixed_provider_fee numeric DEFAULT 0, ADD COLUMN fee_tax_rate numeric DEFAULT 0, ADD COLUMN rule_version text DEFAULT 'ISOLATED', ADD COLUMN calculation_method text DEFAULT 'percentage_of_gross';
      INSERT INTO sport_center.payment_settlement_configs(company_id,provider_code,bank_account_id,effective_from) VALUES(5,'mandiri_direct','TEST-ACCOUNT','2026-01-01');
      CREATE TABLE sport_center.payment_business_calendar(calendar_date date,is_business_day boolean);
      CREATE SEQUENCE sport_center.booking_order_no_seq START WITH 9000;
      CREATE TABLE sport_center.gym_x904_lan_users(device_serial text,user_pin text,device_uid int,display_name text,device_role int);
      INSERT INTO sport_center.gym_x904_lan_users VALUES('TDBD234200545','700',343,'TEST AUTO SUSPEND',0);
      CREATE TABLE sport_center.gym_x904_member_mapping(membership_id int,user_pin text,device_serial text,status text);
      CREATE TABLE sport_center.sport_memberships(id int,status text,start_date text,end_date text);
      CREATE TABLE sport_center.gym_x904_access_snapshots(snapshot_id bigserial primary key,device_serial text,observed_at timestamptz,user_count int,users jsonb);
      CREATE TABLE sport_center.x904_user_commands(command_id uuid primary key default gen_random_uuid(),device_serial text,command_type text,user_pin text,payload jsonb,requested_by bigint,idempotency_key text unique,attempts int default 0,state text default 'queued',result jsonb,created_at timestamptz default now(),completed_at timestamptz,lease_token uuid,leased_until timestamptz);
      CREATE UNIQUE INDEX one_active_command ON sport_center.x904_user_commands(device_serial,user_pin) WHERE state IN ('queued','claimed');
      ALTER TABLE sport_center.sport_payments ADD FOREIGN KEY(booking_id) REFERENCES sport_center.sport_bookings(id);
      INSERT INTO sport_center.sport_facilities(id,name,category,price_per_hour,open_time,close_time,min_duration,booking_mode,is_active) VALUES(6,'Gym / Fitness Center','Gym',30000,'06:00','23:00',1,'walk_in',true);
      INSERT INTO sport_center.users(id,name,role,account_status,registration_source) VALUES
        (301,'X904 AUTOMATION SERVICE','staff','inactive','system_x904_automation'),
        (302,'TEST OPERATOR','staff','active','test'),(303,'TEST FINANCE','finance','active','test'),
        (304,'TEST DISABLED','staff','inactive','test'),(305,'TEST DEMOTED','customer','active','test');`);
    for (const file of ['20261031_x904_nonmember_daily_access.sql','20261102_x904_nonmember_verified_activation_clock.sql','20261105_x904_nonmember_2300_wib_cutoff.sql','20261107_x904_review_required_not_live.sql','20261106_x904_guest_pin_payment_review_guard.sql']) {
      await pool.query(readFileSync('migrations/'+file,'utf8'));
    }
    await pool.query(readFileSync('sql/x904_verified_nonmember_identities.sql','utf8').split('-- Preserve the three')[0]);
    await pool.query(`INSERT INTO sport_center.x904_verified_nonmember_identities(device_serial,user_pin,device_uid,display_name,verification_state,verified_by,verified_at) VALUES('TDBD234200545','700',343,'TEST AUTO SUSPEND','verified','isolated-fixture',now());
      GRANT USAGE ON SCHEMA sport_center,public TO sport_center_app;
      GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA sport_center TO sport_center_app;
      GRANT SELECT ON public.companies TO sport_center_app;
      GRANT USAGE,SELECT,UPDATE ON ALL SEQUENCES IN SCHEMA sport_center TO sport_center_app;
      REVOKE INSERT ON sport_center.x904_verified_nonmember_identities FROM sport_center_app;
      CREATE POLICY gym_nonmember_registry_backend_read ON sport_center.x904_verified_nonmember_identities FOR SELECT TO sport_center_app USING(true);
      CREATE POLICY x904_nonmember_app_select ON sport_center.x904_nonmember_daily_access FOR SELECT TO sport_center_app USING(device_serial='TDBD234200545');
      CREATE POLICY x904_nonmember_app_update ON sport_center.x904_nonmember_daily_access FOR UPDATE TO sport_center_app USING(device_serial='TDBD234200545') WITH CHECK(device_serial='TDBD234200545');`);
    for (const file of ['20261109_x904_verified_registry_for_share_rls.sql','20261109_x904_public_pin_review_insert_rls.sql']) await pool.query(readFileSync('migrations/'+file,'utf8'));
    for(const table of ['sport_bookings','sport_payments','users','audit_logs','booking_history','wa_action_tokens']) {
      await pool.query(`ALTER TABLE sport_center.${table} ENABLE ROW LEVEL SECURITY; CREATE POLICY sport_center_app_backend ON sport_center.${table} FOR ALL TO sport_center_app USING(true) WITH CHECK(true)`);
    }
    jest.useFakeTimers(clockOptions); jest.setSystemTime(clock);
    process.env.GYM_X904_NONMEMBER_ACCESS_ENABLED='true';process.env.GYM_X904_MANUAL_ACCESS_ENABLED='true';process.env.GYM_X904_USER_WRITE_ENABLED='true';process.env.GYM_X904_AUTOMATIC_REQUESTED_BY='301';process.env.GYM_X904_NONMEMBER_ONLY_PIN='700';
    const notifications = await import("../../lib/notifications.js");
    jest.unstable_mockModule("../../lib/notifications.js", () =>
      Object.fromEntries(
        Object.entries(notifications).map(([k, v]) => [
          k,
          typeof v === "function" ? jest.fn(async () => undefined) : v,
        ]),
      ),
    );
    const ocr = await import("../../lib/paymentProofOcr.js");
    jest.unstable_mockModule("../../lib/paymentProofOcr.js", () => ({
      ...ocr,
      scanPaymentProof: jest.fn(async () => ({
        amount: scanAmount,
        name: "TEST PAYER",
        date: today,
        rawText: "ISOLATED TEST ONLY",
        paymentMethod: "QRIS",
        confidence: 1,
        signals: [],
        recipient: "TEST MERCHANT",
        engine: "isolated-stub",
        scannedAt: new Date().toISOString(),
      })),
    }));
    const storage = await import("../storage.js");
    jest.unstable_mockModule("../storage.js", () => ({
      ...storage,
      uploadProofWithFallback: jest.fn(async () => {
        storageCalls++;
        if (storageFailure) throw new Error("INJECTED_BLOB_FAILURE");
        return "https://isolated.invalid/payment-proof.jpeg";
      }),
    }));
    const realtime = await import("../../lib/supabase.js");
    jest.unstable_mockModule("../../lib/supabase.js", () => ({
      ...realtime,
      broadcastAvailabilityChange: jest.fn(async () => undefined),
    }));
    // Boundary exclusions: canonical accounting startup/projection, transport and files.
    // Actual payment route, enrichment, booking update, payment->grant trigger, PIN approval and worker are NOT mocked.
    jest.unstable_mockModule('../../lib/paymentMirrorMigration.js',()=>({assertPaymentMirrorMigrationReady:()=>undefined}));
    const accounting=await import('../../lib/accounting.js');
    jest.unstable_mockModule('../../lib/accounting.js',()=>({...accounting,postConfirmedPaymentAccounting:jest.fn(async()=>undefined)}));
    for(const module of ['../../lib/bizportalSync.js','../../lib/invoiceDelivery.js','../../lib/rekapPemakaian.js']) {
      const real=await import(module);jest.unstable_mockModule(module,()=>Object.fromEntries(Object.entries(real).map(([k,v])=>[k,typeof v==='function'?jest.fn(async()=>undefined):v])));
    }
    const { default: express } = await import("express");
    const { default: supertest } = await import("supertest");
    const { default: router } = await import("../whatsapp.js");
    const app = express();
    app.use(express.json());
    app.use("/api", router);
    const {default: payments}=await import('../payments.js');app.use('/api',payments);
    const {default: bookings}=await import('../bookings.js');app.use('/api',bookings);
    const {createToken}=await import('../../lib/auth.js');
    token=createToken(302,'staff');adminToken=createToken(303,'finance');disabledToken=createToken(304,'staff');demotedToken=createToken(305,'staff');
    request = supertest(app);
  }, 30000);
  afterAll(async () => {
    jest.useRealTimers(); await appPool.end(); await pool.end();
  });
  beforeEach(async()=>{
    jest.setSystemTime(clock);storageFailure=false;scanAmount=30000;storageCalls=0;
    await pool.query('TRUNCATE sport_center.sport_bookings CASCADE; TRUNCATE sport_center.booking_history,sport_center.wa_action_tokens,sport_center.audit_logs,sport_center.x904_user_commands,sport_center.gym_x904_access_snapshots');
  });
  function submit(attach = true, bookingDate = today) {
    let r = request
      .post("/api/wa/booking")
      .field("customerName", "TEST AUTO SUSPEND")
      .field("customerPhone", "628111222333")
      .field("facilityId", "6")
      .field("bookingDate", bookingDate)
      .field("startTime", "08:00")
      .field("durationHours", "1")
      .field("publicGymGuest", "true")
      .field("paymentMethod", "qris");
    if (attach)
      r = r.attach("proof", Buffer.from([255, 216, 255, 217]), {
        filename: "isolated.jpeg",
        contentType: "image/jpeg",
      });
    return r;
  }
  async function counts() {
    return (
      await pool.query(
        `SELECT (SELECT count(*)::int FROM sport_center.sport_bookings) bookings,(SELECT count(*)::int FROM sport_center.sport_payments) payments,(SELECT count(*)::int FROM sport_center.x904_nonmember_daily_access) grants`,
      )
    ).rows[0];
  }
  const attest={identityChecked:true,officialFundsChecked:true,officialBankReference:'ISOLATED-RECEIPT-700'};
  async function checkout(){ const r=await submit(); expect(r.status).toBe(201); return r.body.id as number; }
  async function payment(id:number){return (await pool.query('SELECT id,status FROM sport_center.sport_payments WHERE booking_id=$1',[id])).rows[0];}
  async function confirm(id:number){const p=await payment(id);const r=await request.patch('/api/payments/'+p.id).set('Authorization','Bearer '+adminToken).send({status:'confirmed'});expect(r.status).toBe(200);return p.id;}
  async function approve(id:number,t=token){return request.post(`/api/bookings/${id}/x904-guest-pin-approve`).set('Authorization','Bearer '+t).send(attest);}
  async function grant(id:number){return (await pool.query('SELECT * FROM sport_center.x904_nonmember_daily_access WHERE booking_id=$1',[id])).rows[0];}
  async function snapshot(at:Date,group:number){await pool.query(`INSERT INTO sport_center.gym_x904_access_snapshots(device_serial,observed_at,user_count,users) VALUES('TDBD234200545',$1,1,$2)`,[at,JSON.stringify([{pin:'700',name:'TEST AUTO SUSPEND',role:0,group,enabled:true}])]);}
  async function commands(){return (await pool.query('SELECT * FROM sport_center.x904_user_commands ORDER BY created_at,command_id')).rows;}
  const tick=(at:Date)=>processX904NonmemberDailyAccess(db as any,at);
  test('application role is not owner/superuser and registry UPDATE remains denied',async()=>{
    const r=await appPool.query('SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');expect(r.rows[0]).toEqual({current_user:'sport_center_app',rolsuper:false,rolbypassrls:false});
    await expect(appPool.query("UPDATE sport_center.x904_verified_nonmember_identities SET display_name='FORBIDDEN' WHERE user_pin='700'")).rejects.toHaveProperty('code','42501');
  });
  test('audit failure must roll back PIN authorization, not return success',async()=>{
    const id=await checkout();await confirm(id);
    await pool.query("ALTER TABLE sport_center.audit_logs ADD CONSTRAINT injected_audit_failure CHECK (action <> 'x904_guest_pin_staff_attestation')");
    try {const r=await approve(id);expect(r.status).toBe(500);expect(await grant(id)).toMatchObject({verification_state:'review_required',access_state:'review_required'});expect(await commands()).toHaveLength(0);}
    finally{await pool.query('ALTER TABLE sport_center.audit_logs DROP CONSTRAINT injected_audit_failure');}
  });
  test.each(['disabled','demoted'])('%s operator token cannot authorize PIN',async(kind)=>{
    const id=await checkout();await confirm(id);const r=await approve(id,kind==='disabled'?disabledToken:demotedToken);expect(r.status).toBe(401);expect(await grant(id)).toMatchObject({verification_state:'review_required'});
  });
  test('retry after committed approval returns the same state and one audit',async()=>{
    const id=await checkout();await confirm(id);expect((await approve(id)).status).toBe(200);const again=await approve(id);expect(again.status).toBe(200);expect(again.body.idempotent).toBe(true);
    expect((await pool.query("SELECT count(*)::int n FROM sport_center.audit_logs WHERE action='x904_guest_pin_staff_attestation' AND entity_id=$1",[id])).rows[0].n).toBe(1);
  });
  test('booking -> pending proof -> payment HTTP confirmation -> held grant -> staff -> worker activation ACK -> scheduled suspend ACK',async()=>{
    const id=await checkout();expect(await grant(id)).toMatchObject({access_state:'review_required',payment_id:null});
    await snapshot(new Date(clock.getTime()-1000),2);await tick(clock);expect(await commands()).toHaveLength(0);
    const pay=await confirm(id);expect(await grant(id)).toMatchObject({payment_id:pay,access_state:'review_required',verification_state:'review_required'});
    await tick(clock);expect(await commands()).toHaveLength(0);
    expect((await approve(id)).status).toBe(200);await tick(clock);await tick(clock);
    const [activate]=await commands();expect(activate.command_type).toBe('ACTIVATE_USER');expect(activate.payload).toMatchObject({accessId:Number((await grant(id)).access_id),expectedUid:343});expect(await commands()).toHaveLength(1);
    expect((await grant(id)).access_state).not.toBe('active');
    // Hardware boundary: deliberately wrong UID must never open the application gate.
    const ackAt=new Date(clock.getTime()+10000);
    await pool.query("UPDATE sport_center.x904_user_commands SET state='completed',completed_at=$2,result=$3 WHERE command_id=$1",[activate.command_id,ackAt,JSON.stringify({readBackConfirmed:true,deviceUid:999,afterGroup:1})]);
    await snapshot(new Date(ackAt.getTime()+1000),1);await tick(new Date(ackAt.getTime()+2000));expect((await grant(id)).access_state).not.toBe('active');
    await pool.query('UPDATE sport_center.x904_user_commands SET result=$2 WHERE command_id=$1',[activate.command_id,JSON.stringify({readBackConfirmed:true,deviceUid:343,afterGroup:1})]);
    await tick(new Date(ackAt.getTime()+3000));expect(await grant(id)).toMatchObject({access_state:'active',activated_at:ackAt});
    const expiry=new Date((await grant(id)).expires_at);expect(expiry.getTime()-ackAt.getTime()).toBe(12*3600000);
    await snapshot(new Date(expiry.getTime()+1000),1);await tick(new Date(expiry.getTime()+2000));await tick(new Date(expiry.getTime()+2000));
    const susp=(await commands()).find((c:any)=>c.command_type==='SUSPEND_USER');expect(susp).toBeDefined();expect(await commands()).toHaveLength(2);
    await pool.query("UPDATE sport_center.x904_user_commands SET state='completed',completed_at=$2,result=$3 WHERE command_id=$1",[susp.command_id,new Date(expiry.getTime()+3000),JSON.stringify({readBackConfirmed:true,deviceUid:343,afterGroup:2})]);
    await snapshot(new Date(expiry.getTime()+4000),2);await tick(new Date(expiry.getTime()+5000));expect((await grant(id)).access_state).toBe('expired');
  });
});
