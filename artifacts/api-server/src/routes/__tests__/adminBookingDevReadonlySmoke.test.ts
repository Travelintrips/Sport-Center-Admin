import { describe, expect, test } from "@jest/globals";

describe("Admin Lapangan DEV read-only HTTP readiness", () => {
  test("real DEV role authorizes detail GET without creating any booking or X904 command", async () => {
    if (process.env.ADMIN_BOOKING_DEV_READONLY_SMOKE !== "enabled" ||
        process.env.NODE_ENV !== "test" ||
        process.env.APP_ENV !== "development") {
      throw new Error("DEV_READONLY_SMOKE_NOT_OPTED_IN");
    }
    const raw = process.env.SUPABASE_DATABASE_URL_DEV;
    if (!raw || !raw.includes("xssrfshdrtdfupgqwfdw") ||
        raw.includes("nzdweipzckfszczzqtuw")) {
      throw new Error("CST_DEV_PROJECT_REQUIRED");
    }
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 16)
      throw new Error("TEST_SESSION_SECRET_REQUIRED");
    // Enforce PostgreSQL read-only at connection startup. Even if a route
    // accidentally writes, the server refuses the write before commit.
    const protectedUrl = new URL(raw);
    protectedUrl.searchParams.set("options", "-c default_transaction_read_only=on");
    process.env.SUPABASE_DATABASE_URL_DEV = protectedUrl.toString();
    const { pool } = await import("@workspace/db");
    const { default: express } = await import("express");
    const { default: supertest } = await import("supertest");
    const { default: routes } = await import("../waBookingsAdmin.js");
    const { createToken } = await import("../../lib/auth.js");
    try {
      const mode = await pool.query("SHOW default_transaction_read_only");
      expect(mode.rows[0].default_transaction_read_only).toBe("on");
      const roleResult = await pool.query(`SELECT id,role::text role,account_status
        FROM sport_center.users
        WHERE role::text='admin_booking' AND account_status='active'
        ORDER BY id LIMIT 2`);
      expect(roleResult.rows.length).toBe(1);
      const actor = roleResult.rows[0];
      const app=express();
      app.use(express.json());
      app.use("/api",routes);
      const request=supertest(app);
      const unknown="SC-DEV-AUTH-READONLY-NONEXISTENT";
      const detail=`/api/admin/wa-bookings/${unknown}/detail`;
      const monitoring=`/api/admin/wa-bookings/${unknown}/x904-monitoring`;
      const anonymous=await request.get(detail);
      expect([401,403]).toContain(anonymous.status);
      const signed=createToken(Number(actor.id),String(actor.role));
      const staff=await request.get(detail).set("Authorization",`Bearer ${signed}`);
      expect(staff.status).toBe(404);
      const machine=await request.get(monitoring).set("Authorization",`Bearer ${signed}`);
      expect(machine.status).toBe(404);
      const count=await pool.query(`SELECT count(*)::int n FROM sport_center.sport_bookings
        WHERE source='admin'`);
      console.info("ADMIN_BOOKING_DEV_GET_SMOKE_PASS",{
        anonymousDenied:true,adminRoleVerified:true,detailRoute404:true,
        monitoringRoute404:true,readOnly:true,
        existingAdminBookingCount:Number(count.rows[0].n),
      });
    } finally {
      await pool.end();
    }
  });
});
