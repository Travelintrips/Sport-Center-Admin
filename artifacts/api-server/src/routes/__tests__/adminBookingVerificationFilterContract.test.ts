import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const route = readFileSync(resolve(process.cwd(), "src/routes/bookings.ts"), "utf8");
const ui = readFileSync(resolve(process.cwd(), "../sport-center/src/pages/admin/Bookings.tsx"), "utf8");

describe("admin booking verification summary and table alignment", () => {
  test("summary counts the same two statuses that verification filter displays", () => {
    expect(route).toContain('booking.status === "waiting_confirmation" || booking.status === "paid"');
    expect(ui).toContain('filter: "needs_verification"');
    expect(ui).toContain('statusFilter === "needs_verification"');
    expect(ui).toContain('b.status !== "waiting_confirmation" && b.status !== "paid"');
    expect(route).toContain('normalizedStatus === "needs_verification"');
    expect(route).toContain('booking.status !== "waiting_confirmation" && booking.status !== "paid"');
  });

  test("paged API and UI still preserve exact filters for unrelated booking statuses", () => {
    expect(route).toContain('else if (normalizedStatus !== "all" && booking.status !== normalizedStatus) return false');
    expect(ui).toContain('else if (statusFilter !== "all" && b.status !== statusFilter) return false');
    expect(ui).toContain('status: statusFilter');
    expect(route).toContain('res.setHeader("X-Total-Count", String(totalRows))');
    expect(route).toContain('res.setHeader("X-Stats-Verification", String(verificationKeys.size))');
  });

  test("verification remains a view filter, not a payment/booking status mutation", () => {
    expect(ui).toContain('setStatusFilter(filter)');
    expect(route).not.toContain('booking.status = "needs_verification"');
    expect(ui).not.toContain('data: { status: "needs_verification" }');
  });
});
