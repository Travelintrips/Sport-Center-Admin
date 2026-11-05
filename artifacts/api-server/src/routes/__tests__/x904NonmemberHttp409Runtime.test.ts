import { afterEach, describe, expect, it, jest } from "@jest/globals";
import express from "express";
import supertest from "supertest";
import { db } from "@workspace/db";

// Real Express/WhatsApp booking route, isolated in-memory query responses.
// The time 00:00 is outside Gym hours (06:00–23:00): no valid booking
// can be created even if the registry check regresses.
const { default: whatsappRouter } = await import("../whatsapp.js");
const app = express();
app.use(express.json());
app.use("/api", whatsappRouter);
const request = supertest(app);

const sqlText = (query: unknown) =>
  query && typeof query === "object" && "queryChunks" in query
    ? JSON.stringify((query as any).queryChunks)
    : String(query);

const facility = {
  id: 6, name: "Gym / Fitness Center", category: "Fitness",
  bookingMode: "walk_in", isActive: true, openTime: "06:00",
  closeTime: "23:00", pricePerHour: "30000",
};
const payload = {
  customerName: "ISOLATED HTTP REGRESSION",
  customerPhone: "08000000000",
  facilityId: 6, bookingDate: "2026-11-06",
  startTime: "00:00", durationHours: 1,
};

function fixture(options: {
  pin: string;
  uid: number;
  name: string;
  role?: number;
  approved?: boolean;
}) {
  const queries: string[] = [];
  const reads = jest.spyOn(db, "select").mockImplementation((() => ({
    from: () => ({ where: () => ({ limit: async () => [facility] }) }),
  })) as any);
  const executes = jest.spyOn(db, "execute").mockImplementation((async (query: unknown) => {
    const text = sqlText(query);
    queries.push(text);
    if (text.includes("gym_x904_lan_users")) {
      return { rows: [{
        user_pin: options.pin, device_uid: options.uid,
        display_name: options.name, device_role: options.role ?? 0,
      }] } as any;
    }
    if (text.includes("x904_verified_nonmember_identities")) {
      return { rows: options.approved ? [{ "?column?": 1 }] : [] } as any;
    }
    if (text.includes("gym_x904_member_mapping") ||
        text.includes("x904_nonmember_daily_access")) {
      return { rows: [] } as any;
    }
    // The request must never reach booking writes, payment operations, or X904.
    throw new Error("Unexpected database operation");
  }) as any);
  const transaction = jest.spyOn(db, "transaction").mockImplementation((async () => {
    throw new Error("Unexpected booking transaction");
  }) as any);
  return { queries, reads, executes, transaction };
}

afterEach(() => jest.restoreAllMocks());

describe("X904 booking registry actual HTTP handler (isolated no writes)", () => {
  it.each([
    { pin: "200", uid: 337, name: "TEST SUSPEND X904" },
    { pin: "500", uid: 5, name: "X904_TEST_500" },
  ])("returns registry-specific HTTP 409 for unverified PIN $pin", async (identity) => {
    const evidence = fixture(identity); // role 0: must reach registry check
    const response = await request.post("/api/wa/booking").send({
      ...payload, x904IdentityType: "pin", x904IdentityValue: identity.pin,
    });
    expect(response.status).toBe(409);
    expect(response.body.error).toContain("belum terverifikasi pada registry X904");
    expect(evidence.queries.some(q => q.includes("gym_x904_lan_users"))).toBe(true);
    expect(evidence.queries.some(q => q.includes("x904_verified_nonmember_identities"))).toBe(true);
    expect(evidence.transaction).not.toHaveBeenCalled();
  });

  it("rejects device role 1 before reaching registry", async () => {
    const evidence = fixture({ pin: "500", uid: 5, name: "X904_TEST_500", role: 1 });
    const response = await request.post("/api/wa/booking").send({
      ...payload, x904IdentityType: "pin", x904IdentityValue: "500",
    });
    expect(response.status).toBe(409);
    expect(evidence.queries.some(q => q.includes("x904_verified_nonmember_identities"))).toBe(false);
    expect(evidence.transaction).not.toHaveBeenCalled();
  });

  it("allows verified YUDA past registry without booking outside hours", async () => {
    const evidence = fixture({ pin: "8", uid: 342, name: "YUDA", approved: true });
    const response = await request.post("/api/wa/booking").send({
      ...payload, x904IdentityType: "pin", x904IdentityValue: "8",
    });
    expect(evidence.queries.some(q => q.includes("x904_verified_nonmember_identities"))).toBe(true);
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/jam operasional/i);
    expect(evidence.transaction).not.toHaveBeenCalled();
  });

  it("keeps VIS001 card path outside ordinary PIN registry gate", async () => {
    const evidence = fixture({ pin: "78", uid: 338, name: "VIS 001" });
    const response = await request.post("/api/wa/booking").send({
      ...payload, x904IdentityType: "card", x904IdentityValue: "VIS001",
    });
    expect(evidence.queries.some(q => q.includes("x904_verified_nonmember_identities"))).toBe(false);
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/jam operasional/i);
    expect(evidence.transaction).not.toHaveBeenCalled();
  });

  it.each(["200", "500"])("rejects unverified PIN %s on read-only identity GET with HTTP 409", async pin => {
    const fixtureResult = mockFixture(pin, 0);
    const response = await request.get("/api/wa/x904-identity").query({
      type: "pin", value: pin,
    });
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/belum terverifikasi pada registry X904/);
    expect(fixtureResult.seen.some(q => q.includes("x904_verified_nonmember_identities"))).toBe(true);
  });

});
