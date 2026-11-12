import { jest } from "@jest/globals";

jest.unstable_mockModule("./x904NonmemberDailyAccessWorker", () => ({
  processX904NonmemberDailyAccess: jest.fn(),
}));
const { wakeX904PaidGymAfterConfirmation } = await import("./x904PaidGymFastWake.js");
const flush = async () => {
  await new Promise<void>(resolve => setImmediate(resolve));
  await new Promise<void>(resolve => setImmediate(resolve));
};

describe("paid Gym wake is optional and does not touch existing periodic X904 worker", () => {
  const saved = process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED;
  afterEach(async () => {
    if (saved === undefined) delete process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED;
    else process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED = saved;
    await flush();
  });
  test("disabled by default: no extra worker run", async () => {
    delete process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED;
    const run = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    expect(wakeX904PaidGymAfterConfirmation(true, run)).toBe(false);
    await flush();
    expect(run).not.toHaveBeenCalled();
  });
  test("unconfirmed or unrelated payment never triggers", async () => {
    process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED = "true";
    const run = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    expect(wakeX904PaidGymAfterConfirmation(false, run)).toBe(false);
    await flush();
    expect(run).not.toHaveBeenCalled();
  });
  test("confirmed guest invokes existing worker on next microtask", async () => {
    process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED = "true";
    const run = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    expect(wakeX904PaidGymAfterConfirmation(true, run)).toBe(true);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
  });
  test("simultaneous callbacks coalesce into at most one follow-up cycle", async () => {
    process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED = "true";
    let release: (() => void) | undefined;
    const run = jest.fn<() => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }))
      .mockResolvedValue(undefined);
    expect(wakeX904PaidGymAfterConfirmation(true, run)).toBe(true);
    await flush();
    expect(wakeX904PaidGymAfterConfirmation(true, run)).toBe(true);
    expect(wakeX904PaidGymAfterConfirmation(true, run)).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    release?.();
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
  });
});
