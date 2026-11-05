import { afterEach, describe, expect, it, jest } from "@jest/globals";
import express from "express";
import supertest from "supertest";
import { db } from "@workspace/db";

// Exercise the actual deployed WhatsApp booking router using an isolated,
// in-memory query fixture. No Postgres writes, payment creation or X904 calls.
// The booking hour is deliberately invalid, so even a broken registry check
// must be stopped by operating-hours validation before any booking INSERT.
const { default: whatsappRouter } = await import("../whatsapp.js");
const app = express();
app.use(express.json());
app.use("/api", whatsappRouter);

const request = supertest(app);
const sqlText = (query: unknown): string => {
  if (query && typeof query === "object" && "queryChunks" in query) {
    return JSON.stringify((query as any).queryChunks);
  }
  return String(query);
};

const facility = {
  id: 6,
  name: "Gym / Fitness Center",
  category: "Fitness",
  bookingMode: "walk_in",
  isActive: true,
  openTime: "06:00",
  closeTime: "23:00",
  pricePerHour: "30000",
};

const basePayload = {
  customerName: "NEGATIVE API TEST",
  customerPhone: "08000000000",
  facilityId: 6,
  bookingDate: "2026-11-06",
  startTime: "00:00",
  durationHours: 1,
  x904IdentityType: "pin",
};

function mockFixture(pin: string, role = 0) {
  const selectSpy = jest.spyOn(db, "select").mockImplementation((() => ({
    from: () => ({ where: () => ({ limit: async () => [facility] }) }),
  })) as any);
  const seen: string[] = [];
  const executeSpy = jest.spyOn(db, "execute").mockImplementation((async (query: unknown) => {
    const text = sqlText(query);
    seen.push(text);
    if (text.includes("gym_x904_lan_users")) {
      return { rows: [{
        user_pin: pin,
        device_uid: pin === "200" ? 337 : pin === "500" ? 5 : 342,
        display_name: pin === "200" ? "TEST SUSPEND X904" :
          pin === "500" ? "X904_TEST_500" : "YUDA",
        device_role: role,
      }] } as any;
    }
    if (text.includes("x904_verified_nonmember_identities")) return { rows: [] } as any;
    throw new Error("Unexpected database query: fail closed");
  }) as any);
  return { seen, selectSpy, executeSpy };
}

afterEach(() => jest.restoreAllMocks());

describe("actual WhatsApp booking HTTP registry rejection (no database writes)", () => {
  it("returns 409 for unverified test PIN 200 before creating booking", async () => {
    const { seen } = mockFixture("200");
    const response = await request.post("/api/wa/booking").send({
      ...basePayload, x904IdentityValue: "200",
    });
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/belum terverifikasi pada registry X904/);
    expect(seen.some((sql) => sql.includes("gym_x904_lan_users"))).toBe(true);
    expect(seen.some((sql) => sql.includes("x904_verified_nonmember_identities"))).toBe(true);
  });

  it("returns 409 for test PIN 500 without generating a booking", async () => {
    const { seen } = mockFixture("500", 1);
    const response = await request.post("/api/wa/booking").send({
      ...basePayload, x904IdentityValue: "500",
    });
    expect(response.status).toBe(409);
    expect(seen.some((sql) => sql.includes("gym_x904_lan_users"))).toBe(true);
  });

  it("does not create booking when unverified PIN attempts a future visit", async () => {
    mockFixture("200");
    const response = await request.post("/api/wa/booking").send({
      ...basePayload, x904IdentityValue: "200", bookingDate: "2026-11-07",
    });
    expect(response.status).toBe(409);
  });
});
