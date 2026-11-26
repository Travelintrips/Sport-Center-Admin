import {
  jest,
  beforeAll,
  afterAll,
  afterEach,
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
  db,
  usersTable,
  settingsTable,
  paymentSettlementConfigsTable,
  facilityCompanyMappingsTable,
  facilitiesTable,
  bookingsTable,
  paymentsTable,
  bookingHistoryTable,
  rescheduleRequestsTable,
  usageProofsTable,
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
if (
  url &&
  (!/^postgresql:\/\/postgres:[^@]+@127\.0\.0\.1:55444\/pin700_pipeline_isolated$/.test(
    url,
  ) ||
    !/^postgresql:\/\/sport_center_app:[^@]+@127\.0\.0\.1:55444\/pin700_pipeline_isolated$/.test(
      process.env.SUPABASE_DATABASE_URL_DEV || "",
    ) ||
    process.env.NODE_ENV !== "test")
)
  throw new Error("ISOLATED_PIN_PIPELINE_REQUIRED");
const pool = new pg.Pool({ connectionString: url, max: 3 });
suite(
  "PIN payment and access pipeline: real HTTP, triggers, RLS and worker",
  () => {
    let request: any;
    let storageFailure = false;
    let scanAmount = 30000;
    let storageCalls = 0;
    const today = "2026-11-10";
    const clock = new Date("2026-11-10T01:00:00Z");
    let token = "";
    let adminToken = "";
    let disabledToken = "";
    let demotedToken = "";
    const clockOptions = {
      doNotFake: [
        "nextTick",
        "performance",
        "hrtime",
        "queueMicrotask",
        "setImmediate",
        "clearImmediate",
        "setInterval",
        "clearInterval",
        "setTimeout",
        "clearTimeout",
      ] as any,
    };
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
        usersTable,
        settingsTable,
        paymentSettlementConfigsTable,
        facilityCompanyMappingsTable,
        facilitiesTable,
        bookingsTable,
        paymentsTable,
        bookingHistoryTable,
        rescheduleRequestsTable,
        usageProofsTable,
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
      CREATE TABLE sport_center.gym_x904_lan_logs(device_serial text,user_pin text,device_uid int,device_time text,event_id text,event_index int,last_seen_snapshot uuid DEFAULT '00000000-0000-4000-8000-000000000001',received_at timestamptz DEFAULT now());
      CREATE TABLE sport_center.gym_x904_lan_state(device_serial text,last_snapshot_id uuid,last_complete_at timestamptz,stored_log_count int DEFAULT 0,device_log_count int DEFAULT 0,user_count int DEFAULT 0);
      INSERT INTO sport_center.gym_x904_lan_state(device_serial,last_snapshot_id,last_complete_at) VALUES('TDBD234200545','00000000-0000-4000-8000-000000000001',now());
      CREATE TABLE sport_center.gym_x904_connector_heartbeats(device_serial text,connector_id text,last_seen timestamptz,reported_logs int,reported_users int,read_authenticated boolean);
      CREATE TABLE sport_center.gym_x904_verification_evidence(device_serial text,event_index int,user_pin text,source_event_id text,capture_source text,evidence_status text,verification_code int,raw_hex text);
      CREATE TABLE sport_center.gym_x904_raw_events(event_id text,device_serial text,user_pin text,device_time text,attendance_status int,verification_type int);
      CREATE TABLE sport_center.gym_vis_card_reservations(booking_id int,payment_id int,device_serial text,user_pin text,device_uid int,card_code text,state text,collected_at timestamptz,funds_verified_at timestamptz,funds_reference text,reserved_at timestamptz);
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
        (304,'TEST DISABLED','staff','inactive','test'),(305,'TEST DEMOTED','customer','active','test'),
        (306,'TEST BOOKING ADMIN','admin','active','test'),
        (307,'TEST FIELD BOOKING ADMIN','admin_booking','active','test');`);
      for (const file of [
        "20261031_x904_nonmember_daily_access.sql",
        "20261102_x904_nonmember_verified_activation_clock.sql",
        "20261105_x904_nonmember_2300_wib_cutoff.sql",
        "20261116_x904_gym_day_admission_clock.sql",
        "20261107_x904_review_required_not_live.sql",
        "20261106_x904_guest_pin_payment_review_guard.sql",
        "20261116_x904_verified_self_pin_auto_payment.sql",
      ]) {
        await pool.query(readFileSync("migrations/" + file, "utf8"));
      }
      await pool.query(
        readFileSync(
          "sql/x904_verified_nonmember_identities.sql",
          "utf8",
        ).split("-- Preserve the three")[0],
      );
      await pool.query(`INSERT INTO sport_center.x904_verified_nonmember_identities(device_serial,user_pin,device_uid,display_name,verification_state,verified_by,verified_at) VALUES('TDBD234200545','700',343,'TEST AUTO SUSPEND','verified','isolated-fixture',now());
      GRANT USAGE ON SCHEMA sport_center,public TO sport_center_app;
      GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA sport_center TO sport_center_app;
      ALTER TABLE sport_center.gym_x904_lan_logs ENABLE ROW LEVEL SECURITY;
      CREATE POLICY x904_ci_app_read ON sport_center.gym_x904_lan_logs FOR SELECT TO sport_center_app USING(device_serial='TDBD234200545');
      ALTER TABLE sport_center.gym_x904_lan_state ENABLE ROW LEVEL SECURITY;
      CREATE POLICY x904_ci_state_read ON sport_center.gym_x904_lan_state FOR SELECT TO sport_center_app USING(device_serial='TDBD234200545');
      ALTER TABLE sport_center.gym_x904_connector_heartbeats ENABLE ROW LEVEL SECURITY;
      CREATE POLICY x904_ci_heartbeat_read ON sport_center.gym_x904_connector_heartbeats FOR SELECT TO sport_center_app USING(device_serial='TDBD234200545');
      ALTER TABLE sport_center.reschedule_requests ENABLE ROW LEVEL SECURITY;
      CREATE POLICY x904_ci_reschedule_read ON sport_center.reschedule_requests FOR SELECT TO sport_center_app USING(true);
      GRANT SELECT ON public.companies TO sport_center_app;
      GRANT USAGE,SELECT,UPDATE ON ALL SEQUENCES IN SCHEMA sport_center TO sport_center_app;
      REVOKE INSERT ON sport_center.x904_verified_nonmember_identities FROM sport_center_app;
      CREATE POLICY gym_nonmember_registry_backend_read ON sport_center.x904_verified_nonmember_identities FOR SELECT TO sport_center_app USING(true);
      CREATE POLICY x904_nonmember_app_select ON sport_center.x904_nonmember_daily_access FOR SELECT TO sport_center_app USING(device_serial='TDBD234200545');
      CREATE POLICY x904_nonmember_app_update ON sport_center.x904_nonmember_daily_access FOR UPDATE TO sport_center_app USING(device_serial='TDBD234200545') WITH CHECK(device_serial='TDBD234200545');`);
      for (const file of [
        "20261109_x904_verified_registry_for_share_rls.sql",
        "20261109_x904_public_pin_review_insert_rls.sql",
        "20261116_x904_paid_guest_pin_recovery_rls.sql",
        "20261116_x904_self_pin_insert_rls.sql",
      ])
        await pool.query(readFileSync("migrations/" + file, "utf8"));
      for (const table of [
        "sport_bookings",
        "sport_payments",
        "users",
        "audit_logs",
        "booking_history",
        "wa_action_tokens",
      ]) {
        await pool.query(
          `ALTER TABLE sport_center.${table} ENABLE ROW LEVEL SECURITY; CREATE POLICY sport_center_app_backend ON sport_center.${table} FOR ALL TO sport_center_app USING(true) WITH CHECK(true)`,
        );
      }
      jest.useFakeTimers(clockOptions);
      jest.setSystemTime(clock);
      process.env.GYM_X904_NONMEMBER_ACCESS_ENABLED = "true";
      process.env.GYM_X904_MANUAL_ACCESS_ENABLED = "true";
      process.env.GYM_X904_USER_WRITE_ENABLED = "true";
      process.env.GYM_X904_AUTOMATIC_REQUESTED_BY = "301";
      process.env.GYM_X904_NONMEMBER_ONLY_PIN = "700";
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
      jest.unstable_mockModule("../../lib/paymentMirrorMigration.js", () => ({
        assertPaymentMirrorMigrationReady: () => undefined,
      }));
      const accounting = await import("../../lib/accounting.js");
      jest.unstable_mockModule("../../lib/accounting.js", () => ({
        ...accounting,
        postConfirmedPaymentAccounting: jest.fn(async () => undefined),
      }));
      for (const module of [
        "../../lib/bizportalSync.js",
        "../../lib/invoiceDelivery.js",
        "../../lib/rekapPemakaian.js",
      ]) {
        const real = await import(module);
        jest.unstable_mockModule(module, () =>
          Object.fromEntries(
            Object.entries(real).map(([k, v]) => [
              k,
              typeof v === "function" ? jest.fn(async () => undefined) : v,
            ]),
          ),
        );
      }
      const { default: express } = await import("express");
      const { default: supertest } = await import("supertest");
      const { default: router } = await import("../whatsapp.js");
      const app = express();
      app.use(express.json());
      app.use((req: any, _res: any, next: any) => {
        req.log = { info: () => undefined, warn: () => undefined, error: (...details: unknown[]) => console.error("[isolated route error]", ...details) };
        next();
      });
      app.use("/api", router);
      const { default: payments } = await import("../payments.js");
      app.use("/api", payments);
      const { default: bookings } = await import("../bookings.js");
      app.use("/api", bookings);
      const { default: waBookingsAdmin } = await import("../waBookingsAdmin.js");
      app.use("/api", waBookingsAdmin);
      const { createToken } = await import("../../lib/auth.js");
      token = createToken(302, "staff");
      adminToken = createToken(303, "finance");
      disabledToken = createToken(304, "staff");
      demotedToken = createToken(305, "staff");
      request = supertest(app);
    }, 30000);
    afterAll(async () => {
      jest.useRealTimers();
      await appPool.end();
      await pool.end();
    });
    beforeEach(async () => {
      jest.setSystemTime(clock);
      storageFailure = false;
      scanAmount = 30000;
      storageCalls = 0;
      await pool.query(
        "TRUNCATE sport_center.sport_bookings CASCADE; TRUNCATE sport_center.booking_history,sport_center.wa_action_tokens,sport_center.audit_logs,sport_center.x904_user_commands,sport_center.gym_x904_access_snapshots",
      );
      await pool.query("TRUNCATE sport_center.gym_x904_connector_heartbeats");
      await pool.query("UPDATE sport_center.gym_x904_lan_state SET last_complete_at=now(),stored_log_count=0,device_log_count=0,user_count=0");
    });
    async function submit(attach = true, bookingDate = today, customerName = "TEST AUTO SUSPEND", machinePin = "", snapshotReady = true) {
      // The frontend only accepts booking when the inventory is freshly read.
      // Clear fixture afterward to exercise separate payment-time and worker
      // liveness gates independently (including collector interruption).
      if (snapshotReady) await snapshot(new Date(Date.now()-1000),2);
      let r = request
        .post("/api/wa/booking")
        .field("customerName", customerName)
        .field("customerPhone", "628111222333")
        .field("facilityId", "6")
        .field("bookingDate", bookingDate)
        .field("startTime", "08:00")
        .field("durationHours", "1")
        .field("publicGymGuest", "true")
        .field("paymentMethod", "qris");
      if (machinePin) r=r.field("requestedX904Pin",machinePin);
      if (attach)
        r = r.attach("proof", Buffer.from([255, 216, 255, 217]), {
          filename: "isolated.jpeg",
          contentType: "image/jpeg",
        });
      const result=await r;
      if(snapshotReady) await pool.query("TRUNCATE sport_center.gym_x904_access_snapshots");
      return result;
    }
    async function counts() {
      return (
        await pool.query(
          `SELECT (SELECT count(*)::int FROM sport_center.sport_bookings) bookings,(SELECT count(*)::int FROM sport_center.sport_payments) payments,(SELECT count(*)::int FROM sport_center.x904_nonmember_daily_access) grants`,
        )
      ).rows[0];
    }
    const attest = {
      identityChecked: true,
      officialFundsChecked: true,
      officialBankReference: "ISOLATED-RECEIPT-700",
    };
    async function checkout() {
      const r = await submit();
      expect(r.status).toBe(201);
      return r.body.id as number;
    }
    async function payment(id: number) {
      return (
        await pool.query(
          "SELECT id,status FROM sport_center.sport_payments WHERE booking_id=$1",
          [id],
        )
      ).rows[0];
    }
    async function confirm(id: number) {
      const p = await payment(id);
      const r = await request
        .patch("/api/payments/" + p.id)
        .set("Authorization", "Bearer " + adminToken)
        .send({ status: "confirmed" });
      expect(r.status).toBe(200);
      return p.id;
    }
    async function approve(id: number, t = token) {
      return request
        .post(`/api/bookings/${id}/x904-guest-pin-approve`)
        .set("Authorization", "Bearer " + t)
        .send(attest);
    }
    async function grant(id: number) {
      return (
        await pool.query(
          "SELECT * FROM sport_center.x904_nonmember_daily_access WHERE booking_id=$1",
          [id],
        )
      ).rows[0];
    }
    async function snapshot(at: Date, group: number) {
      await pool.query(
        `INSERT INTO sport_center.gym_x904_access_snapshots(device_serial,observed_at,user_count,users) VALUES('TDBD234200545',$1,1,$2)`,
        [
          at,
          JSON.stringify([
            {
              pin: "700",
              name: "TEST AUTO SUSPEND",
              role: 0,
              group,
              enabled: true,
            },
          ]),
        ],
      );
    }
    async function commands() {
      return (
        await pool.query(
          "SELECT * FROM sport_center.x904_user_commands ORDER BY created_at,command_id",
        )
      ).rows;
    }
    const tick = (at: Date) => processX904NonmemberDailyAccess(db as any, at);
    test("application role is not owner/superuser and registry UPDATE remains denied", async () => {
      const r = await appPool.query(
        "SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
      );
      expect(r.rows[0]).toEqual({
        current_user: "sport_center_app",
        rolsuper: false,
        rolbypassrls: false,
      });
      await expect(
        appPool.query(
          "UPDATE sport_center.x904_verified_nonmember_identities SET display_name='FORBIDDEN' WHERE user_pin='700'",
        ),
      ).rejects.toHaveProperty("code", "42501");
    });
    test.each([
      "TEST AUTO SUSPEND AULIA",
      "TEST AUTO",
    ])("near-matching machine name %s cannot create a paid booking or silently use VIS",async enteredName=>{
      // Reproduce SC-1793's name-change timing: the user types a longer or
      // shorter name before the machine inventory has been renamed.
      const result=await submit(true,today,enteredName);
      expect(result.status).toBe(409);
      expect(String(result.body.error)).toContain("Nama mirip");
      expect(await counts()).toMatchObject({bookings:0,payments:0,grants:0});
      expect(await commands()).toHaveLength(0);
    });
    test("registered PIN absent from newest X904 snapshot cannot create a paid booking", async()=>{
      await pool.query("TRUNCATE sport_center.gym_x904_access_snapshots");
      const result=await submit(true,today,"TEST AUTO SUSPEND","700",false);
      expect(result.status).toBe(503);
      expect(result.body.error).toContain("Booking dan pembayaran belum dibuat");
      expect(await counts()).toMatchObject({bookings:0,payments:0,grants:0});
      expect(await commands()).toHaveLength(0);
    });
    test("registered PIN in stale X904 snapshot cannot create a paid booking", async()=>{
      await snapshot(new Date(clock.getTime()-6*60_000),2);
      const result=await submit(true,today,"TEST AUTO SUSPEND","700",false);
      expect(result.status).toBe(503);
      expect(await counts()).toMatchObject({bookings:0,payments:0,grants:0});
      expect(await commands()).toHaveLength(0);
    });
    test("machine-matched self PIN + canonical paid booking activates without second Admin approval",async()=>{
      const bad=await submit(true,today,"TEST AUTO SUSPEND","701");
      expect(bad.status).toBe(409);
      expect(await counts()).toMatchObject({bookings:0,payments:0,grants:0});
      const good=await submit(true,today,"TEST AUTO SUSPEND","700");
      expect(good.status).toBe(201);
      const id=Number(good.body.id);
      expect(await grant(id)).toMatchObject({user_pin:"700",device_uid:343,verification_state:"verified",access_state:"pending",payment_id:null});
      const paymentId=await confirm(id);
      expect(await grant(id)).toMatchObject({payment_id:paymentId,verification_state:"verified",access_state:"pending"});
      await snapshot(new Date(clock.getTime()-1000),2);
      await tick(clock);
      const all=await commands();
      const activate=all.filter((c:any)=>c.command_type==="ACTIVATE_USER");
      expect(activate).toHaveLength(1);
      expect(activate[0].payload).toMatchObject({expectedUid:343,source:"AUTO_NONMEMBER_GYM_12H"});
      expect((await pool.query("SELECT count(*)::int n FROM sport_center.audit_logs WHERE action='x904_guest_pin_staff_attestation' AND entity_id=$1",[id])).rows[0].n).toBe(0);
      expect(await counts()).toMatchObject({bookings:1,payments:1,grants:1});
      await tick(clock);
      expect((await commands()).filter((c:any)=>c.command_type==="ACTIVATE_USER")).toHaveLength(1);
      // Command queued != door opened: physical SDK ACK and group readback still mandatory.
    });

    test("unverified public Gym PIN cannot become live merely because funds were confirmed",async()=>{
      const result=await submit();
      expect(result.status).toBe(201);
      const id=Number(result.body.id);
      // Simulate a non-verified intermediate state on an otherwise valid public booking.
      await pool.query("UPDATE sport_center.x904_nonmember_daily_access SET verification_state='pending',access_state='pending' WHERE booking_id=$1",[id]);
      await confirm(id);
      expect(await grant(id)).toMatchObject({verification_state:"review_required",access_state:"review_required"});
      await snapshot(new Date(clock.getTime()-1000),2);
      await tick(clock);
      expect(await commands()).toHaveLength(0);
    });

    test("already-paid Gym guest with no grant is restored by staff without a second booking or payment",async()=>{
      const id=await checkout();
      const paid=await confirm(id);
      await pool.query("DELETE FROM sport_center.x904_nonmember_daily_access WHERE booking_id=$1",[id]);
      expect(await grant(id)).toBeUndefined();
      expect(await counts()).toMatchObject({bookings:1,payments:1,grants:0});
      await snapshot(new Date(clock.getTime()-1000),2);
      const anonymous=await request.post(`/api/bookings/${id}/x904-guest-pin-approve`).send(attest);
      expect(anonymous.status).toBe(401);
      const denied=await request.post(`/api/bookings/${id}/x904-guest-pin-approve`)
        .set("Authorization","Bearer "+token).send({...attest,officialFundsChecked:false});
      expect(denied.status).toBe(400);
      expect(await grant(id)).toBeUndefined();
      const approved=await approve(id);
      expect(approved.status).toBe(200);
      expect(approved.body).toMatchObject({success:true,accessState:"pending"});
      expect(await grant(id)).toMatchObject({payment_id:paid,verification_state:"verified",access_state:"pending",user_pin:"700",device_uid:343});
      expect(await counts()).toMatchObject({bookings:1,payments:1,grants:1});
      expect(await commands()).toHaveLength(0);
      const again=await approve(id);
      expect(again.status).toBe(200);
      expect(again.body.idempotent).toBe(true);
      expect((await pool.query("SELECT count(*)::int n FROM sport_center.audit_logs WHERE action='x904_guest_pin_staff_attestation' AND entity_id=$1",[id])).rows[0].n).toBe(1);
    });

    test("missing-grant recovery holds when the X904 device snapshot is stale",async()=>{
      const id=await checkout();
      await confirm(id);
      await pool.query("DELETE FROM sport_center.x904_nonmember_daily_access WHERE booking_id=$1",[id]);
      await snapshot(new Date(clock.getTime()-6*60_000),2);
      const result=await approve(id);
      expect(result.status).toBe(409);
      expect(result.body.code).toBe("snapshot_stale");
      expect(await grant(id)).toBeUndefined();
      expect(await counts()).toMatchObject({bookings:1,payments:1,grants:0});
      expect(await commands()).toHaveLength(0);
    });

    test("audit failure must roll back PIN authorization, not return success", async () => {
      const id = await checkout();
      await confirm(id);
      await pool.query(
        "ALTER TABLE sport_center.audit_logs ADD CONSTRAINT injected_audit_failure CHECK (action <> 'x904_guest_pin_staff_attestation')",
      );
      try {
        const r = await approve(id);
        expect(r.status).toBe(500);
        expect(await grant(id)).toMatchObject({
          verification_state: "review_required",
          access_state: "review_required",
        });
        expect(await commands()).toHaveLength(0);
      } finally {
        await pool.query(
          "ALTER TABLE sport_center.audit_logs DROP CONSTRAINT injected_audit_failure",
        );
      }
    });
    test.each(["disabled", "demoted"])(
      "%s operator token cannot authorize PIN",
      async (kind) => {
        const id = await checkout();
        await confirm(id);
        const r = await approve(
          id,
          kind === "disabled" ? disabledToken : demotedToken,
        );
        expect(r.status).toBe(401);
        expect(await grant(id)).toMatchObject({
          verification_state: "review_required",
        });
      },
    );
    test("retry after committed approval returns the same state and one audit", async () => {
      const id = await checkout();
      await confirm(id);
      expect((await approve(id)).status).toBe(200);
      const again = await approve(id);
      expect(again.status).toBe(200);
      expect(again.body.idempotent).toBe(true);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM sport_center.audit_logs WHERE action='x904_guest_pin_staff_attestation' AND entity_id=$1",
            [id],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    test.each(["2026-11-10T01:00:00Z", "2026-11-10T15:40:00Z"])(
      "complete pipeline from %s respects verified activation, expiry and wrong-UID rejection",
      async (start) => {
        const at = new Date(start);
        jest.setSystemTime(at);
        const id = await checkout();
        expect(await grant(id)).toMatchObject({
          access_state: "review_required",
          payment_id: null,
        });
        await snapshot(new Date(at.getTime() - 1000), 2);
        await tick(at);
        expect(await commands()).toHaveLength(0);
        const pay = await confirm(id);
        // Confirmed full payment automatically authorizes an already verified
        // machine PIN; no second staff approval is needed.
        expect(await grant(id)).toMatchObject({
          payment_id: pay,
          access_state: "pending",
          verification_state: "verified",
        });
        await tick(at);
        await tick(at);
        const [activate] = await commands();
        expect(activate.command_type).toBe("ACTIVATE_USER");
        expect(activate.payload).toMatchObject({
          accessId: Number((await grant(id)).access_id),
          expectedUid: 343,
        });
        expect(await commands()).toHaveLength(1);
        expect((await grant(id)).access_state).not.toBe("active");
        // Hardware boundary: deliberately wrong UID must never open the application gate.
        const ackAt = new Date(at.getTime() + 10000);
        await pool.query(
          "UPDATE sport_center.x904_user_commands SET state='completed',completed_at=$2,result=$3 WHERE command_id=$1",
          [
            activate.command_id,
            ackAt,
            JSON.stringify({
              readBackConfirmed: true,
              deviceUid: 999,
              afterGroup: 1,
            }),
          ],
        );
        await snapshot(new Date(ackAt.getTime() + 1000), 1);
        await tick(new Date(ackAt.getTime() + 2000));
        expect((await grant(id)).access_state).not.toBe("active");
        await pool.query(
          "UPDATE sport_center.x904_user_commands SET result=$2 WHERE command_id=$1",
          [
            activate.command_id,
            JSON.stringify({
              readBackConfirmed: true,
              deviceUid: 343,
              afterGroup: 1,
            }),
          ],
        );
        await tick(new Date(ackAt.getTime() + 3000));
        expect(await grant(id)).toMatchObject({
          access_state: "active",
          activated_at: ackAt,
        });
        const expiry = new Date((await grant(id)).expires_at);
        expect(expiry.getTime()).toBe(
          Date.parse("2026-11-10T16:00:00Z"),
        );
        await snapshot(new Date(expiry.getTime() + 1000), 1);
        await tick(new Date(expiry.getTime() + 2000));
        await tick(new Date(expiry.getTime() + 2000));
        const susp = (await commands()).find(
          (c: any) => c.command_type === "SUSPEND_USER",
        );
        expect(susp).toBeDefined();
        expect(await commands()).toHaveLength(2);
        expect(susp.payload).toMatchObject({
          source: "AUTO_NONMEMBER_GYM_12H",
          accessId: Number((await grant(id)).access_id),
          expectedUid: 343,
        });
        // Even a fresh Group 2 snapshot cannot validate a suspend ACK for another UID.
        await pool.query(
          "UPDATE sport_center.x904_user_commands SET state='completed',completed_at=$2,result=$3 WHERE command_id=$1",
          [
            susp.command_id,
            new Date(expiry.getTime() + 3000),
            JSON.stringify({
              readBackConfirmed: true,
              deviceUid: 999,
              afterGroup: 2,
            }),
          ],
        );
        await snapshot(new Date(expiry.getTime() + 4000), 2);
        await tick(new Date(expiry.getTime() + 5000));
        expect((await grant(id)).access_state).toBe("review_required");
        expect(await commands()).toHaveLength(2);
        // Fixture-only repair of simulated device evidence; no hardware is connected.
        await pool.query(
          "UPDATE sport_center.x904_user_commands SET result=$2 WHERE command_id=$1",
          [
            susp.command_id,
            JSON.stringify({
              readBackConfirmed: true,
              deviceUid: 343,
              afterGroup: 2,
            }),
          ],
        );
        await tick(new Date(expiry.getTime() + 6000));
        expect((await grant(id)).access_state).toBe("expired");
      },
    );
    test("two concurrent staff approvals produce one authorization and one audit", async () => {
      const id = await checkout();
      await confirm(id);
      const responses = await Promise.all([approve(id), approve(id)]);
      expect(responses.map((r) => r.status)).toEqual([200, 200]);
      expect(responses.map((r) => r.body.idempotent).sort()).toEqual([
        false,
        true,
      ]);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM sport_center.audit_logs WHERE action='x904_guest_pin_staff_attestation' AND entity_id=$1",
            [id],
          )
        ).rows[0].n,
      ).toBe(1);
      expect(await commands()).toHaveLength(0);
    });
    test.each([
      "missing_proof",
      "insufficient_amount",
      "rejected_payment",
      "missing_confirmation_time",
    ])("payment evidence %s cannot release a PIN", async (kind) => {
      const id = await checkout();
      await confirm(id);
      const pay = await payment(id);
      if (kind === "missing_proof")
        await pool.query(
          "UPDATE sport_center.sport_payments SET proof_url=NULL WHERE id=$1",
          [pay.id],
        );
      if (kind === "insufficient_amount")
        await pool.query(
          "UPDATE sport_center.sport_payments SET amount=1 WHERE id=$1",
          [pay.id],
        );
      if (kind === "rejected_payment")
        await pool.query(
          "UPDATE sport_center.sport_payments SET status='rejected' WHERE id=$1",
          [pay.id],
        );
      if (kind === "missing_confirmation_time")
        await pool.query(
          "UPDATE sport_center.sport_payments SET confirmed_at=NULL WHERE id=$1",
          [pay.id],
        );
      expect((await approve(id)).status).toBe(409);
      expect(await grant(id)).toMatchObject({
        verification_state: "review_required",
        access_state: "review_required",
        activated_at: null,
      });
      expect(await commands()).toHaveLength(0);
    });
    test("registered guest with lowercase name stores canonical name under RLS", async () => {
      const response = await submit(true, today, "test auto suspend");
      expect(response.status).toBe(201);
      expect(response.body.proofStatus).toBe("waiting_confirmation");
      const id = response.body.id;
      const saved = (await pool.query("SELECT customer_name,status FROM sport_center.sport_bookings WHERE id=$1", [id])).rows[0];
      expect(saved.customer_name).toBe("TEST AUTO SUSPEND");
      expect(saved.status).toBe("waiting_confirmation");
      const grantRow = await grant(id);
      expect(grantRow.verified_name).toBe("TEST AUTO SUSPEND");
      expect(grantRow.access_state).toBe("review_required");
      expect(grantRow.activated_at).toBeNull();
      const payment = await pool.query("SELECT status FROM sport_center.sport_payments WHERE booking_id=$1", [id]);
      expect(payment.rows).toHaveLength(1);
      expect(payment.rows[0].status).toBe("pending");
      expect(await commands()).toHaveLength(0);
    });
    test("pending receipt cannot be approved and field staff cannot confirm payment", async () => {
      const id = await checkout();
      const pay = await payment(id);
      const unauthorized = await request
        .patch("/api/payments/" + pay.id)
        .set("Authorization", "Bearer " + token)
        .send({ status: "confirmed" });
      expect(unauthorized.status).toBe(403);
      expect((await payment(id)).status).toBe("pending");
      expect((await approve(id)).status).toBe(409);
      expect((await grant(id)).activated_at).toBeNull();
      expect(await commands()).toHaveLength(0);
    });
    test("paid Gym fast wake queues one guarded activation without 60s timer wait", async () => {
      const oldFlag = process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED;
      try {
        const id = await checkout();
        await snapshot(new Date(clock.getTime() - 1000), 2);
        delete process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED;
        const wakeStart = performance.now();
        await confirm(id);
        // No test call to tick(): the committed payment calls the same existing
        // worker asynchronously. Never fake device ACK or grant active here.
        let queued: any[] = [];
        for (let i = 0; i < 45; i++) {
          queued = await commands();
          if (queued.length) break;
          await new Promise(resolve => setTimeout(resolve, 30));
        }
        const wakeLatencyMs = performance.now() - wakeStart;
        console.info("ISOLATED_POSTCOMMIT_WAKE_MS", Math.round(wakeLatencyMs));
        expect(wakeLatencyMs).toBeLessThan(5000);
        expect(queued).toHaveLength(1);
        expect(queued[0]).toMatchObject({
          user_pin: "700", command_type: "ACTIVATE_USER", state: "queued",
          payload: { source: "AUTO_NONMEMBER_GYM_12H", expectedUid: 343 },
        });
        expect((await grant(id)).access_state).toBe("pending");
      } finally {
        if (oldFlag === undefined) delete process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED;
        else process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED = oldFlag;
      }
    });
    test("verified X904 scan checks in once and existing lifecycle completes once (real PostgreSQL)", async () => {
      const {reconcileX904MissedNonmemberBookingCheckins} = await import("../../services/x904MissedCheckinReconcile.js");
      const {completeBooking} = await import("../../lib/bookingLifecycle.js");
      const id = await checkout();
      const payId = await confirm(id);
      // The existing staff attestation is mandatory; do not bypass identity review.
      expect((await approve(id)).status).toBe(200);
      const confirmedGrant = await grant(id);
      expect(confirmedGrant.payment_id).toBe(payId);
      expect(confirmedGrant.verification_state).toBe("verified");
      // Isolated fixture of a completed activation ACK; no physical device interaction.
      await pool.query("UPDATE sport_center.x904_nonmember_daily_access SET access_state='active',activated_at=$2,expires_at=$3 WHERE booking_id=$1",
        [id,new Date("2026-11-10T01:00:20Z"),new Date("2026-11-10T13:00:20Z")]);
      await pool.query("INSERT INTO sport_center.gym_x904_lan_logs VALUES('TDBD234200545','700',999,'2026-11-10 08:15:00','wrong-uid')");
      process.env.GYM_X904_NONMEMBER_BOOKING_CHECKIN_ENABLED = "true";
      const evaluation = new Date("2026-11-10T01:16:00Z");
      try {
        expect(await reconcileX904MissedNonmemberBookingCheckins(db,evaluation)).toBe(0);
        expect((await pool.query("SELECT checked_in_at FROM sport_center.sport_bookings WHERE id=$1",[id])).rows[0].checked_in_at).toBeNull();
        // SDK userSn is event sequence 101, not registered UID 343.
        await pool.query("INSERT INTO sport_center.gym_x904_lan_logs VALUES('TDBD234200545','700',101,'2026-11-10 08:15:00','valid-ordinal',100)");
        // A passive VMSC raw capture is still unverified: never use it as
        // check-in proof regardless of matching PIN and paid access.
        await pool.query("INSERT INTO sport_center.gym_x904_verification_evidence VALUES('TDBD234200545',100,'700','valid-ordinal','vmsc_automated','unverified',15,repeat('00',26)||'0f'||repeat('00',13))");
        expect(await reconcileX904MissedNonmemberBookingCheckins(db,evaluation)).toBe(0);
        await pool.query("UPDATE sport_center.gym_x904_verification_evidence SET capture_source='trusted_vmsc_ingress',evidence_status='protocol_verified',raw_hex=$1 WHERE event_index=100",
          ["00".repeat(26)+"0f"+"00".repeat(4)+"ff"+"00".repeat(8)]);
        // A contradictory processed status must NOT override signed raw 255.
        // Punch 255 is legitimate "undefined" state, NOT unlock permission.
        await pool.query("INSERT INTO sport_center.gym_x904_raw_events VALUES('valid-ordinal','TDBD234200545','700','2026-11-10 08:15:00',0,15)");
        expect(await reconcileX904MissedNonmemberBookingCheckins(db,evaluation)).toBe(0);
        // Once the independently signed proof and persisted raw event agree,
        // the canonical booking check-in may run exactly once.
        await pool.query("UPDATE sport_center.gym_x904_raw_events SET attendance_status=255 WHERE event_id='valid-ordinal'");
        expect(await reconcileX904MissedNonmemberBookingCheckins(db,evaluation)).toBe(1);
        expect(await reconcileX904MissedNonmemberBookingCheckins(db,evaluation)).toBe(0);
        const check = (await pool.query("SELECT checked_in_at,status FROM sport_center.sport_bookings WHERE id=$1",[id])).rows[0];
        expect(check.status).toBe("confirmed");
        expect(check.checked_in_at).toEqual(new Date("2026-11-10T01:15:00Z"));
        expect((await pool.query("SELECT count(*)::int n FROM sport_center.booking_history WHERE booking_id=$1 AND note LIKE 'Check-in%'",[id])).rows[0].n).toBe(1);
        const finishedAt=new Date("2026-11-10T02:01:00Z");
        expect(await completeBooking(id,{userName:"isolated E2E",userRole:"system"},finishedAt)).toMatchObject({ok:true,alreadyCompleted:false});
        expect(await completeBooking(id,{userName:"isolated E2E",userRole:"system"},finishedAt)).toMatchObject({ok:true,alreadyCompleted:true});
        const done=(await pool.query("SELECT status,completed_at FROM sport_center.sport_bookings WHERE id=$1",[id])).rows[0];
        expect(done.status).toBe("completed");
        expect(done.completed_at).toEqual(finishedAt);
        expect((await pool.query("SELECT count(*)::int n FROM sport_center.booking_history WHERE booking_id=$1 AND to_status='completed'",[id])).rows[0].n).toBe(1);
      } finally {
        delete process.env.GYM_X904_NONMEMBER_BOOKING_CHECKIN_ENABLED;
      }
    });
    test.each([
      {source:"admin",identity:"pin",pin:"700",uid:343},
      {source:"gym_public_guest",identity:"pin",pin:"700",uid:343},
      {source:"admin",identity:"card",pin:"78",uid:338},
      {source:"gym_public_guest",identity:"card",pin:"78",uid:338},
    ])("new paid Gym $source $identity: signed 19:10 scan after slot completes check-in exactly once without changing status", async s=>{
      const {reconcileX904MissedNonmemberBookingCheckins}=await import("../../services/x904MissedCheckinReconcile.js");
      const {checkInBooking}=await import("../../lib/bookingLifecycle.js");
      const id=await checkout();
      const paymentId=await confirm(id);
      expect((await approve(id)).status).toBe(200);
      const eventId="ci-gym-day-"+s.source+"-"+s.identity;
      const scanAt=new Date("2026-11-17T12:10:00Z");
      const evaluation=new Date("2026-11-17T12:11:00Z");
      await pool.query("UPDATE sport_center.sport_bookings SET source=$2,booking_date='2026-11-17',start_time='17:27',end_time='18:27',status='completed' WHERE id=$1",[id,s.source]);
      if(s.identity==="card"){
        await pool.query("INSERT INTO sport_center.gym_x904_lan_users VALUES ('TDBD234200545','78',338,'VIS 001',0)");
        await pool.query("UPDATE sport_center.x904_nonmember_daily_access SET identity_type='card',identity_label='VIS001',user_pin='78',device_uid=338,verified_name='VIS 001' WHERE booking_id=$1",[id]);
        if(s.source==="gym_public_guest"){
          await pool.query("INSERT INTO sport_center.gym_vis_card_reservations(booking_id,payment_id,device_serial,user_pin,device_uid,card_code,state,collected_at) VALUES($1,$2,'TDBD234200545','78',338,'VIS001','collected','2026-11-17T11:15:00Z')",[id,paymentId]);
        }
      }
      await pool.query("UPDATE sport_center.x904_nonmember_daily_access SET access_state='active',activated_at='2026-11-17T10:30:00Z',expires_at='2026-11-17T16:00:00Z' WHERE booking_id=$1",[id]);
      await pool.query("INSERT INTO sport_center.gym_x904_lan_logs VALUES('TDBD234200545',$1,101,'2026-11-17 19:10:00',$2,100)",[s.pin,eventId]);
      const raw="00".repeat(26)+"0f"+"00".repeat(4)+"ff"+"00".repeat(8);
      await pool.query("INSERT INTO sport_center.gym_x904_verification_evidence VALUES('TDBD234200545',100,$1,$2,'trusted_vmsc_ingress','protocol_verified',15,$3)",[s.pin,eventId,raw]);
      await pool.query("INSERT INTO sport_center.gym_x904_raw_events VALUES($1,'TDBD234200545',$2,'2026-11-17 19:10:00',255,15)",[eventId,s.pin]);
      const actor={userName:"X904 signed scan "+eventId,userRole:"system"};
      expect((await checkInBooking(id,actor,scanAt,{x904GymScanEventId:"forged"})).ok).toBe(false);
      expect((await checkInBooking(id,{userName:"operator",userRole:"staff"},scanAt)).ok).toBe(false);
      process.env.GYM_X904_NONMEMBER_BOOKING_CHECKIN_ENABLED="true";
      try{
        expect(await reconcileX904MissedNonmemberBookingCheckins(db,evaluation)).toBe(1);
        expect(await reconcileX904MissedNonmemberBookingCheckins(db,evaluation)).toBe(0);
        const done=(await pool.query("SELECT status,checked_in_at FROM sport_center.sport_bookings WHERE id=$1",[id])).rows[0];
        expect(done.status).toBe("completed");
        expect(done.checked_in_at).toEqual(scanAt);
        expect((await pool.query("SELECT count(*)::int n FROM sport_center.booking_history WHERE booking_id=$1 AND note LIKE 'Check-in%' ",[id])).rows[0].n).toBe(1);
      } finally {delete process.env.GYM_X904_NONMEMBER_BOOKING_CHECKIN_ENABLED;}
    });
    test("all six VIS preserve witnessed handover before signed booking check-in", async () => {
      const {reconcileX904MissedNonmemberBookingCheckins}=await import("../../services/x904MissedCheckinReconcile.js");
      const id=await checkout();
      const paymentId=await confirm(id);
      expect((await approve(id)).status).toBe(200);
      await pool.query("INSERT INTO sport_center.gym_x904_lan_users VALUES('TDBD234200545','78',338,'VIS 001',0)");
      await pool.query("UPDATE sport_center.x904_nonmember_daily_access SET identity_type='card',identity_label='VIS001',user_pin='78',device_uid=338,verified_name='VIS 001',access_state='active',activated_at=$2,expires_at=$3 WHERE booking_id=$1",
        [id,new Date("2026-11-10T01:00:20Z"),new Date("2026-11-10T13:00:20Z")]);
      await pool.query("INSERT INTO sport_center.gym_x904_lan_logs VALUES('TDBD234200545','78',202,'2026-11-10 08:15:00','vis-signed',201)");
      await pool.query("INSERT INTO sport_center.gym_x904_verification_evidence VALUES('TDBD234200545',201,'78','vis-signed','trusted_vmsc_ingress','protocol_verified',4,$1)",
        ["00".repeat(26)+"04"+"00".repeat(4)+"ff"+"00".repeat(8)]);
      await pool.query("INSERT INTO sport_center.gym_x904_raw_events VALUES('vis-signed','TDBD234200545','78','2026-11-10 08:15:00',255,4)");
      process.env.GYM_X904_NONMEMBER_BOOKING_CHECKIN_ENABLED="true";
      const evaluation=new Date("2026-11-10T01:16:00Z");
      try {
        // Payment, verified card UID and signed scan alone cannot skip handover.
        expect(await reconcileX904MissedNonmemberBookingCheckins(db,evaluation)).toBe(0);
        await pool.query("INSERT INTO sport_center.gym_vis_card_reservations(booking_id,payment_id,device_serial,user_pin,device_uid,card_code,state,collected_at) VALUES($1,$2,'TDBD234200545','78',338,'VIS001','collected','2026-11-10T01:16:00Z')",[id,paymentId]);
        // An earlier scan must never be attributed to a later card handover.
        expect(await reconcileX904MissedNonmemberBookingCheckins(db,evaluation)).toBe(0);
        await pool.query("UPDATE sport_center.gym_vis_card_reservations SET collected_at='2026-11-10T01:10:00Z' WHERE booking_id=$1",[id]);
        expect(await reconcileX904MissedNonmemberBookingCheckins(db,evaluation)).toBe(1);
        expect(await reconcileX904MissedNonmemberBookingCheckins(db,evaluation)).toBe(0);
        expect((await pool.query("SELECT checked_in_at FROM sport_center.sport_bookings WHERE id=$1",[id])).rows[0].checked_in_at)
          .toEqual(new Date("2026-11-10T01:15:00Z"));
      } finally {
        delete process.env.GYM_X904_NONMEMBER_BOOKING_CHECKIN_ENABLED;
      }
    });
    test("future paid Gym check-in follows WhatsApp's durable LAN scan once without fake signed proof", async () => {
      const {reconcileX904MissedNonmemberBookingCheckins} = await import("../../services/x904MissedCheckinReconcile.js");
      const id=await checkout();
      await confirm(id);
      expect((await approve(id)).status).toBe(200);
      await pool.query("UPDATE sport_center.sport_bookings SET booking_date='2026-11-13',start_time='08:00',end_time='09:00' WHERE id=$1",[id]);
      await pool.query("UPDATE sport_center.x904_nonmember_daily_access SET access_state='active',activated_at='2026-11-13T01:00:00Z',expires_at='2026-11-13T13:00:00Z' WHERE booking_id=$1",[id]);
      await pool.query("UPDATE sport_center.gym_x904_lan_state SET last_complete_at='2026-11-13T01:15:30Z'");
      process.env.GYM_X904_NONMEMBER_BOOKING_CHECKIN_ENABLED="true";
      const now=new Date("2026-11-13T01:16:00Z");
      try {
        expect(await reconcileX904MissedNonmemberBookingCheckins(db,now)).toBe(0);
        await pool.query("INSERT INTO sport_center.gym_x904_lan_logs(device_serial,user_pin,device_uid,device_time,event_id,event_index,received_at) VALUES('TDBD234200545','700',403,'2026-11-13 08:15:00',$1,401,'2026-11-13T01:15:00Z')",["e".repeat(64)]);
        expect(await reconcileX904MissedNonmemberBookingCheckins(db,now)).toBe(0);
        await pool.query("UPDATE sport_center.gym_x904_lan_logs SET device_uid=402 WHERE event_id=$1",["e".repeat(64)]);
        expect(await reconcileX904MissedNonmemberBookingCheckins(db,now)).toBe(1);
        expect(await reconcileX904MissedNonmemberBookingCheckins(db,now)).toBe(0);
        const check=(await pool.query("SELECT status,checked_in_at FROM sport_center.sport_bookings WHERE id=$1",[id])).rows[0];
        expect(check.status).toBe("confirmed");
        expect(check.checked_in_at).toEqual(new Date("2026-11-13T01:15:00Z"));
        const history=(await pool.query("SELECT changed_by_name FROM sport_center.booking_history WHERE booking_id=$1 AND note LIKE 'Check-in%' ORDER BY created_at DESC LIMIT 1",[id])).rows[0];
        expect(history.changed_by_name).toContain("LAN observed scan");
        expect((await pool.query("SELECT count(*)::int n FROM sport_center.gym_x904_verification_evidence WHERE event_index=401")).rows[0].n).toBe(0);
      } finally {
        delete process.env.GYM_X904_NONMEMBER_BOOKING_CHECKIN_ENABLED;
      }
    });
    test("old completed snapshot with current authenticated VMSC heartbeat still accepts its exact scan once", async () => {
      const {reconcileX904MissedNonmemberBookingCheckins}=await import("../../services/x904MissedCheckinReconcile.js");
      await pool.query("TRUNCATE sport_center.gym_x904_lan_logs");
      const id=await checkout();
      await confirm(id);
      expect((await approve(id)).status).toBe(200);
      await pool.query("UPDATE sport_center.sport_bookings SET booking_date='2026-11-13',start_time='08:00',end_time='11:00' WHERE id=$1",[id]);
      await pool.query("UPDATE sport_center.x904_nonmember_daily_access SET access_state='active',activated_at='2026-11-13T01:00:00Z',expires_at='2026-11-13T13:00:00Z' WHERE booking_id=$1",[id]);
      await pool.query("UPDATE sport_center.gym_x904_lan_state SET last_complete_at='2026-11-13T01:30:00Z',stored_log_count=1,device_log_count=1,user_count=1");
      await pool.query("INSERT INTO sport_center.gym_x904_lan_logs(device_serial,user_pin,device_uid,device_time,event_id,event_index,received_at) VALUES('TDBD234200545','700',402,'2026-11-13 08:15:00',$1,401,'2026-11-13T01:15:00Z')",["b".repeat(64)]);
      await pool.query("INSERT INTO sport_center.gym_x904_connector_heartbeats VALUES('TDBD234200545','VMSC','2026-11-13T03:15:00Z',1,1,true)");
      process.env.GYM_X904_NONMEMBER_BOOKING_CHECKIN_ENABLED="false";
      try {
        expect(await reconcileX904MissedNonmemberBookingCheckins(db,new Date("2026-11-13T03:16:00Z"))).toBe(1);
        expect(await reconcileX904MissedNonmemberBookingCheckins(db,new Date("2026-11-13T03:16:00Z"))).toBe(0);
      } finally {delete process.env.GYM_X904_NONMEMBER_BOOKING_CHECKIN_ENABLED;}
    });
    test("heartbeat alone cannot bypass failed auth, mismatched inventory or stale liveness",async()=>{
      const {reconcileX904MissedNonmemberBookingCheckins}=await import("../../services/x904MissedCheckinReconcile.js");
      await pool.query("TRUNCATE sport_center.gym_x904_lan_logs");
      const id=await checkout(); await confirm(id); expect((await approve(id)).status).toBe(200);
      await pool.query("UPDATE sport_center.sport_bookings SET booking_date='2026-11-13',start_time='08:00',end_time='11:00' WHERE id=$1",[id]);
      await pool.query("UPDATE sport_center.x904_nonmember_daily_access SET access_state='active',activated_at='2026-11-13T01:00:00Z',expires_at='2026-11-13T13:00:00Z' WHERE booking_id=$1",[id]);
      await pool.query("UPDATE sport_center.gym_x904_lan_state SET last_complete_at='2026-11-13T01:30:00Z',stored_log_count=1,device_log_count=1,user_count=1");
      await pool.query("INSERT INTO sport_center.gym_x904_lan_logs(device_serial,user_pin,device_uid,device_time,event_id,event_index,received_at) VALUES('TDBD234200545','700',402,'2026-11-13 08:15:00',$1,401,'2026-11-13T01:15:00Z')",["c".repeat(64)]);
      await pool.query("INSERT INTO sport_center.gym_x904_connector_heartbeats VALUES('TDBD234200545','VMSC','2026-11-13T03:15:00Z',1,1,false)");
      process.env.GYM_X904_NONMEMBER_BOOKING_CHECKIN_ENABLED="false";
      try {
        const evaluate=()=>reconcileX904MissedNonmemberBookingCheckins(db,new Date("2026-11-13T03:16:00Z"));
        expect(await evaluate()).toBe(0);
        await pool.query("UPDATE sport_center.gym_x904_connector_heartbeats SET read_authenticated=true,reported_logs=2");
        expect(await evaluate()).toBe(0);
        await pool.query("UPDATE sport_center.gym_x904_connector_heartbeats SET reported_logs=1,last_seen='2026-11-13T03:00:00Z'");
        expect(await evaluate()).toBe(0);
        await pool.query("UPDATE sport_center.gym_x904_connector_heartbeats SET last_seen='2026-11-13T03:15:00Z'");
        await pool.query("UPDATE sport_center.gym_x904_lan_logs SET last_seen_snapshot='00000000-0000-4000-8000-000000000002' WHERE event_id=$1",["c".repeat(64)]);
        expect(await evaluate()).toBe(0);
      } finally {delete process.env.GYM_X904_NONMEMBER_BOOKING_CHECKIN_ENABLED;}
    });
    test("future paid Gym session completes automatically without inventing attendance or requiring admin note",async()=>{
      const {completeBooking}=await import("../../lib/bookingLifecycle.js");
      const id=await checkout();
      await confirm(id);
      expect((await approve(id)).status).toBe(200);
      await pool.query("UPDATE sport_center.sport_bookings SET booking_date='2026-11-13',start_time='08:00',end_time='09:00' WHERE id=$1",[id]);
      await pool.query("UPDATE sport_center.x904_nonmember_daily_access SET access_state='expired',activated_at='2026-11-13T01:00:00Z',expires_at='2026-11-13T13:00:00Z' WHERE booking_id=$1",[id]);
      const ended=new Date("2026-11-13T02:01:00Z");
      expect(await completeBooking(id,{userName:"scheduler",userRole:"system"},ended)).toMatchObject({ok:true,alreadyCompleted:false,withoutCheckin:true});
      expect(await completeBooking(id,{userName:"scheduler",userRole:"system"},ended)).toMatchObject({ok:true,alreadyCompleted:true});
      const done=(await pool.query("SELECT status,checked_in_at,completed_at FROM sport_center.sport_bookings WHERE id=$1",[id])).rows[0];
      expect(done.status).toBe("completed");
      expect(done.checked_in_at).toBeNull();
      const note=(await pool.query("SELECT note FROM sport_center.booking_history WHERE booking_id=$1 AND to_status='completed'",[id])).rows[0].note;
      expect(note).toContain("bukan bukti kehadiran");
      expect(note).toContain("Sesi Gym mandiri");
    });
    test("stale snapshot holds activation until a fresh snapshot arrives", async () => {
      const id = await checkout();
      await confirm(id);
      expect((await approve(id)).status).toBe(200);
      await snapshot(new Date(clock.getTime() - 6 * 60000), 2);
      await tick(clock);
      expect(await commands()).toHaveLength(0);
      await snapshot(new Date(clock.getTime() - 1000), 2);
      await tick(clock);
      await tick(clock);
      expect(await commands()).toHaveLength(1);
      expect((await commands())[0].command_type).toBe("ACTIVATE_USER");
      expect((await grant(id)).access_state).toBe("pending");
    });


    // Execute the real audit query as the non-bypass application role inside
    // a PostgreSQL READ ONLY transaction. Fixtures below never contact X904.
    async function paidPendingForAudit() {
      const id = await checkout();
      const paymentId = await confirm(id);
      expect((await approve(id)).status).toBe(200);
      await pool.query("UPDATE sport_center.x904_nonmember_daily_access SET created_at=$1 WHERE booking_id=$2", [clock, id]);
      await pool.query(`UPDATE sport_center.audit_logs SET created_at=$1
        WHERE entity='booking' AND entity_id=$2
          AND action IN ('x904_guest_pin_staff_attestation','x904_guest_pin_payment_auto_authorized','x904_guest_pin_payment_auto_recovered')`, [clock, id]);
      return { id, paymentId, access: await grant(id) };
    }
    async function auditAt(at: Date) {
      const { auditPaidGymEntitlementConsistency } = await import("../../services/x904PaidGymConsistencyAudit.js");
      const client = await appPool.connect();
      const entries: string[] = [];
      try {
        await client.query("BEGIN READ ONLY");
        expect((await client.query("SHOW transaction_read_only")).rows[0].transaction_read_only).toBe("on");
        const store = { execute: async (query: SQL) => {
          const rendered = dialect.sqlToQuery(query);
          return client.query(rendered.sql, rendered.params);
        }};
        const count = await auditPaidGymEntitlementConsistency(store as any, at, entry => entries.push(entry));
        return { count, entries };
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    }

    test("read-only watchdog detects name drift that leaves a paid grant pending without commands", async () => {
      const { id } = await paidPendingForAudit();
      await snapshot(clock, 2);
      await pool.query(`UPDATE sport_center.gym_x904_access_snapshots
        SET users=jsonb_set(users,'{0,name}','"TEST RENAMED IDENTITY"'::jsonb)`);
      await tick(new Date(clock.getTime() + 60_000));
      expect(await grant(id)).toMatchObject({ verification_state: "verified", access_state: "pending", activated_at: null });
      expect(await commands()).toHaveLength(0);
      const before = await counts();
      expect((await auditAt(new Date(clock.getTime() + 4 * 60_000))).count).toBe(0);
      const overdue = await auditAt(new Date(clock.getTime() + 6 * 60_000));
      expect(overdue.count).toBe(1);
      expect(overdue.entries).toHaveLength(1);
      expect(overdue.entries[0]).toContain('"issue":"PAID_PENDING_GRANT"');
      expect(overdue.entries[0]).not.toMatch(/TEST RENAMED|TEST AUTO|628111|proof|user_pin|device_uid/);
      expect(await auditAt(new Date(clock.getTime() + 7 * 60_000))).toEqual({ count: 1, entries: [] });
      expect(await counts()).toEqual(before);
      expect(await commands()).toHaveLength(0);
    });

    test.each(["queued", "claimed", "failed", "completed"])(
      "read-only watchdog includes a stalled %s command without an activated grant",
      async state => {
        const { access } = await paidPendingForAudit();
        await pool.query(`INSERT INTO sport_center.x904_user_commands
          (device_serial,command_type,user_pin,payload,requested_by,idempotency_key,state,result)
          VALUES('TDBD234200545','ACTIVATE_USER','700',$1,301,$2,$3,$4)`,
          [JSON.stringify({ source: "AUTO_NONMEMBER_GYM_12H", accessId: access.access_id }),
           "CI-AUDIT-" + access.access_id, state,
           JSON.stringify({ readBackConfirmed: false, errorCode: "GROUP_READ_FAILED" })]);
        const before = await commands();
        expect((await auditAt(new Date(clock.getTime() + 6 * 60_000))).count).toBe(1);
        expect(await commands()).toEqual(before);
      },
    );

    test("read-only watchdog ignores verified activation after matching ACK and fresh snapshot", async () => {
      const { id } = await paidPendingForAudit();
      await snapshot(new Date(clock.getTime() - 1000), 2);
      await tick(clock);
      const command = (await commands())[0];
      expect(command.command_type).toBe("ACTIVATE_USER");
      await pool.query(`UPDATE sport_center.x904_user_commands
        SET state='completed',completed_at=$1,result='{"readBackConfirmed":true,"deviceUid":343,"afterGroup":1}'::jsonb
        WHERE command_id=$2`, [new Date(clock.getTime() + 1000), command.command_id]);
      await snapshot(new Date(clock.getTime() + 2000), 1);
      await tick(new Date(clock.getTime() + 3000));
      expect((await grant(id)).access_state).toBe("active");
      expect((await auditAt(new Date(clock.getTime() + 6 * 60_000))).count).toBe(0);
    });

    test.each(["membership_id", "membership_payment_id", "source_membership_payment_id"])(
      "read-only watchdog excludes a membership payment identified by %s",
      async column => {
        const { id, paymentId } = await paidPendingForAudit();
        if (column === "source_membership_payment_id") {
          await pool.query("UPDATE sport_center.sport_payments SET source_membership_payment_id=901 WHERE id=$1", [paymentId]);
        } else {
          await pool.query(`UPDATE sport_center.sport_bookings SET ${column}=901 WHERE id=$1`, [id]);
        }
        // Membership payments never require a daily nonmember grant.
        await pool.query("DELETE FROM sport_center.x904_nonmember_daily_access WHERE booking_id=$1", [id]);
        expect((await auditAt(new Date(clock.getTime() + 6 * 60_000))).count).toBe(0);
      },
    );

    test("read-only watchdog preserves missing/held grant detection", async () => {
      const { id } = await paidPendingForAudit();
      await pool.query("UPDATE sport_center.x904_nonmember_daily_access SET access_state='review_required' WHERE booking_id=$1", [id]);
      const held = await auditAt(new Date(clock.getTime() + 3 * 60_000));
      expect(held.count).toBe(1);
      expect(held.entries[0]).toContain("PAID_HELD_GRANT");
      await pool.query("DELETE FROM sport_center.x904_nonmember_daily_access WHERE booking_id=$1", [id]);
      const missing = await auditAt(new Date(clock.getTime() + 3 * 60_000));
      expect(missing.count).toBe(1);
      expect(missing.entries[0]).toContain("PAID_NO_GRANT");
    });

    test("read-only watchdog gives advance payments a grace period after 06:00 WIB", async () => {
      const { id, paymentId } = await paidPendingForAudit();
      await pool.query("UPDATE sport_center.sport_payments SET confirmed_at='2026-11-09T03:00:00Z' WHERE id=$1", [paymentId]);
      await pool.query(`UPDATE sport_center.x904_nonmember_daily_access
        SET created_at='2026-11-09T03:00:00Z',verification_state='verified',access_state='pending'
        WHERE booking_id=$1`, [id]);
      expect((await auditAt(new Date("2026-11-09T22:59:00Z"))).count).toBe(0);
      expect((await auditAt(new Date("2026-11-09T23:04:00Z"))).count).toBe(0);
      expect((await auditAt(new Date("2026-11-09T23:06:00Z"))).count).toBe(1);
    });

    test("read-only watchdog ignores future dates, legacy web handover, and closing time", async () => {
      const { id } = await paidPendingForAudit();
      await pool.query("UPDATE sport_center.sport_bookings SET booking_date='2026-11-11' WHERE id=$1", [id]);
      expect((await auditAt(new Date(clock.getTime() + 6 * 60_000))).count).toBe(0);
      await pool.query("UPDATE sport_center.sport_bookings SET booking_date=$1,source='web' WHERE id=$2", [today, id]);
      expect((await auditAt(new Date(clock.getTime() + 6 * 60_000))).count).toBe(0);
      await pool.query("UPDATE sport_center.sport_bookings SET source='gym_public_guest' WHERE id=$1", [id]);
      expect((await auditAt(new Date("2026-11-10T16:01:00Z"))).count).toBe(0);
    });

    test("read-only watchdog waits for a verified newly created grant before timing activation", async () => {
      const { id } = await paidPendingForAudit();
      const overdue = new Date(clock.getTime() + 6 * 60_000);
      await pool.query("UPDATE sport_center.x904_nonmember_daily_access SET verification_state='review_required' WHERE booking_id=$1", [id]);
      expect((await auditAt(overdue)).count).toBe(0);
      await pool.query("UPDATE sport_center.x904_nonmember_daily_access SET verification_state='verified',created_at=$1 WHERE booking_id=$2", [new Date(clock.getTime() + 4 * 60_000), id]);
      expect((await auditAt(overdue)).count).toBe(0);
      expect((await auditAt(new Date(clock.getTime() + 10 * 60_000))).count).toBe(1);
    });

    test("read-only watchdog starts PIN grace after the matching staff attestation or recovery", async () => {
      const { id, access, paymentId } = await paidPendingForAudit();
      for (const action of ["x904_guest_pin_staff_attestation", "x904_guest_pin_payment_auto_authorized", "x904_guest_pin_payment_auto_recovered"]) {
        await pool.query(`DELETE FROM sport_center.audit_logs WHERE entity='booking' AND entity_id=$1
          AND action IN ('x904_guest_pin_staff_attestation','x904_guest_pin_payment_auto_authorized','x904_guest_pin_payment_auto_recovered')`, [id]);
        await pool.query(`INSERT INTO sport_center.audit_logs(action,entity,entity_id,"after",created_at)
          VALUES($1,'booking',$2,$3,$4)`, [action, id,
          JSON.stringify({ accessId: access.access_id, paymentId, accessState: "pending" }),
          new Date(clock.getTime() + 30 * 60_000)]);
        expect((await auditAt(new Date(clock.getTime() + 31 * 60_000))).count).toBe(0);
        expect((await auditAt(new Date(clock.getTime() + 36 * 60_000))).count).toBe(1);
      }
    });

    test("read-only watchdog does not reset PIN grace for unrelated or future audit records", async () => {
      const { id, access, paymentId } = await paidPendingForAudit();
      const cases = [
        { accessId: Number(access.access_id) + 1, paymentId, minutes: 30 },
        { accessId: access.access_id, paymentId: paymentId + 1, minutes: 30 },
        { accessId: access.access_id, paymentId, minutes: 60 },
      ];
      for (const row of cases) {
        await pool.query(`INSERT INTO sport_center.audit_logs(action,entity,entity_id,"after",created_at)
          VALUES('x904_guest_pin_payment_auto_recovered','booking',$1,$2,$3)`, [id,
          JSON.stringify({ accessId: row.accessId, paymentId: row.paymentId, accessState: "pending" }),
          new Date(clock.getTime() + row.minutes * 60_000)]);
      }
      expect((await auditAt(new Date(clock.getTime() + 31 * 60_000))).count).toBe(1);
    });

    test("read-only watchdog includes Admin PIN and card pending grants", async () => {
      const { id } = await paidPendingForAudit();
      await pool.query("UPDATE sport_center.sport_bookings SET source='admin' WHERE id=$1", [id]);
      expect((await auditAt(new Date(clock.getTime() + 6 * 60_000))).count).toBe(1);
      await pool.query(`UPDATE sport_center.x904_nonmember_daily_access
        SET identity_type='card',identity_label='VIS001',user_pin='78',device_uid=338,verified_name='VIS 001'
        WHERE booking_id=$1`, [id]);
      expect((await auditAt(new Date(clock.getTime() + 6 * 60_000))).count).toBe(1);
    });

    test("read-only watchdog includes ready public VIS without claiming handover and ignores unmatched reservations", async () => {
      const { id, paymentId } = await paidPendingForAudit();
      await pool.query("UPDATE sport_center.sport_bookings SET notes='Kartu VIS001–VIS006 menunggu pilihan' WHERE id=$1", [id]);
      await pool.query(`UPDATE sport_center.x904_nonmember_daily_access
        SET identity_type='card',identity_label='VIS001',user_pin='78',device_uid=338,verified_name='VIS 001'
        WHERE booking_id=$1`, [id]);
      const overdue = new Date(clock.getTime() + 6 * 60_000);
      expect((await auditAt(overdue)).count).toBe(0);
      await pool.query(`INSERT INTO sport_center.gym_vis_card_reservations
        (booking_id,payment_id,device_serial,user_pin,device_uid,card_code,state,collected_at,funds_verified_at,reserved_at)
        VALUES($1,$2,'TDBD234200545','90',338,'VIS001','reserved',NULL,$3,$3)`, [id, paymentId, clock]);
      expect((await auditAt(overdue)).count).toBe(0);
      await pool.query("UPDATE sport_center.gym_vis_card_reservations SET user_pin='78' WHERE booking_id=$1", [id]);
      const before = (await pool.query("SELECT * FROM sport_center.gym_vis_card_reservations WHERE booking_id=$1", [id])).rows;
      expect((await auditAt(overdue)).count).toBe(1);
      expect((await pool.query("SELECT * FROM sport_center.gym_vis_card_reservations WHERE booking_id=$1", [id])).rows).toEqual(before);
      expect(before[0]).toMatchObject({ state: "reserved", collected_at: null });
      await pool.query("UPDATE sport_center.gym_vis_card_reservations SET reserved_at=$1 WHERE booking_id=$2", [new Date(clock.getTime() + 4 * 60_000), id]);
      expect((await auditAt(overdue)).count).toBe(0);
      await pool.query("UPDATE sport_center.gym_vis_card_reservations SET state='collected',collected_at=$1 WHERE booking_id=$2", [new Date(clock.getTime() + 5 * 60_000), id]);
      expect((await auditAt(new Date(clock.getTime() + 11 * 60_000))).count).toBe(1);
    });


    describe("four entry points use the complete real booking/payment/access lifecycle", () => {
      type MatrixIdentity = { source: "admin" | "gym_public_guest"; identity: "pin" | "card"; pin: string; uid: number; name: string };
      const variants: MatrixIdentity[] = [
        { source: "admin", identity: "pin", pin: "700", uid: 343, name: "TEST AUTO SUSPEND" },
        { source: "admin", identity: "card", pin: "78", uid: 338, name: "VIS 001" },
        { source: "gym_public_guest", identity: "pin", pin: "700", uid: 343, name: "TEST AUTO SUSPEND" },
        { source: "gym_public_guest", identity: "card", pin: "78", uid: 338, name: "VIS 001" },
      ];
      let matrixDay = "";
      let matrixStart: Date;
      let oldOnlyPin: string | undefined;
      let oldFastWake: string | undefined;
      let oldCheckin: string | undefined;
      let previousTokens: { staff: string; finance: string };
      let matrixAdminToken = "";
      beforeAll(async () => {
        // Previous focused tests intentionally use permissive/inconsistent VIS
        // fixtures. These new full-route cases use the actual existing schema,
        // constraints and application-role RLS instead of weakening those cases.
        // Canonical VIS SQL also reads this existing bank-reference column,
        // which the abbreviated Drizzle checkout fixture does not declare.
        await pool.query("ALTER TABLE sport_center.sport_payments ADD COLUMN reference_number text");
        await pool.query("ALTER TABLE sport_center.x904_nonmember_daily_access ADD COLUMN visitor_name text");
        await pool.query("ALTER TABLE sport_center.gym_vis_card_reservations RENAME TO gym_vis_card_reservations_focused_fixture");
        await pool.query(readFileSync("migrations/20261106_gym_vis_card_reservations.sql", "utf8"));
        // Install the historical baseline before its later additive PIN policies;
        // keep the baseline's exact policy-hash guard intact.
        for (const name of ["x904_nonmember_app_public_pin_review_insert", "x904_nonmember_app_paid_guest_pin_recovery_insert", "x904_nonmember_app_self_pin_insert"]) {
          await pool.query(`DROP POLICY ${ident(name)} ON sport_center.x904_nonmember_daily_access`);
        }
        await pool.query(readFileSync("migrations/20261107_gym_vis_app_role_rls.sql", "utf8"));
        for (const file of ["20261109_x904_public_pin_review_insert_rls.sql", "20261116_x904_paid_guest_pin_recovery_rls.sql", "20261116_x904_self_pin_insert_rls.sql"]) {
          await pool.query(readFileSync("migrations/" + file, "utf8"));
        }
        const { rows } = await pool.query("SELECT ((now() AT TIME ZONE 'Asia/Jakarta')::date + 1)::text AS day");
        matrixDay = String(rows[0].day) < "2026-11-18" ? "2026-11-18" : String(rows[0].day);
        // Fake application time stays on a future disposable booking day; real
        // PostgreSQL now() defaults precede simulated device/scan evidence.
        // This does not change a production clock or rewrite business rows.
        matrixStart = new Date(matrixDay + "T08:00:00+07:00");
        oldOnlyPin = process.env.GYM_X904_NONMEMBER_ONLY_PIN;
        oldFastWake = process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED;
        oldCheckin = process.env.GYM_X904_NONMEMBER_BOOKING_CHECKIN_ENABLED;
        previousTokens = { staff: token, finance: adminToken };
      });
      beforeEach(async () => {
        jest.setSystemTime(matrixStart);
        const { createToken } = await import("../../lib/auth.js");
        token = createToken(302, "staff");
        adminToken = createToken(303, "finance");
        matrixAdminToken = createToken(306, "admin");
        delete process.env.GYM_X904_NONMEMBER_ONLY_PIN;
        process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED = "false";
        process.env.GYM_X904_NONMEMBER_BOOKING_CHECKIN_ENABLED = "true";
        await pool.query(`TRUNCATE sport_center.gym_x904_lan_logs,
          sport_center.gym_x904_verification_evidence,sport_center.gym_x904_raw_events,
          sport_center.gym_x904_lan_users;
          INSERT INTO sport_center.gym_x904_lan_users VALUES
            ('TDBD234200545','700',343,'TEST AUTO SUSPEND',0),
            ('TDBD234200545','78',338,'VIS 001',0)`);
        await matrixSnapshot(new Date(matrixStart.getTime() - 1000));
      });
      afterEach(() => {
        if (previousTokens) { token = previousTokens.staff; adminToken = previousTokens.finance; }
        for (const [key, value] of [
          ["GYM_X904_NONMEMBER_ONLY_PIN", oldOnlyPin],
          ["GYM_X904_PAID_GYM_FAST_WAKE_ENABLED", oldFastWake],
          ["GYM_X904_NONMEMBER_BOOKING_CHECKIN_ENABLED", oldCheckin],
        ] as const) {
          if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
      });
      afterAll(async () => {
        await pool.query("DROP TABLE sport_center.gym_vis_card_reservations");
        await pool.query("ALTER TABLE sport_center.gym_vis_card_reservations_focused_fixture RENAME TO gym_vis_card_reservations");
      });
      async function matrixSnapshot(at: Date, activePin = "", group = 2, nameOverride?: string) {
        const { rows } = await pool.query("SELECT user_pin,display_name,device_role FROM sport_center.gym_x904_lan_users ORDER BY user_pin");
        const users = rows.map(row => ({
          pin: String(row.user_pin), name: String(row.user_pin) === activePin && nameOverride ? nameOverride : row.display_name,
          role: Number(row.device_role), group: String(row.user_pin) === activePin ? group : 2, enabled: true,
        }));
        await pool.query("INSERT INTO sport_center.gym_x904_access_snapshots(device_serial,observed_at,user_count,users) VALUES('TDBD234200545',$1,$2,$3)", [at, users.length, JSON.stringify(users)]);
      }
      async function matrixBooking(id: number) {
        return (await pool.query("SELECT * FROM sport_center.sport_bookings WHERE id=$1", [id])).rows[0];
      }
      async function matrixConfirm(id: number) {
        const p = await payment(id);
        const response = await request.patch("/api/payments/" + p.id)
          .set("Authorization", "Bearer " + adminToken).send({ status: "confirmed" });
        expect({ status: response.status, error: response.body.error }).toEqual({ status: 200, error: undefined });
        return response;
      }
      async function matrixReadAccess(id: number) {
        const before = await counts();
        const beforeCommands = await commands();
        const response = await request.get(`/api/bookings/${id}/x904-paid-access`)
          .set("Authorization", "Bearer " + adminToken);
        expect({ status: response.status, error: response.body.error }).toEqual({ status: 200, error: undefined });
        expect(await counts()).toEqual(before);
        expect(await commands()).toEqual(beforeCommands);
        return response.body;
      }
      async function matrixCheckout(s: MatrixIdentity, confirmPayment = true, oneStep = false) {
        let response: any;
        if (s.source === "admin") {
          response = await request.post("/api/bookings").set("Authorization", "Bearer " + matrixAdminToken).send({
            customerName: s.identity === "pin" ? s.name : "MATRIX ADMIN VIS GUEST",
            customerPhone: "628111222333", customerId: null, facilityId: 6,
            bookingDate: matrixDay, startTime: "08:00", durationHours: 1, numberOfPeople: 1,
            source: "admin", payerType: "personal", adminPaymentChoice: oneStep ? "paid" : "unpaid",
            x904IdentityType: s.identity, x904IdentityValue: s.identity === "pin" ? s.pin : "VIS001",
            ...(s.identity === "card" ? { x904VisitorName: "MATRIX ADMIN VIS GUEST" } : {}),
          });
          expect({ status: response.status, error: response.body.error }).toEqual({ status: 201, error: undefined });
          const uploaded = await request.post("/api/payments").set("Authorization", "Bearer " + (oneStep ? matrixAdminToken : adminToken)).send({
            ...(oneStep ? { confirmAdminGymPayment: true } : {}),
            bookingId: response.body.id, amount: 30000, proofUrl: "https://isolated.invalid/payment-proof.jpeg",
            paymentMethod: "QRIS", paymentProvider: "mandiri_direct",
          });
          if (oneStep) {
            expect([200, 201]).toContain(uploaded.status);
            if (uploaded.body.status === "confirmed") {
              expect(uploaded.status).toBe(200);
              return Number(response.body.id);
            }
            expect(uploaded.status).toBe(201);
          } else expect({ status: uploaded.status, error: uploaded.body.error }).toEqual({ status: 201, error: undefined });
        } else {
          response = await submit(true, matrixDay,
            s.identity === "pin" ? s.name : "MATRIX PUBLIC VIS GUEST",
            s.identity === "pin" ? s.pin : "", false);
          expect({ status: response.status, error: response.body.error }).toEqual({ status: 201, error: undefined });
        }
        const id = Number(response.body.id);
        expect(await matrixBooking(id)).toMatchObject({ source: s.source, booking_date: matrixDay });
        await tick(matrixStart);
        expect(await commands()).toHaveLength(0); // Receipt/OCR is not confirmed money.
        if (confirmPayment) await matrixConfirm(id);
        return id;
      }
      async function matrixLifecycle(id: number, s: MatrixIdentity, replayConfirmation = false, signedReservedCard = false) {
        const pay = await payment(id);
        const original = await grant(id);
        expect(original).toMatchObject({
          identity_type: s.identity, user_pin: s.pin, device_uid: s.uid,
          verified_name: s.name, payment_id: pay.id, verification_state: "verified", access_state: "pending",
        });
        expect(await counts()).toEqual({ bookings: 1, payments: 1, grants: 1 });
        expect(await matrixReadAccess(id)).toMatchObject({ paymentConfirmed: true, gymAccess: { state: "pending", action: "wait" } });
        if (replayConfirmation) {
          for (let i = 0; i < 2; i++) {
            const replay = await matrixConfirm(id);
            expect(replay.body.gymAccess).toMatchObject({ state: "pending", action: "wait" });
            expect(replay.body.visCard?.state).not.toBe("needs_review");
            expect((await grant(id)).access_id).toBe(original.access_id);
          }
        }
        await matrixSnapshot(new Date(matrixStart.getTime() + 1000));
        await tick(new Date(matrixStart.getTime() + 2000));
        await tick(new Date(matrixStart.getTime() + 2000));
        const [activate] = await commands();
        expect(await commands()).toHaveLength(1);
        expect(activate).toMatchObject({ user_pin: s.pin, command_type: "ACTIVATE_USER", state: "queued" });
        expect(activate.payload).toMatchObject({ accessId: Number(original.access_id), expectedUid: s.uid });
        expect((await grant(id)).access_state).toBe("pending");
        const ackAt = new Date(matrixStart.getTime() + 10_000);
        // External device boundary only: emulate its completed ACK and later
        // full snapshot; never set access_state/activated_at in test SQL.
        await pool.query("UPDATE sport_center.x904_user_commands SET state='completed',completed_at=$2,result=$3 WHERE command_id=$1",
          [activate.command_id, ackAt, JSON.stringify({ readBackConfirmed: true, deviceUid: replayConfirmation ? 999 : s.uid, afterGroup: 1 })]);
        await tick(new Date(ackAt.getTime() + 1000));
        expect((await grant(id)).access_state).not.toBe("active");
        await matrixSnapshot(new Date(ackAt.getTime() + 2000), s.pin, 1);
        await tick(new Date(ackAt.getTime() + 3000));
        if (replayConfirmation) {
          expect((await grant(id)).access_state).not.toBe("active");
          expect(await commands()).toHaveLength(1);
          // Repair only the simulated device ACK, never the application grant.
          await pool.query("UPDATE sport_center.x904_user_commands SET result=$2 WHERE command_id=$1",
            [activate.command_id, JSON.stringify({ readBackConfirmed: true, deviceUid: s.uid, afterGroup: 1 })]);
          await tick(new Date(ackAt.getTime() + 4000));
        }
        jest.setSystemTime(new Date(ackAt.getTime() + 5000));
        expect(await grant(id)).toMatchObject({ access_state: "active", activated_at: ackAt });
        expect(await matrixReadAccess(id)).toMatchObject({ paymentConfirmed: true, gymAccess: { state: "active", action: "none" } });
        if (replayConfirmation) {
          for (let i = 0; i < 2; i++) {
            const replay = await matrixConfirm(id);
            expect(replay.body.gymAccess).toMatchObject({ state: "active", action: "none" });
            expect(replay.body.visCard?.state).not.toBe("needs_review");
          }
        }
        if (s.source === "gym_public_guest" && s.identity === "card") {
          const reservation = (await pool.query("SELECT * FROM sport_center.gym_vis_card_reservations WHERE booking_id=$1", [id])).rows[0];
          expect(reservation).toMatchObject({ state: "reserved", collected_at: null, payment_id: pay.id, user_pin: s.pin });
          if (!signedReservedCard) {
            const booked = await matrixBooking(id);
            const handover = await request.post(`/api/admin/wa-bookings/${booked.order_number}/collect-vis`)
              .set("Authorization", "Bearer " + matrixAdminToken).send({ physicalCardHandedOver: true });
            expect({ status: handover.status, error: handover.body.error }).toEqual({ status: 200, error: undefined });
            expect(handover.body).toMatchObject({ state: "collected", cardCode: "VIS001" });
          }
        }
        const { completeBooking } = await import("../../lib/bookingLifecycle.js");
        let completedAt = new Date(matrixDay + "T09:01:00+07:00");
        // The existing Admin Gym route stores openTime plus one hour;
        // public checkout stores its requested 08:00–09:00 display slot.
        expect((await matrixBooking(id)).end_time).toBe(s.source === "admin" ? "07:00" : "09:00");
        jest.setSystemTime(completedAt);
        const earlyCompletion = await completeBooking(id, { userName: "isolated scheduler", userRole: "system" }, completedAt);
        if (s.source === "admin") {
          // The existing automatic close without attendance is public-Gym only.
          // Admin keeps its confirmed state until a real scan (or an explicit
          // reason); do not fabricate attendance or relax that policy here.
          expect(earlyCompletion).toEqual({ ok: false, reason: "Booking belum check-in. Gunakan Selesaikan tanpa check-in dengan alasan minimal 12 karakter." });
          expect(await matrixBooking(id)).toMatchObject({ status: "confirmed", checked_in_at: null, completed_at: null });
        } else {
          expect(earlyCompletion).toMatchObject({ ok: true, alreadyCompleted: false, withoutCheckin: true });
          expect(await completeBooking(id, { userName: "isolated scheduler", userRole: "system" }, completedAt))
            .toMatchObject({ ok: true, alreadyCompleted: true });
        }
        const { reconcileX904MissedNonmemberBookingCheckins } = await import("../../services/x904MissedCheckinReconcile.js");
        const scanAt = new Date(matrixDay + "T19:10:00+07:00");
        const evaluation = new Date(scanAt.getTime() + 60_000);
        jest.setSystemTime(evaluation);
        expect(await reconcileX904MissedNonmemberBookingCheckins(db, evaluation)).toBe(0);
        if (signedReservedCard) {
          // A real-shaped LAN observation alone is not proof of a reserved
          // visitor card. It cannot bypass the staff handover or signed scan.
          await pool.query("INSERT INTO sport_center.gym_x904_lan_logs(device_serial,user_pin,device_uid,device_time,event_id,event_index,received_at) VALUES('TDBD234200545',$1,700,$2,$3,699,$4)",
            [s.pin,matrixDay + " 19:08:00","f".repeat(64),evaluation]);
          expect(await reconcileX904MissedNonmemberBookingCheckins(db,evaluation)).toBe(0);
          expect((await matrixBooking(id)).checked_in_at).toBeNull();
        }
        const eventIndex = 700;
        const eventId = "full-route-" + s.source + "-" + s.identity + "-" + id;
        const deviceTime = matrixDay + " 19:10:00";
        const raw = Buffer.alloc(40); raw.writeUInt16LE(eventIndex + 1, 0); raw.write(s.pin, 2, "ascii");
        raw[26] = 15; raw[31] = 255;
        await pool.query("INSERT INTO sport_center.gym_x904_lan_logs(device_serial,user_pin,device_uid,device_time,event_id,event_index,received_at) VALUES('TDBD234200545',$1,$2,$3,$4,$5,$6)",
          [s.pin, eventIndex + 1, deviceTime, eventId, eventIndex, evaluation]);
        await pool.query("INSERT INTO sport_center.gym_x904_verification_evidence(device_serial,event_index,user_pin,source_event_id,capture_source,evidence_status,verification_code,raw_hex) VALUES('TDBD234200545',$1,$2,$3,'trusted_vmsc_ingress','protocol_verified',15,$4)",
          [eventIndex, s.pin, eventId, raw.toString("hex")]);
        await pool.query("INSERT INTO sport_center.gym_x904_raw_events VALUES($1,'TDBD234200545',$2,$3,255,15)", [eventId, s.pin, deviceTime]);
        if (signedReservedCard) {
          // Both explicit check-in switches OFF must reject even a valid signed
          // card scan. Restore the default LAN switch before the success path.
          process.env.GYM_X904_PAID_GUEST_LAN_CHECKIN_ENABLED = "false";
          expect(await reconcileX904MissedNonmemberBookingCheckins(db, evaluation)).toBe(0);
          delete process.env.GYM_X904_PAID_GUEST_LAN_CHECKIN_ENABLED;
        }
        expect(await reconcileX904MissedNonmemberBookingCheckins(db, evaluation)).toBe(1);
        expect(await reconcileX904MissedNonmemberBookingCheckins(db, evaluation)).toBe(0);
        expect(await matrixBooking(id)).toMatchObject({ source: s.source, status: s.source === "admin" ? "confirmed" : "completed", checked_in_at: scanAt, completed_at: s.source === "admin" ? null : completedAt });
        if (s.source === "admin") {
          completedAt = evaluation;
          expect(await completeBooking(id, { userName: "isolated scheduler", userRole: "system" }, completedAt))
            .toMatchObject({ ok: true, alreadyCompleted: false, withoutCheckin: false });
          expect(await completeBooking(id, { userName: "isolated scheduler", userRole: "system" }, completedAt))
            .toMatchObject({ ok: true, alreadyCompleted: true });
        }
        expect(await matrixBooking(id)).toMatchObject({ source: s.source, status: "completed", checked_in_at: scanAt, completed_at: completedAt });
        expect((await pool.query("SELECT count(*)::int n FROM sport_center.booking_history WHERE booking_id=$1 AND note LIKE 'Check-in%'", [id])).rows[0].n).toBe(1);
        expect((await pool.query("SELECT count(*)::int n FROM sport_center.booking_history WHERE booking_id=$1 AND to_status='completed' AND note NOT LIKE 'Check-in%'", [id])).rows[0].n).toBe(1);
        const expiry = new Date(matrixDay + "T23:00:00+07:00");
        expect(new Date((await grant(id)).expires_at)).toEqual(expiry);
        await matrixSnapshot(new Date(expiry.getTime() + 1000), s.pin, 1);
        await tick(new Date(expiry.getTime() + 2000));
        await tick(new Date(expiry.getTime() + 2000));
        const all = await commands();
        expect(all).toHaveLength(2);
        const suspend = all.find((command: any) => command.command_type === "SUSPEND_USER");
        expect(suspend).toBeDefined();
        expect(suspend.payload).toMatchObject({ accessId: Number(original.access_id), expectedUid: s.uid });
        await pool.query("UPDATE sport_center.x904_user_commands SET state='completed',completed_at=$2,result=$3 WHERE command_id=$1",
          [suspend.command_id, new Date(expiry.getTime() + 3000), JSON.stringify({ readBackConfirmed: true, deviceUid: s.uid, afterGroup: 2 })]);
        await matrixSnapshot(new Date(expiry.getTime() + 4000), s.pin, 2);
        await tick(new Date(expiry.getTime() + 5000));
        await tick(new Date(expiry.getTime() + 6000));
        expect(await grant(id)).toMatchObject({ access_id: original.access_id, access_state: "expired", payment_id: pay.id, identity_type: s.identity, user_pin: s.pin, device_uid: s.uid });
        expect(await counts()).toEqual({ bookings: 1, payments: 1, grants: 1 });
        expect(await commands()).toHaveLength(2);
        jest.setSystemTime(new Date(expiry.getTime() + 6000));
        expect(await matrixReadAccess(id)).toMatchObject({ paymentConfirmed: true, gymAccess: { state: "expired", action: "none" } });
      }
      test.each([variants[0], variants[1]])("field booking admin: $identity booking, one paid confirmation and complete guarded X904 lifecycle", async s => {
        const { createToken } = await import("../../lib/auth.js");
        const fieldAdminToken = createToken(307, "admin_booking");
        matrixAdminToken = fieldAdminToken;
        const id = await matrixCheckout(s, false, true);
        const p = await payment(id);
        expect(p.status).not.toBe("confirmed");
        const denied = await request.patch("/api/payments/" + p.id)
          .set("Authorization", "Bearer " + fieldAdminToken).send({ status: "confirmed" });
        expect(denied.status).toBe(403);
        expect((await payment(id)).status).not.toBe("confirmed");
        expect(await commands()).toHaveLength(0);
        await matrixConfirm(id);
        await matrixLifecycle(id, s);
      });
      test("two adjacent admin PIN/VIS paid confirmations wake two distinct X904 activation commands without timer or duplicate grant", async () => {
        delete process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED;
        const adminPin = variants[0];
        const adminCard = variants[1];
        const pinBookingId = await matrixCheckout(adminPin, false);
        const cardBookingId = await matrixCheckout(adminCard, false);
        expect(await counts()).toEqual({ bookings: 2, payments: 2, grants: 2 });
        await matrixSnapshot(new Date(matrixStart.getTime() - 1000));
        const started = performance.now();
        await Promise.all([matrixConfirm(pinBookingId), matrixConfirm(cardBookingId)]);
        let queued: any[] = [];
        for (let i = 0; i < 120; i++) {
          queued = (await commands()).filter((c: any) => c.command_type === "ACTIVATE_USER");
          if (queued.length >= 2) break;
          await new Promise(resolve => setTimeout(resolve, 30));
        }
        const elapsed = performance.now() - started;
        console.info("ISOLATED_TWO_BOOKINGS_WAKE_MS", Math.round(elapsed));
        expect(elapsed).toBeLessThan(5000);
        expect(queued).toHaveLength(2);
        expect(new Set(queued.map((c: any) => c.user_pin))).toEqual(new Set([adminPin.pin, adminCard.pin]));
        expect(new Set(queued.map((c: any) => Number(c.payload.expectedUid)))).toEqual(new Set([adminPin.uid, adminCard.uid]));
        expect(new Set(queued.map((c: any) => Number(c.payload.accessId))).size).toBe(2);
        expect(await grant(pinBookingId)).toMatchObject({ access_state: "pending", verification_state: "verified" });
        expect(await grant(cardBookingId)).toMatchObject({ access_state: "pending", verification_state: "verified" });
        expect(await counts()).toEqual({ bookings: 2, payments: 2, grants: 2 });
      });
      test("future public VIS signed scan works with default LAN check-in enabled and signed-only flag OFF", async () => {
        const publicCard = variants.find(s => s.source === "gym_public_guest" && s.identity === "card")!;
        const id = await matrixCheckout(publicCard);
        // This is the actual DEV default: no separate signed-only flag, while
        // the normal authenticated LAN check-in path remains on by default.
        process.env.GYM_X904_NONMEMBER_BOOKING_CHECKIN_ENABLED = "false";
        delete process.env.GYM_X904_PAID_GUEST_LAN_CHECKIN_ENABLED;
        await matrixLifecycle(id, publicCard, false, true);
        const reservation = (await pool.query("SELECT state,collected_at FROM sport_center.gym_vis_card_reservations WHERE booking_id=$1",[id])).rows[0];
        expect(reservation).toMatchObject({ state: "reserved", collected_at: null });
        expect((await matrixBooking(id)).checked_in_at).not.toBeNull();
      });
      test("SC-1801: previously held paid VIS is revalidated on witnessed handover only with fresh Group 2, no new payment or ACK", async () => {
        const entry: MatrixIdentity={source:"gym_public_guest",identity:"card",pin:"78",uid:338,name:"VIS 001"};
        const id=await matrixCheckout(entry);
        const booking=await matrixBooking(id), paid=await payment(id);
        expect(await grant(id)).toMatchObject({identity_type:"card",access_state:"pending",verification_state:"verified"});
        const realNow=new Date((await pool.query("SELECT clock_timestamp() AS time")).rows[0].time);
        const todayWib=new Intl.DateTimeFormat("en-CA",{
          timeZone:"Asia/Jakarta",year:"numeric",month:"2-digit",day:"2-digit",
        }).format(realNow);
        const closeAt=new Date(todayWib+"T23:00:00+07:00");
        // Real DB clock for the source parity check, while the test still
        // uses only its disposable local PostgreSQL and synthetic booking.
        if (realNow >= closeAt) {
          expect(closeAt.getTime()).toBeLessThanOrEqual(realNow.getTime());
          return;
        }
        const approvedAt=new Date(realNow.getTime()-60_000);
        await pool.query("UPDATE sport_center.sport_bookings SET booking_date=$2 WHERE id=$1",[id,todayWib]);
        await pool.query("UPDATE sport_center.sport_payments SET confirmed_at=$2 WHERE id=$1",[paid.id,approvedAt]);
        await pool.query("UPDATE sport_center.x904_nonmember_daily_access SET access_state='review_required',confirmed_at=$2,expires_at=$3 WHERE booking_id=$1",
          [id,approvedAt,closeAt]);
        await matrixSnapshot(new Date(realNow.getTime()-11*60_000));
        const denied=await request.post(`/api/admin/wa-bookings/${booking.order_number}/collect-vis`)
          .set("Authorization","Bearer "+matrixAdminToken).send({physicalCardHandedOver:true});
        expect(denied.status).toBe(409);
        expect(await grant(id)).toMatchObject({access_state:"review_required",activated_at:null});
        await matrixSnapshot(new Date(realNow.getTime()-1000));
        // Even an old completed command for THIS grant makes automatic
        // recovery unsafe; no replay of an unknown device transition.
        const heldGrant=await grant(id);
        await pool.query(
          "INSERT INTO sport_center.x904_user_commands(device_serial,command_type,user_pin,payload,requested_by,idempotency_key,state,created_at) VALUES('TDBD234200545','ACTIVATE_USER','78',$1,301,$2,'completed',$3)",
          [JSON.stringify({source:"AUTO_NONMEMBER_GYM_12H",accessId:Number(heldGrant.access_id),expectedUid:338}),
           "SC1801-UNATTRIBUTED-COMMAND-"+String(id),new Date(realNow.getTime()-3000)]);
        const commandDenied=await request.post(`/api/admin/wa-bookings/${booking.order_number}/collect-vis`)
          .set("Authorization","Bearer "+matrixAdminToken).send({physicalCardHandedOver:true});
        expect(commandDenied.status).toBe(409);
        expect(await grant(id)).toMatchObject({access_state:"review_required",activated_at:null});
        await pool.query("DELETE FROM sport_center.x904_user_commands WHERE idempotency_key=$1",["SC1801-UNATTRIBUTED-COMMAND-"+String(id)]);
        const accepted=await request.post(`/api/admin/wa-bookings/${booking.order_number}/collect-vis`)
          .set("Authorization","Bearer "+matrixAdminToken).send({physicalCardHandedOver:true});
        expect({status:accepted.status,error:accepted.body.error}).toEqual({status:200,error:undefined});
        expect(accepted.body).toMatchObject({cardCode:"VIS001",state:"collected"});
        expect(await grant(id)).toMatchObject({access_state:"pending",verification_state:"verified",activated_at:null});
        expect((await pool.query("SELECT state,collected_at FROM sport_center.gym_vis_card_reservations WHERE booking_id=$1",[id])).rows[0])
          .toMatchObject({state:"collected",collected_at:expect.any(Date)});
        expect(await counts()).toEqual({bookings:1,payments:1,grants:1});
        expect(await commands()).toHaveLength(0); // Handover never claims a device ACK.
        // Existing worker must pick up the same recovered grant automatically.
        await tick(new Date(realNow.getTime()+2000));
        const queued=await commands();
        expect(queued).toHaveLength(1);
        expect(queued[0]).toMatchObject({command_type:"ACTIVATE_USER",state:"queued",user_pin:"78"});
        const ackAt=new Date(realNow.getTime()+4000);
        await pool.query("UPDATE sport_center.x904_user_commands SET state='completed',completed_at=$2,result=$3 WHERE command_id=$1",
          [queued[0].command_id,ackAt,JSON.stringify({readBackConfirmed:true,deviceUid:338,afterGroup:1})]);
        await matrixSnapshot(new Date(realNow.getTime()+5000),"78",1);
        await tick(new Date(realNow.getTime()+6000));
        expect(await grant(id)).toMatchObject({access_state:"active",activated_at:ackAt});
        const replay=await request.post(`/api/admin/wa-bookings/${booking.order_number}/collect-vis`)
          .set("Authorization","Bearer "+matrixAdminToken).send({physicalCardHandedOver:true});
        expect(replay.status).toBe(200);
        expect(await counts()).toEqual({bookings:1,payments:1,grants:1});
      });
      test.each([variants[0], variants[1]])("authorized Admin $identity checkout confirms in one payment request and completes lifecycle", async s => {
        const id = await matrixCheckout(s, false, true);
        expect((await payment(id)).status).toBe("confirmed");
        await matrixLifecycle(id, s);
      });
      test.each([variants[0], variants[1]])("field staff $identity checkout holds payment until one authorized confirmation", async s => {
        const { createToken } = await import("../../lib/auth.js");
        matrixAdminToken = createToken(302, "staff");
        const id = await matrixCheckout(s, false, true);
        expect((await payment(id)).status).not.toBe("confirmed");
        expect(await commands()).toHaveLength(0);
        await matrixConfirm(id);
        await matrixLifecycle(id, s);
      });
      test.each(variants)("full real route $source $identity: booking to payment, ACK, daily check-in and expiry without rewriting grant state", async s => {
        const id = await matrixCheckout(s);
        await matrixLifecycle(id, s);
      });
      test("mid-process newly registered public VIS guest retains payment and recovers through existing staff PIN approval", async () => {
        const visitor = "MATRIX NEWLY REGISTERED VISITOR";
        const response = await submit(true, matrixDay, visitor, "", false);
        expect(response.status).toBe(201);
        const id = Number(response.body.id);
        expect(await counts()).toEqual({ bookings: 1, payments: 1, grants: 0 });
        // An independent on-device enrollment and approved registry appears
        // after real checkout. No booking/payment/grant identity is rewritten.
        await pool.query("INSERT INTO sport_center.gym_x904_lan_users VALUES('TDBD234200545','701',344,$1,0)", [visitor]);
        await pool.query("INSERT INTO sport_center.x904_verified_nonmember_identities(device_serial,user_pin,device_uid,display_name,verification_state,verified_by,verified_at) VALUES('TDBD234200545','701',344,$1,'verified','isolated-enrollment-fixture',now())", [visitor]);
        await matrixSnapshot(new Date(matrixStart.getTime() - 500));
        const confirmed = await matrixConfirm(id);
        expect(confirmed.body.gymAccess).toMatchObject({ state: "identity_review_required", action: "verify_pin_identity" });
        expect(await matrixReadAccess(id)).toMatchObject({ paymentConfirmed: true, gymAccess: { state: "identity_review_required", action: "verify_pin_identity" } });
        const { createToken } = await import("../../lib/auth.js");
        expect((await request.get(`/api/bookings/${id}/x904-paid-access`)).status).toBe(401);
        for (const [actorId, role, expectedStatus] of [[305, "customer", 403], [304, "staff", 401], [305, "staff", 401]] as const) {
          const denied = await request.get(`/api/bookings/${id}/x904-paid-access`)
            .set("Authorization", "Bearer " + createToken(actorId, role));
          expect(denied.status).toBe(expectedStatus);
        }
        const originalPayment = await payment(id);
        expect(originalPayment.status).toBe("confirmed");
        expect(await counts()).toEqual({ bookings: 1, payments: 1, grants: 0 });
        expect(await commands()).toHaveLength(0);
        await matrixSnapshot(new Date(matrixStart.getTime() - 200), "701", 2, "WRONG SNAPSHOT PERSON");
        expect((await approve(id)).status).toBe(409);
        expect(await grant(id)).toBeUndefined();
        expect(await commands()).toHaveLength(0);
        await matrixSnapshot(new Date(matrixStart.getTime() - 100));
        const expectedIdentity = { expectedUserPin: "701", expectedDeviceUid: 344, expectedDisplayName: visitor };
        // Finance may read the result of its payment confirmation, but its
        // authority never becomes permission to attest a customer's PIN.
        const financeApproval = await request.post(`/api/bookings/${id}/x904-guest-pin-approve`)
          .set("Authorization", "Bearer " + adminToken).send({ ...attest, ...expectedIdentity });
        expect(financeApproval.status).toBe(403);
        expect(await grant(id)).toBeUndefined();
        const attestIdentity = (expected: Record<string, unknown>) => request
          .post(`/api/bookings/${id}/x904-guest-pin-approve`)
          .set("Authorization", "Bearer " + token).send({ ...attest, ...expected });
        expect((await attestIdentity({ expectedUserPin: "701" })).status).toBe(400);
        for (const stale of [
          { ...expectedIdentity, expectedUserPin: "702" },
          { ...expectedIdentity, expectedDeviceUid: 999 },
          { ...expectedIdentity, expectedDisplayName: "STALE DISPLAYED IDENTITY" },
        ]) {
          const denied = await attestIdentity(stale);
          expect(denied.status).toBe(409);
          expect(denied.body.code).toBe("identity_changed_since_review");
          expect(await grant(id)).toBeUndefined();
          expect(await commands()).toHaveLength(0);
        }
        expect((await attestIdentity(expectedIdentity)).status).toBe(200);
        const approvedGrant = await grant(id);
        // A later independent device inventory change must invalidate the
        // old review even when its grant/audit already exists.
        await pool.query("UPDATE sport_center.gym_x904_lan_users SET device_uid=999 WHERE user_pin='701'");
        const staleReplay = await attestIdentity(expectedIdentity);
        expect(staleReplay.status).toBe(409);
        expect(staleReplay.body.code).toBe("identity_changed_since_review");
        expect(await grant(id)).toEqual(approvedGrant);
        expect(await commands()).toHaveLength(0);
        expect(await matrixReadAccess(id)).toMatchObject({ paymentConfirmed: true, gymAccess: { state: "identity_review_required", action: "review" } });
        expect((await matrixConfirm(id)).body.gymAccess).toMatchObject({ state: "identity_review_required", action: "review" });
        expect(await counts()).toEqual({ bookings: 1, payments: 1, grants: 1 });
        await pool.query("UPDATE sport_center.gym_x904_lan_users SET device_uid=344 WHERE user_pin='701'");
        await matrixSnapshot(new Date(matrixStart.getTime() - 100));
        expect((await attestIdentity(expectedIdentity)).status).toBe(200);
        expect((await payment(id)).id).toBe(originalPayment.id);
        const identity: MatrixIdentity = { source: "gym_public_guest", identity: "pin", pin: "701", uid: 344, name: visitor };
        await matrixLifecycle(id, identity, true);
      });
    });

    test("real PostgreSQL RLS allows only matching signed X904 evidence writes", async()=>{
      // Staged migration is evaluated against the same non-bypass application
      // role as the actual Express runtime, not a mocked privileged client.
      await pool.query("ALTER TABLE sport_center.gym_x904_verification_evidence ADD COLUMN verification_method text");
      await pool.query("ALTER TABLE sport_center.gym_x904_raw_events ENABLE ROW LEVEL SECURITY");
      await pool.query("ALTER TABLE sport_center.gym_x904_verification_evidence ENABLE ROW LEVEL SECURITY");
      await pool.query(readFileSync("migrations/20261112_x904_attested_ingress_backend_rls.sql","utf8"));
      const serial="TDBD234200545", pin="700", index=301, id="a".repeat(64);
      const raw=Buffer.alloc(40);
      raw.writeUInt16LE(index+1,0);raw.write(pin,2,"ascii");
      raw[26]=15;raw[31]=255;
      const rawHex=raw.toString("hex");
      await pool.query("INSERT INTO sport_center.gym_x904_lan_logs VALUES($1,$2,302,'2026-11-12 20:15:00',$3,$4)",
        [serial,pin,id,index]);
      await appPool.query("INSERT INTO sport_center.gym_x904_raw_events(event_id,device_serial,user_pin,device_time,attendance_status,verification_type) VALUES($1,$2,$3,'2026-11-12 20:15:00',255,15)",
        [id,serial,pin]);
      await appPool.query("INSERT INTO sport_center.gym_x904_verification_evidence(device_serial,event_index,user_pin,source_event_id,capture_source,evidence_status,verification_code,verification_method,raw_hex) VALUES($1,$2,$3,$4,'trusted_vmsc_ingress','protocol_verified',15,'face',$5)",
        [serial,index,pin,id,rawHex]);
      const present=await appPool.query("SELECT event_index FROM sport_center.gym_x904_verification_evidence WHERE event_index=$1",[index]);
      expect(present.rows).toHaveLength(1);
      const invalidId="f".repeat(64);
      await expect(appPool.query("INSERT INTO sport_center.gym_x904_raw_events(event_id,device_serial,user_pin,device_time,attendance_status,verification_type) VALUES($1,$2,$3,'2026-11-12 20:16:00',255,15)",
        [invalidId,serial,pin])).rejects.toThrow();
      const badRaw=Buffer.from(raw);
      badRaw[31]=2;
      await expect(appPool.query("INSERT INTO sport_center.gym_x904_verification_evidence(device_serial,event_index,user_pin,source_event_id,capture_source,evidence_status,verification_code,verification_method,raw_hex) VALUES($1,302,$2,$3,'trusted_vmsc_ingress','protocol_verified',15,'face',$4)",
        [serial,pin,id,badRaw.toString("hex")])).rejects.toThrow();
      // An existing unverified raw capture can be promoted only when the
      // verified immutable log still ties the PIN, serial and event together.
      const legacyId="c".repeat(64),legacyIndex=303;
      const old=Buffer.alloc(40);
      old.writeUInt16LE(legacyIndex+1,0);old.write(pin,2,"ascii");
      old[26]=15;old[31]=255;
      await pool.query("INSERT INTO sport_center.gym_x904_lan_logs VALUES($1,$2,304,'2026-11-12 20:20:00',$3,$4)",
        [serial,pin,legacyId,legacyIndex]);
      await pool.query("INSERT INTO sport_center.gym_x904_verification_evidence(device_serial,event_index,user_pin,source_event_id,capture_source,evidence_status,verification_code,verification_method,raw_hex) VALUES($1,$2,$3,$4,'vmsc_automated','unverified',15,'unknown',$5)",
        [serial,legacyIndex,pin,legacyId,old.toString("hex")]);
      const promoted=await appPool.query("UPDATE sport_center.gym_x904_verification_evidence SET capture_source='trusted_vmsc_ingress',evidence_status='protocol_verified',verification_method='face' WHERE event_index=$1 RETURNING event_index",[legacyIndex]);
      expect(promoted.rows).toHaveLength(1);
      await expect(appPool.query("UPDATE sport_center.gym_x904_verification_evidence SET raw_hex=$1 WHERE event_index=$2",
        [badRaw.toString("hex"),legacyIndex])).rejects.toThrow();
    });
  },
);
