import { x904NonmemberScheduledStart } from "./x904NonmemberDailyAccessWorker";

test("future paid VIS002 booking never starts at payment date", () => {
  const start = x904NonmemberScheduledStart("2026-11-12", "06:00");
  expect(start).toBe(Date.parse("2026-11-12T06:00:00+07:00"));
  expect(Date.parse("2026-11-05T18:45:00+07:00")).toBeLessThan(start!);
});
test("existing same-day VIS001 visit uses the session date and survives old dates", () => {
  expect(x904NonmemberScheduledStart("2026-11-05", "06:00")).toBe(Date.parse("2026-11-05T06:00:00+07:00"));
  expect(x904NonmemberScheduledStart("2026-11-03", "06:00")).toBeLessThan(Date.parse("2026-11-05T18:00:00+07:00"));
});
test("invalid dates fail closed", () => {
  expect(x904NonmemberScheduledStart("2026-11-99", "06:00")).toBeNull();
  expect(x904NonmemberScheduledStart("2026-11-12", "invalid")).toBeNull();
  expect(x904NonmemberScheduledStart(null, null)).toBeNull();
});
