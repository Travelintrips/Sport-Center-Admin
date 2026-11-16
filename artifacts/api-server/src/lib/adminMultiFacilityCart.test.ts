import { describe, expect, it } from "@jest/globals";
import { adminCartLockKeys, hasAdminCartOverlap, type AdminCartSession } from "./adminMultiFacilityCart";

const dates = ["2026-12-04", "2026-12-11", "2026-12-18"];
const sixSessions: AdminCartSession[] = [5, 2].flatMap(facilityId =>
  dates.map(date => ({ facilityId, date, startTime: "19:00", durationHours: 2 }))
);

describe("admin multi-facility booking cart", () => {
  it("accepts Court A and Court B on the same three dates and hours", () => {
    expect(sixSessions).toHaveLength(6);
    expect(hasAdminCartOverlap(sixSessions)).toBe(false);
    expect(sixSessions.reduce((hours, session) => hours + session.durationHours, 0)).toBe(12);
    expect(sixSessions.reduce((subtotal, session) => subtotal + session.durationHours * 100_000, 0)).toBe(1_200_000);
  });
  it("rejects overlapping sessions on the same court and date", () => {
    const duplicate = { ...sixSessions[0]!, startTime: "20:00" };
    expect(hasAdminCartOverlap([...sixSessions, duplicate])).toBe(true);
  });
  it("allows non-overlapping consecutive sessions on the same court", () => {
    const consecutive = { ...sixSessions[0]!, startTime: "21:00" };
    expect(hasAdminCartOverlap([...sixSessions, consecutive])).toBe(false);
  });
  it("locks all facility/date pairs once in deterministic order", () => {
    const locks = adminCartLockKeys([...sixSessions, sixSessions[0]!]);
    expect(locks).toHaveLength(6);
    expect(locks).toEqual([
      ...dates.map(date => ({ facilityId: 2, date })),
      ...dates.map(date => ({ facilityId: 5, date })),
    ]);
  });
  it("still supports the legacy single-facility cart", () => {
    const onlyA = sixSessions.filter(session => session.facilityId === 5);
    expect(hasAdminCartOverlap(onlyA)).toBe(false);
    expect(adminCartLockKeys(onlyA)).toHaveLength(3);
  });
});
