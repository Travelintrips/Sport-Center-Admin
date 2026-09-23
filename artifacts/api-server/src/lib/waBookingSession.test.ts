import { describe, expect, it } from "@jest/globals";
import {
  detectFacilityKeyword,
  getNextStep,
  parseIntent,
  resolveBookingCustomerName,
} from "./waBookingSession";

describe("Mina natural-language booking session", () => {
  it("extracts a complete one-message booking", () => {
    const parsed = parseIntent(
      "booking badminton besok jam 7 malam 2 jam atas nama Alif",
    );

    expect(parsed.facilityKeyword).toBe("badminton");
    expect(parsed.bookingDate).toBeTruthy();
    expect(parsed.startTime).toBe("19:00");
    expect(parsed.durationMinutes).toBe(120);
    expect(parsed.personName).toBe("Alif");
  });

  it("preserves the explicit badminton court variant", () => {
    expect(detectFacilityKeyword("badminton court b")).toBe("badminton court b");
    expect(parseIntent("mau booking badminton court b besok").facilityKeyword).toBe(
      "badminton court b",
    );
    expect(detectFacilityKeyword("mau badminton")).toBe("badminton");
  });

  it("keeps partial booking input focused on only the missing required fields", () => {
    const parsed = parseIntent("mau badminton besok");

    expect(parsed.facilityKeyword).toBe("badminton");
    expect(parsed.bookingDate).toBeTruthy();
    expect(getNextStep({
      facilityId: 12,
      bookingDate: parsed.bookingDate,
      startTime: parsed.startTime,
      durationMinutes: parsed.durationMinutes,
      customerName: null,
    })).toBe("ask_name");
  });

  it("always asks for the booking name before a date when the name is missing", () => {
    expect(getNextStep({
      facilityId: 12,
      bookingDate: "2026-09-24",
      startTime: null,
      durationMinutes: null,
      customerName: null,
    })).toBe("ask_name");
  });

  it("uses an existing customer or WhatsApp profile name before asking again", () => {
    expect(resolveBookingCustomerName(null, "Sinta Dewi", "6281111111111")).toBe("Sinta Dewi");
    expect(resolveBookingCustomerName(null, null, "Alif")).toBe("Alif");
    expect(resolveBookingCustomerName(null, null, "6281111111111")).toBeNull();
  });

  it("parses corrections as a new complete set of fields", () => {
    const parsed = parseIntent("jamnya ganti jam 8, jadi 1 jam saja, besoknya lusa");

    expect(parsed.bookingDate).toBeTruthy();
    expect(parsed.startTime).toBe("08:00");
    expect(parsed.durationMinutes).toBe(60);
  });

  it("parses prefixed morning times used by the sequential WhatsApp flow", () => {
    expect(parseIntent("jam 6 pagi")).toMatchObject({
      startTime: "06:00",
      durationMinutes: null,
    });
  });

  it("does not make optional notes a required step", () => {
    expect(getNextStep({
      facilityId: 12,
      bookingDate: "2026-09-20",
      startTime: "19:00",
      durationMinutes: 120,
      customerName: "Alif",
      notes: null,
    })).toBe("confirm");
  });
});