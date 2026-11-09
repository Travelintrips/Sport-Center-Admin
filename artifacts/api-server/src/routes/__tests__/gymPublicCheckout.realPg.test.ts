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
import {
  pool,
  facilitiesTable,
  bookingsTable,
  paymentsTable,
  bookingHistoryTable,
  waActionTokensTable,
  auditLogsTable,
} from "@workspace/db";

// Execute the real multipart Express route and actual Drizzle/PostgreSQL writes.
// Only external OCR/blob/notifications and payment/tax configuration are stubs.
// This suite cannot target DEV/PROD: an explicitly disposable localhost DB is required.
const url = process.env.GYM_CHECKOUT_ISOLATED_PG_URL;
const suite = url ? describe : describe.skip;
if (
  url &&
  (!/^postgres(?:ql)?:\/\/[^@/]+@127\.0\.0\.1:55444\/pin700_checkout_isolated(?:\?|$)/.test(
    url,
  ) ||
    url !== process.env.SUPABASE_DATABASE_URL_DEV ||
    process.env.NODE_ENV !== "test")
)
  throw new Error("ISOLATED_CHECKOUT_DATABASE_REQUIRED");

suite("public Gym multipart HTTP checkout with real PostgreSQL", () => {
  let request: any;
  let storageFailure = false;
  let scanAmount = 30000;
  let storageCalls = 0;
  let order = 0;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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
      facilitiesTable,
      bookingsTable,
      paymentsTable,
      bookingHistoryTable,
      waActionTokensTable,
      auditLogsTable,
    ])
      await makeTable(t);
    await pool.query(`CREATE TABLE sport_center.x904_verified_nonmember_identities(device_serial text,user_pin text,device_uid integer,display_name text,verification_state text,revoked_at timestamptz);
      INSERT INTO sport_center.x904_verified_nonmember_identities VALUES ('TDBD234200545','700',343,'TEST AUTO SUSPEND','verified',null);
      CREATE TABLE sport_center.x904_nonmember_daily_access(access_id serial primary key,device_serial text,identity_type text,identity_label text,user_pin text,device_uid integer,verified_name text,booking_id integer UNIQUE REFERENCES sport_center.sport_bookings(id) ON DELETE CASCADE,verification_state text,access_state text,payment_id integer,activated_at timestamptz);
      ALTER TABLE sport_center.sport_payments ADD FOREIGN KEY(booking_id) REFERENCES sport_center.sport_bookings(id) ON DELETE CASCADE;
      INSERT INTO sport_center.sport_facilities(id,name,category,price_per_hour,open_time,close_time,min_duration,booking_mode,is_active) VALUES(6,'Gym / Fitness Center','Gym',30000,'06:00','23:00',1,'walk_in',true);`);
    const notifications = await import("../../lib/notifications.js");
    jest.unstable_mockModule("../../lib/notifications.js", () =>
      Object.fromEntries(
        Object.entries(notifications).map(([k, v]) => [
          k,
          typeof v === "function" ? jest.fn(async () => undefined) : v,
        ]),
      ),
    );
    const tax = await import("../../lib/tax.js");
    jest.unstable_mockModule("../../lib/tax.js", () => ({
      ...tax,
      resolveCustomerTax: jest.fn(async (amount: number) => ({
        taxRate: 0,
        dpp: amount,
        taxAmount: 0,
        grandTotal: amount,
        ppnTreatment: "none",
        ppnCollectedByCustomer: false,
        taxCode: null,
      })),
    }));
    const enrichment = await import("../../lib/paymentEnrichment.js");
    jest.unstable_mockModule("../../lib/paymentEnrichment.js", () => ({
      ...enrichment,
      resolveRequiredPaymentEnrichment: jest.fn(async () => ({
        companyId: 1,
        bankAccountId: "isolated-config",
        expectedSettlementDate: null,
      })),
    }));
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
    jest.unstable_mockModule(
      "../../services/x904GymGuestNameRouting.js",
      () => ({
        resolveGymGuestName: jest.fn(async () => ({
          route: "registered",
          userPin: "700",
          deviceUid: 343,
          displayName: "TEST AUTO SUSPEND",
        })),
      }),
    );
    jest.unstable_mockModule("../../lib/orderNumber.js", () => ({
      generateBookingOrderNumber: jest.fn(async () => `SC-ISOLATED-${++order}`),
    }));
    jest.unstable_mockModule("../../lib/appUrl.js", () => ({
      getBaseUrl: jest.fn(async () => "https://isolated.invalid"),
    }));
    const realtime = await import("../../lib/supabase.js");
    jest.unstable_mockModule("../../lib/supabase.js", () => ({
      ...realtime,
      broadcastAvailabilityChange: jest.fn(async () => undefined),
    }));
    const { default: express } = await import("express");
    const { default: supertest } = await import("supertest");
    const { default: router } = await import("../whatsapp.js");
    const app = express();
    app.use(express.json());
    app.use("/api", router);
    request = supertest(app);
  }, 30000);
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    storageFailure = false;
    scanAmount = 30000;
    storageCalls = 0;
    await pool.query(
      "TRUNCATE sport_center.sport_bookings CASCADE; TRUNCATE sport_center.booking_history,sport_center.wa_action_tokens,sport_center.audit_logs",
    );
  });
  function submit(attach = true) {
    let r = request
      .post("/api/wa/booking")
      .field("customerName", "TEST AUTO SUSPEND")
      .field("customerPhone", "628111222333")
      .field("facilityId", "6")
      .field("bookingDate", today)
      .field("startTime", "20:00")
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
  test("missing proof rejects without creating a booking", async () => {
    expect((await submit(false)).status).toBe(400);
    expect(await counts()).toEqual({ bookings: 0, payments: 0, grants: 0 });
  });
  test("amount mismatch rejects before durable upload or any booking", async () => {
    scanAmount = 1;
    expect((await submit()).status).toBe(422);
    expect(storageCalls).toBe(0);
    expect(await counts()).toEqual({ bookings: 0, payments: 0, grants: 0 });
  });
  test("blob failure creates no half-booking", async () => {
    storageFailure = true;
    expect((await submit()).status).toBeGreaterThanOrEqual(500);
    expect(await counts()).toEqual({ bookings: 0, payments: 0, grants: 0 });
  });
  test("late payment insert failure rolls back booking, grant, history and token", async () => {
    await pool.query(
      "ALTER TABLE sport_center.sport_payments ADD CONSTRAINT injected_payment_failure CHECK (amount < 0)",
    );
    try {
      expect((await submit()).status).toBeGreaterThanOrEqual(500);
      expect(await counts()).toEqual({ bookings: 0, payments: 0, grants: 0 });
      expect(
        (
          await pool.query(
            "SELECT (SELECT count(*)::int FROM sport_center.booking_history) history,(SELECT count(*)::int FROM sport_center.wa_action_tokens) tokens",
          )
        ).rows[0],
      ).toEqual({ history: 0, tokens: 0 });
    } finally {
      await pool.query(
        "ALTER TABLE sport_center.sport_payments DROP CONSTRAINT injected_payment_failure",
      );
    }
  });
  test("success commits one pending receipt, waiting confirmation booking and held PIN", async () => {
    const r = await submit();
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      status: "waiting_confirmation",
      proofStatus: "waiting_confirmation",
      x904Identity: null,
    });
    expect(await counts()).toEqual({ bookings: 1, payments: 1, grants: 1 });
    expect(
      (
        await pool.query(
          "SELECT status,confirmed_at,paid_at,proof_url FROM sport_center.sport_payments",
        )
      ).rows[0],
    ).toMatchObject({
      status: "pending",
      confirmed_at: null,
      paid_at: null,
      proof_url: "https://isolated.invalid/payment-proof.jpeg",
    });
    expect(
      (
        await pool.query(
          "SELECT verification_state,access_state,activated_at FROM sport_center.x904_nonmember_daily_access",
        )
      ).rows[0],
    ).toEqual({
      verification_state: "review_required",
      access_state: "review_required",
      activated_at: null,
    });
  });
  test("retry never adds a second booking or payment", async () => {
    expect((await submit()).status).toBe(201);
    expect((await submit()).status).toBe(409);
    expect(await counts()).toEqual({ bookings: 1, payments: 1, grants: 1 });
  });
  test("concurrent multipart requests produce exactly one booking and receipt", async () => {
    const r = await Promise.all([submit(), submit()]);
    expect(r.map((x) => x.status).sort()).toEqual([201, 409]);
    expect(await counts()).toEqual({ bookings: 1, payments: 1, grants: 1 });
  });
});
