import { describe, expect, it } from "@jest/globals";
import {
  getNearestAvailableSlots,
  hasSlotConflict,
  isRecentMessageDuplicate,
  formatAlternativeFacilityOptions,
  getAlternativeBookingDraftPatch,
  parseAlternativeBookingChoice,
  switchBookingFacility,
} from "./waBookingFlow";

describe("WhatsApp Mina booking flow regressions", () => {
  it("offers the one-message booking parser the complete required input", async () => {
    const { parseIntent, getNextStep } = await import("./waBookingSession");
    const parsed = parseIntent(
      "booking badminton besok jam 7 malam 2 jam atas nama Alif",
    );

    expect(parsed).toMatchObject({
      facilityKeyword: "badminton",
      startTime: "19:00",
      durationMinutes: 120,
      personName: "Alif",
    });
    expect(parsed.bookingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(
      getNextStep({
        facilityId: 7,
        bookingDate: parsed.bookingDate,
        startTime: parsed.startTime,
        durationMinutes: parsed.durationMinutes,
        customerName: parsed.personName,
      }),
    ).toBe("confirm");
  });

  it("asks only for the first missing required field in a partial booking", async () => {
    const { getNextStep, parseIntent } = await import("./waBookingSession");
    const parsed = parseIntent("mau booking badminton besok");

    expect(parsed.facilityKeyword).toBe("badminton");
    expect(parsed.bookingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(
      getNextStep({
        facilityId: 7,
        bookingDate: parsed.bookingDate,
        startTime: parsed.startTime,
        durationMinutes: parsed.durationMinutes,
        customerName: "Robby",
      }),
    ).toBe("ask_duration");
  });

  it("prefers an existing customer identity and accepts a natural correction", async () => {
    const {
      parseIntent,
      resolveBookingCustomerName,
    } = await import("./waBookingSession");
    const correction = parseIntent("jamnya ganti jam 8, jadi 1 jam saja");

    expect(correction.startTime).toBe("08:00");
    expect(correction.durationMinutes).toBe(60);
    expect(resolveBookingCustomerName(null, "Robby", "WhatsApp User")).toBe(
      "Robby",
    );
  });

  it("returns at most three nearest slots and excludes blocked schedules", () => {
    expect(
      getNearestAvailableSlots({
        requestedStartTime: "19:00",
        durationMinutes: 120,
        openTime: "06:00",
        closeTime: "22:00",
        bookings: [
          { startTime: "18:00", endTime: "20:00", status: "confirmed" },
          { startTime: "08:00", endTime: "10:00", status: "cancelled" },
        ],
        blockedSchedules: [{ startTime: "20:00", endTime: "22:00" }],
      }),
    ).toEqual(["16:00–18:00", "15:00–17:00", "14:00–16:00"]);
  });

  it("deduplicates a repeated WhatsApp message within the retry window", () => {
    const seen = new Map<string, number>();
    expect(isRecentMessageDuplicate(seen, "62812:booking badminton", 1000)).toBe(
      false,
    );
    expect(isRecentMessageDuplicate(seen, "62812:booking badminton", 5000)).toBe(
      true,
    );
    expect(
      isRecentMessageDuplicate(seen, "62812:booking badminton", 10_001),
    ).toBe(false);
  });

  it("keeps the final conflict predicate strict for concurrent slot attempts", () => {
    const slot = {
      startTime: "19:00",
      endTime: "21:00",
      bookings: [],
      blockedSchedules: [],
    };
    expect(hasSlotConflict(slot)).toBe(false);
    const committed = {
      ...slot,
      bookings: [{ startTime: "19:00", endTime: "21:00", status: "waiting_admin_approval" }],
    };
    expect(hasSlotConflict(committed)).toBe(true);
  });

  it("switches badminton Court A to Court B without resetting the booking draft", () => {
    const draft = {
      facilityId: 101,
      customerId: 7,
      customerName: "Robby Rahman",
      bookingDate: "2026-09-20",
      startTime: "19:00",
      durationMinutes: 120,
      notes: "latihan rutin",
    };

    const switched = switchBookingFacility(draft, 102);

    expect(switched).toEqual({
      ...draft,
      facilityId: 102,
    });
    expect(switched).not.toBe(draft);
  });

  it("keeps the WhatsApp alternative menu compact and parses natural replies", () => {
    expect(formatAlternativeFacilityOptions(["Badminton Court B"])).toBe(
      "1. Lihat slot Badminton Court B",
    );
    expect(parseAlternativeBookingChoice("1", ["Badminton Court B"], { allowNumericMenu: true })).toBe("facility");
    expect(parseAlternativeBookingChoice("tidak cocok", ["Badminton Court B"])).toBe("facility");
    expect(parseAlternativeBookingChoice("lapangan lain", ["Badminton Court B"])).toBe("facility");
    expect(parseAlternativeBookingChoice("ada lapangan lain?", ["Badminton Court B"])).toBe("facility");
    expect(parseAlternativeBookingChoice("cek Court B", ["Badminton Court B"])).toBe("facility");
    expect(parseAlternativeBookingChoice("Court B", ["Badminton Court B"])).toBe("facility");
    expect(parseAlternativeBookingChoice("ganti tanggal", ["Badminton Court B"])).toBe("date");
    expect(parseAlternativeBookingChoice("2", ["Badminton Court B"], { allowNumericMenu: true })).toBe("date");
    expect(parseAlternativeBookingChoice("3", ["Badminton Court B"], { allowNumericMenu: true })).toBe("duration");
    expect(parseAlternativeBookingChoice("2 jam", ["Badminton Court B"], { allowNumericMenu: true })).toBeNull();
    expect(parseAlternativeBookingChoice("2", ["Badminton Court B"])).toBeNull();
  });

  it("preserves the draft when choosing a new date or duration", () => {
    const draft = {
      facilityId: 101,
      customerId: 7,
      customerName: "Robby Rahman",
      bookingDate: "2026-09-20",
      startTime: "19:00",
      durationMinutes: 120,
      notes: "latihan rutin",
    };

    expect({
      ...draft,
      ...getAlternativeBookingDraftPatch("date"),
    }).toEqual({
      ...draft,
      bookingDate: null,
      startTime: null,
    });
    expect({
      ...draft,
      ...getAlternativeBookingDraftPatch("duration"),
    }).toEqual({
      ...draft,
      durationMinutes: null,
      startTime: null,
    });
  });
});