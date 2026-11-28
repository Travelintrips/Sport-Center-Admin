import { jest } from "@jest/globals";

jest.unstable_mockModule("./x904NonmemberDailyAccessWorker", () => ({
  processX904NonmemberDailyAccess: jest.fn(),
}));
const { wakeX904PaidGymAfterConfirmation } = await import("./x904PaidGymFastWake.js");
const flush = async () => {
  await new Promise<void>(resolve => setImmediate(resolve));
  await new Promise<void>(resolve => setImmediate(resolve));
};

describe("paid Gym post-commit wake with opt-out and intact periodic fallback", () => {
  const saved = process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED;
  afterEach(async () => {
    if (saved === undefined) delete process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED;
    else process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED = saved;
    await flush();
  });
  test("eligible committed payment wakes worker by default", async () => {
    delete process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED;
    const run = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    expect(wakeX904PaidGymAfterConfirmation(true, run)).toBe(true);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
  });
  test("explicit false disables wake without affecting periodic worker", async () => {
    process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED = "false";
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
  test("a failed first wake still executes the coalesced second payment wake", async () => {
    delete process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED;
    let rejectFirst: ((error: Error) => void) | undefined;
    const first = new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
    const run = jest.fn<() => Promise<void>>()
      .mockImplementationOnce(() => first)
      .mockResolvedValue(undefined);
    expect(wakeX904PaidGymAfterConfirmation(true, run)).toBe(true);
    await flush();
    expect(wakeX904PaidGymAfterConfirmation(true, run)).toBe(true);
    rejectFirst?.(new Error("ISOLATED_TRANSIENT_WORKER_FAILURE"));
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
  });
  test("one failed wake remains bounded and does not create a retry storm", async () => {
    delete process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED;
    const run = jest.fn<() => Promise<void>>().mockRejectedValue(new Error("ISOLATED_DB_UNAVAILABLE"));
    expect(wakeX904PaidGymAfterConfirmation(true, run)).toBe(true);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
  });
  test("payment arriving during the follow-up cycle is not lost", async () => {
    delete process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED;
    let releaseFirst: (() => void) | undefined;
    let releaseSecond: (() => void) | undefined;
    const run = jest.fn<() => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>(resolve => { releaseFirst = resolve; }))
      .mockImplementationOnce(() => new Promise<void>(resolve => { releaseSecond = resolve; }))
      .mockResolvedValue(undefined);
    expect(wakeX904PaidGymAfterConfirmation(true, run)).toBe(true);
    await flush();
    expect(wakeX904PaidGymAfterConfirmation(true, run)).toBe(true);
    releaseFirst?.();
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
    expect(wakeX904PaidGymAfterConfirmation(true, run)).toBe(true);
    releaseSecond?.();
    await flush();
    expect(run).toHaveBeenCalledTimes(3);
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
