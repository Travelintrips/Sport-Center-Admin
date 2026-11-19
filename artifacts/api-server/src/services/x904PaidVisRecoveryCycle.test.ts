import { jest } from "@jest/globals";
import { processPaidVisRecoveryCycle } from "./x904PaidVisRecoveryCycle";

describe("paid VIS recovery within same guarded worker tick", () => {
  test("newly recovered VIS grant gets one immediate second worker pass", async () => {
    const events: string[] = [];
    const process = jest.fn(async () => { events.push("process"); });
    const recover = jest.fn(async () => { events.push("recover"); return 1; });
    await processPaidVisRecoveryCycle(process, recover);
    expect(events).toEqual(["process", "recover", "process"]);
    expect(process).toHaveBeenCalledTimes(2);
    expect(recover).toHaveBeenCalledTimes(1);
  });
  test("no new allocation means no redundant second pass", async () => {
    const process = jest.fn(async () => undefined);
    const recover = jest.fn(async () => 0);
    await processPaidVisRecoveryCycle(process, recover);
    expect(process).toHaveBeenCalledTimes(1);
  });
  test("transient recovery query failure leaves existing grants processed", async () => {
    const process = jest.fn(async () => undefined);
    const recover = jest.fn(async (): Promise<number> => { throw Error("temporary database error"); });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(processPaidVisRecoveryCycle(process, recover)).resolves.toBeUndefined();
      expect(process).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally { warn.mockRestore(); }
  });
  test("failed first guarded pass is not bypassed by recovery", async () => {
    const process = jest.fn(async () => { throw Error("worker unsafe"); });
    const recover = jest.fn(async () => 1);
    await expect(processPaidVisRecoveryCycle(process, recover)).rejects.toThrow("worker unsafe");
    expect(recover).not.toHaveBeenCalled();
  });
});
