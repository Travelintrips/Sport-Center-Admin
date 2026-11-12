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
      CREATE TABLE sport_center.gym_x904_lan_logs(device_serial text,user_pin text,device_uid int,device_time text,event_id text,event_index int);
      CREATE TABLE sport_center.gym_x904_verification_evidence(device_serial text,event_index int,user_pin text,source_event_id text,capture_source text,evidence_status text,verification_code int,raw_hex text);
      CREATE TABLE sport_center.gym_x904_raw_events(event_id text,device_serial text,user_pin text,device_time text,attendance_status int,verification_type int);
      CREATE TABLE sport_center.gym_vis_card_reservations(booking_id int,payment_id int,device_serial text,user_pin text,device_uid int,card_code text,state text,collected_at timestamptz);
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
      for (const file of [
        "20261031_x904_nonmember_daily_access.sql",
        "20261102_x904_nonmember_verified_activation_clock.sql",
        "20261105_x904_nonmember_2300_wib_cutoff.sql",
        "20261107_x904_review_required_not_live.sql",
        "20261106_x904_guest_pin_payment_review_guard.sql",
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
      app.use("/api", router);
      const { default: payments } = await import("../payments.js");
      app.use("/api", payments);
      const { default: bookings } = await import("../bookings.js");
      app.use("/api", bookings);
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
    });
    function submit(attach = true, bookingDate = today, customerName = "TEST AUTO SUSPEND") {
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
          Math.min(
            ackAt.getTime() + 12 * 3600000,
            Date.parse("2026-11-10T16:00:00Z"),
          ),
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
        process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED = "true";
        await confirm(id);
        // No test call to tick(): the committed payment calls the same existing
        // worker asynchronously. Never fake device ACK or grant active here.
        let queued: any[] = [];
        for (let i = 0; i < 45; i++) {
          queued = await commands();
          if (queued.length) break;
          await new Promise(resolve => setTimeout(resolve, 30));
        }
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
        await pool.query("INSERT INTO sport_center.gym_vis_card_reservations VALUES($1,$2,'TDBD234200545','78',338,'VIS001','collected','2026-11-10T01:16:00Z')",[id,paymentId]);
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
