import { jest } from "@jest/globals";

const checkInMock = jest.fn<(...args: any[]) => Promise<any>>();
jest.unstable_mockModule("@workspace/db", () => ({ db: { execute: jest.fn() } }));
jest.unstable_mockModule("../lib/bookingLifecycle", () => ({ checkInBooking: checkInMock }));
jest.unstable_mockModule("../lib/logger", () => ({
  logger: { info: jest.fn(), error: jest.fn() },
}));
const { reconcileX904MissedNonmemberBookingCheckins } = await import("./x904MissedCheckinReconcile.js");

const row = {
  booking_id: 1809, booking_date: "2026-11-11", start_time: "21:03", end_time: "22:03",
  event_id: "device-proof-001", device_time: "2026-11-11 21:30:00",
};

describe("nonmember X904 scan reconciliation keeps existing booking lifecycle", () => {
  const prev = process.env.GYM_X904_NONMEMBER_BOOKING_CHECKIN_ENABLED;
  afterEach(() => {
    checkInMock.mockReset();
    if (prev === undefined) delete process.env.GYM_X904_NONMEMBER_BOOKING_CHECKIN_ENABLED;
    else process.env.GYM_X904_NONMEMBER_BOOKING_CHECKIN_ENABLED = prev;
  });
  test("default off does not even read database or write check-in", async () => {
    delete process.env.GYM_X904_NONMEMBER_BOOKING_CHECKIN_ENABLED;
    const store = { execute: jest.fn(async () => ({rows:[row]})) };
    expect(await reconcileX904MissedNonmemberBookingCheckins(store as any)).toBe(0);
    expect(store.execute).not.toHaveBeenCalled();
    expect(checkInMock).not.toHaveBeenCalled();
  });
  test("SC-1773 earlier PIN 16 scans must not trigger check-in", async () => {
    process.env.GYM_X904_NONMEMBER_BOOKING_CHECKIN_ENABLED = "true";
    const store = { execute: jest.fn(async () => ({rows:[
      {...row,device_time:"2026-11-11 19:28:07"},
      {...row,device_time:"2026-11-11 19:30:08"},
    ]})) };
    expect(await reconcileX904MissedNonmemberBookingCheckins(store as any)).toBe(0);
    expect(checkInMock).not.toHaveBeenCalled();
  });
  test("session-bound validated candidate calls the existing canonical check-in", async () => {
    process.env.GYM_X904_NONMEMBER_BOOKING_CHECKIN_ENABLED = "true";
    checkInMock.mockResolvedValue({ok:true,bookingId:1809,alreadyCompleted:false});
    const store = { execute: jest.fn(async () => ({rows:[row]})) };
    expect(await reconcileX904MissedNonmemberBookingCheckins(store as any)).toBe(1);
    expect(checkInMock).toHaveBeenCalledTimes(1);
    expect(checkInMock.mock.calls[0][0]).toBe(1809);
    expect(checkInMock.mock.calls[0][2]).toEqual(new Date("2026-11-11T21:30:00+07:00"));
  });
  test("canonical check-in rejection cannot count as successful use", async () => {
    process.env.GYM_X904_NONMEMBER_BOOKING_CHECKIN_ENABLED = "true";
    checkInMock.mockResolvedValue({ok:false,reason:"Booking sudah check-in"});
    const store = { execute: jest.fn(async () => ({rows:[row]})) };
    expect(await reconcileX904MissedNonmemberBookingCheckins(store as any)).toBe(0);
  });
});
