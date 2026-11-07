import { readFileSync } from "fs";
import { resolvePaidX904Automation, canRecordTrustedGymX904Checkin } from "./gymMembershipEntitlement";

const worker = readFileSync("src/services/x904MissedCheckinReconcile.ts", "utf8");
const migration = readFileSync("migrations/20261107_x904_lan_paid_grace_checkin_guard.sql", "utf8");
const base = {
  today: "2026-11-07", membershipStart: "2026-10-03", membershipEnd: "2026-11-03",
  membershipStatus: "active", paymentSourcesComplete: true,
  payments: [{ id: 71, periodStart: "2026-10-03", periodEnd: "2026-11-03", status: "confirmed", amount: 300000 }],
};

describe("Existing LAN reconciliation extends the proven paid grace contract", () => {
  it("accepts confirmed SHIDQI grace while activation remains a hold", () => {
    expect(canRecordTrustedGymX904Checkin(base)).toBe(true);
    expect(resolvePaidX904Automation(base)).toBe("grace_period");
  });
  it("rejects day eight, unrelated previous payments, pending-only, and expired state", () => {
    expect(canRecordTrustedGymX904Checkin({ ...base, today: "2026-11-11" })).toBe(false);
    expect(canRecordTrustedGymX904Checkin({ ...base, payments: [{ ...base.payments[0], periodEnd: "2026-10-20" }] })).toBe(false);
    expect(canRecordTrustedGymX904Checkin({ ...base, payments: [{ ...base.payments[0], status: "waiting_confirmation" }] })).toBe(false);
    expect(canRecordTrustedGymX904Checkin({ ...base, membershipStatus: "expired" })).toBe(false);
  });
  it("applies identical paid-expiry, seven-day, confirmed-positive guards in worker and SQL", () => {
    for (const str of ["p.status='confirmed'", "p.amount>0", "p.period_start<=m.end_date", "p.period_end>=m.end_date", "m.end_date::date+7"])
      expect(worker).toContain(str);
    for (const str of ["p.status='confirmed'", "p.amount>0", "p.period_start<=v_member.end_date", "p.period_end>=v_member.end_date", "v_member.end_date::date+7"])
      expect(migration).toContain(str);
  });
  it("keeps first scan selection and duplicate protection, no new activations", () => {
    expect(worker).toContain("DISTINCT ON (l.user_pin, left(l.device_time,10))");
    expect(worker).toContain("NOT EXISTS (SELECT 1 FROM sport_center.gym_checkins c");
    expect(migration).toContain("pg_advisory_xact_lock(904,v_member.membership_id)");
    expect(migration).toContain("on conflict do nothing returning id into v_checkin_id");
    expect(worker).not.toContain("ACTIVATE_USER");
  });
});
