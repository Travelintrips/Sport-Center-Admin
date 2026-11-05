import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  x904NonmemberOpeningHours,
  x904NonmemberEffectiveExpiry,
  x904NonmemberSameWibDate,
  decideNonmemberX904Access,
} from "./x904NonmemberAccessPolicy";

const instant = (time: string) => new Date(time + "+07:00");

describe("X904 06:00-23:00 WIB 12-hour maximum access contract", () => {
  it("YUDA activated 18:23:46 must suspend at 23:00 without reopening next morning", () => {
    const start = instant("2026-11-05T18:23:46");
    const end = instant("2026-11-05T23:00:00");
    const originalEnd = instant("2026-11-06T06:23:46");
    expect(x904NonmemberEffectiveExpiry(start, originalEnd)?.getTime()).toBe(end.getTime());
    const input = {
      verifiedNonmemberPin: true, userPin: "8", deviceRole: 0,
      confirmedPaymentAt: start, paymentState: "confirmed" as const, currentGroup: 1,
      now: instant("2026-11-05T22:59:59"),
    };
    expect(decideNonmemberX904Access(input)).toBe("correct");
    expect(decideNonmemberX904Access({ ...input, now: end })).toBe("suspend");
    expect(decideNonmemberX904Access({
      ...input, now: instant("2026-11-06T06:00:00"),
    })).toBe("suspend");
  });

  it("facility is closed at 23:00 and before 06:00 exactly", () => {
    expect(x904NonmemberOpeningHours(instant("2026-11-05T22:59:59"))).toBe(true);
    expect(x904NonmemberOpeningHours(instant("2026-11-05T23:00:00"))).toBe(false);
    expect(x904NonmemberOpeningHours(instant("2026-11-06T05:59:59"))).toBe(false);
    expect(x904NonmemberOpeningHours(instant("2026-11-06T06:00:00"))).toBe(true);
  });

  it("a pending grant from yesterday cannot reactivate on today's opening", () => {
    expect(x904NonmemberSameWibDate(
      instant("2026-11-05T22:59:59"), instant("2026-11-05T08:00:00"),
    )).toBe(true);
    expect(x904NonmemberSameWibDate(
      instant("2026-11-06T06:00:00"), instant("2026-11-05T08:00:00"),
    )).toBe(false);
  });

  it("worker uses cutoff for activation, overlap and verified physical suspension", () => {
    const source = readFileSync(join(process.cwd(), "src/services/x904NonmemberDailyAccessWorker.ts"), "utf8");
    expect(source).toContain("x904NonmemberEffectiveExpiry(activeStart");
    expect(source).toContain("x904NonmemberOpeningHours(now)");
    expect(source).toContain("x904NonmemberSameWibDate(now, new Date(scheduledStart))");
    expect(source).toContain("AND other.activated_at IS NOT NULL");
    expect(source).toContain("LEAST(other.expires_at");
    expect(source).toContain("expires_at=LEAST(");
    expect(source).toContain("readBackConfirmed");
    expect(source).toContain("afterGroup");
    expect(source).toContain("AUTO_NONMEMBER_GYM_12H");
    expect(source).toContain("isX904AutoSuspendExempt(pin, Number(entries[0].role))");
  });

  it("migration changes only active grant clocks and preserves rolling-deploy compatibility", () => {
    const source = readFileSync("migrations/20261105_x904_nonmember_2300_wib_cutoff.sql", "utf8");
    expect(source).toContain("x904_nonmember_business_hours_clock_check");
    expect(source).toContain("OR expires_at = activated_at + interval '12 hours'");
    expect(source).toContain("WHERE access_state = 'active' AND activated_at IS NOT NULL");
    expect(source).toContain("time '23:00'");
    expect(source).toContain("VALIDATE CONSTRAINT");
  });
});
