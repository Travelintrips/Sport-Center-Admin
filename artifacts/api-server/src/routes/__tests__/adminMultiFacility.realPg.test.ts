import { jest, beforeAll, afterAll, beforeEach, describe, test, expect } from "@jest/globals";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { SQL } from "drizzle-orm";
import {
  pool, facilitiesTable, bookingsTable, bookingHistoryTable,
  bookingGroupsTable, blockedSchedulesTable,
} from "@workspace/db";

// Actual admin HTTP route and Drizzle/PostgreSQL transaction, disposable CI DB only.
// No CST-DEV/PROD connection, real notifications, or real payment is permitted.
const isolatedUrl = process.env.ADMIN_MULTIFACILITY_ISOLATED_PG_URL;
const suite = isolatedUrl ? describe : describe.skip;
if (isolatedUrl && (
  !/^postgres(?:ql)?:\/\/[^@/]+@127\.0\.0\.1:55444\/multifacility_checkout_isolated(?:\?|$)/.test(isolatedUrl) ||
  isolatedUrl !== process.env.SUPABASE_DATABASE_URL_DEV ||
  process.env.NODE_ENV !== "test"
)) throw new Error("ISOLATED_MULTIFACILITY_DATABASE_REQUIRED");

suite("admin two-court checkout — real HTTP and PostgreSQL", () => {
  let request: any;
  let nextOrder = 0;
  const dialect = new PgDialect();
  const quote = (v: unknown) => "'" + String(v).replace(/'/g, "''") + "'";
  const ident = (v: string) => '"' + v.replace(/"/g, '""') + '"';

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
        else if (typeof c.default === "boolean" || typeof c.default === "number")
          def = String(c.default);
        else if (typeof c.default === "object") def = quote(JSON.stringify(c.default)) + "::jsonb";
        else def = quote(c.default);
      }
      columns.push(
        `${ident(c.name)} ${type}${c.notNull ? " NOT NULL" : ""}${def ? " DEFAULT " + def : ""}${c.primary ? " PRIMARY KEY" : ""}${c.isUnique ? " UNIQUE" : ""}`,
      );
    }
    await pool.query(`CREATE TABLE ${ident(cfg.schema!)}.${ident(cfg.name)} (${columns.join(",")})`);
  }

  beforeAll(async () => {
    const existing = await pool.query("SELECT to_regnamespace('sport_center') AS existing");
    if (existing.rows[0]?.existing) throw new Error("ISOLATED_MULTIFACILITY_DATABASE_MUST_BE_EMPTY");
    await pool.query("CREATE SCHEMA sport_center");
    for (const table of [facilitiesTable, bookingsTable, bookingHistoryTable, bookingGroupsTable, blockedSchedulesTable]) {
      await makeTable(table);
    }
    await pool.query(`
      INSERT INTO sport_center.sport_facilities
        (id, name, category, price_per_hour, open_time, close_time, min_duration, booking_mode, is_active)
      VALUES
        (5, 'Badminton Court A', 'Badminton', 100000, '06:00', '23:00', 1, 'time_slot', true),
        (2, 'Badminton Court B', 'Badminton', 100000, '06:00', '23:00', 1, 'time_slot', true)
    `);

    const auth = await import("../../lib/auth.js");
    jest.unstable_mockModule("../../lib/auth.js", () => ({
      ...auth,
      adminMiddleware: (_req: any, _res: any, next: any) => next(),
      verifyToken: () => ({ role: "admin", userId: 1 }),
    }));
    const tax = await import("../../lib/tax.js");
    jest.unstable_mockModule("../../lib/tax.js", () => ({
      ...tax,
      resolveCustomerTax: jest.fn(async (amount: number) => ({
        taxRate: 0, dpp: amount, taxAmount: 0, grandTotal: amount,
        ppnTreatment: "none", ppnCollectedByCustomer: false, taxCode: null,
      })),
      resolveWithholdingTax: jest.fn(async (_customerId: unknown, amount: number) => ({
        enabled: false, rate: 0, amount: 0, netAmount: amount,
      })),
      recordTaxTransaction: jest.fn(async () => undefined),
    }));
    const notifications = await import("../../lib/notifications.js");
    jest.unstable_mockModule("../../lib/notifications.js", () =>
      Object.fromEntries(Object.entries(notifications).map(([name, value]) => [
        name, typeof value === "function" ? jest.fn(async () => undefined) : value,
      ])),
    );
    jest.unstable_mockModule("../../lib/orderNumber.js", () => ({
      generateBookingOrderNumber: jest.fn(async () => `SC-ISOLATED-MULTI-${++nextOrder}`),
    }));
    jest.unstable_mockModule("../../lib/groupTotals.js", () => ({
      syncBookingGroupTotal: jest.fn(async () => undefined),
    }));
    const realtime = await import("../../lib/supabase.js");
    jest.unstable_mockModule("../../lib/supabase.js", () => ({
      ...realtime,
      broadcastAvailabilityChange: jest.fn(async () => undefined),
    }));
    const { default: express } = await import("express");
    const { default: supertest } = await import("supertest");
    const { default: router } = await import("../bookings.js");
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.log = { info: () => undefined, error: () => undefined };
      next();
    });
    app.use("/api", router);
    request = supertest(app);
  }, 30000);

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE sport_center.booking_history, sport_center.booking_groups, sport_center.sport_bookings, sport_center.blocked_schedules");
  });

  const dates = ["2026-12-04", "2026-12-11", "2026-12-18"];
  const sessions = [5, 2].flatMap(facilityId =>
    dates.map(date => ({ facilityId, date, startTime: "19:00", durationHours: 2 })),
  );
  function submit(multiSessions: any[] = sessions) {
    return request.post("/api/bookings/admin-multi-schedule")
      .set("Authorization", "Bearer isolated-test")
      .send({
        customerName: "ISOLATED TEST ONLY", customerPhone: "628111222333",
        customerEmail: "", facilityId: 5, payerType: "personal",
        adminPaymentChoice: "unpaid", multiSessions,
      });
  }
  async function counts() {
    const { rows } = await pool.query(`
      SELECT (SELECT count(*)::int FROM sport_center.sport_bookings) AS bookings,
             (SELECT count(*)::int FROM sport_center.booking_groups) AS groups,
             (SELECT count(*)::int FROM sport_center.booking_history) AS history
    `);
    return rows[0];
  }

  test("creates six distinct Court A/B sessions in one group with correct facility and price", async () => {
    const response = await submit();
    expect(response.status).toBe(201);
    expect(response.body.totalBookings).toBe(6);
    expect(response.body.grandTotal).toBe(1_200_000);
    expect(await counts()).toEqual({ bookings: 6, groups: 1, history: 6 });
    const { rows } = await pool.query(`
      SELECT facility_id, booking_date, start_time, end_time, total_price, group_ref
      FROM sport_center.sport_bookings ORDER BY booking_date, facility_id
    `);
    expect(new Set(rows.map((row: any) => row.group_ref)).size).toBe(1);
    expect(rows.map((row: any) => Number(row.facility_id))).toEqual([2,5,2,5,2,5]);
    expect(rows.every((row: any) =>
      Number(row.total_price) === 200_000 &&
      String(row.start_time).startsWith("19:00") &&
      String(row.end_time).startsWith("21:00")
    )).toBe(true);
  });

  test("blocks second submission and preserves the original group", async () => {
    expect((await submit()).status).toBe(201);
    expect((await submit()).status).toBe(409);
    expect(await counts()).toEqual({ bookings: 6, groups: 1, history: 6 });
  });

  test("one Court B blocked slot prevents all six inserts", async () => {
    await pool.query(`
      INSERT INTO sport_center.blocked_schedules (facility_id, date, start_time, end_time, reason)
      VALUES (2, '2026-12-11', '19:30', '20:30', 'ISOLATED TEST BLOCK')
    `);
    const response = await submit();
    expect([400, 409]).toContain(response.status);
    expect(await counts()).toEqual({ bookings: 0, groups: 0, history: 0 });
  });

  test("same-court overlapping sessions are rejected without writes", async () => {
    const duplicate = { ...sessions[0]!, startTime: "20:00" };
    expect((await submit([...sessions, duplicate])).status).toBe(400);
    expect(await counts()).toEqual({ bookings: 0, groups: 0, history: 0 });
  });
});
