import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { eq } from "drizzle-orm";
import { db, facilitiesTable, waBookingSessionsTable } from "@workspace/db";
import { createSession, getActiveSession, todayWIB } from "../../lib/waBookingSession";

jest.unstable_mockModule("../../lib/fonnteConfig.js", () => ({
  getFonnteConfig: jest.fn(async () => ({
    adminToken: "",
    adminTokenSource: "missing",
    customerToken: "test-token",
    customerTokenSource: "environment",
    customerDevice: "6281234567890",
    customerDeviceSource: "environment",
  })),
  selectFonnteToken: (config: { customerToken: string }, useCustomerToken: boolean) =>
    useCustomerToken ? config.customerToken : "",
  validateMinaFonnteWebhookDevice: jest.fn(async () => ({
    accepted: true,
    providedDevice: "6281234567890",
    configuredDevice: "6281234567890",
    source: "environment",
  })),
}));

const phone = `62899${Date.now().toString().slice(-8)}`;

describe("Mina WhatsApp duration runtime regression", () => {
  let request: any;
  let facilityId: number;
  let createdFacility = false;
  let fetchMock: any;

  beforeAll(async () => {
    process.env.AI_SPORTCENTER_ENABLED = "false";
    process.env.APP_ENV = "production";
    process.env.FONNTE_CUSTOMER_DEVICE = "081234567890";
    process.env.FONNTE_CUSTOMER_TOKEN = "test-token";
    process.env.WA_DEV_MINA_TEST_RECIPIENT = phone;

    const existingFacilities = await db.select().from(facilitiesTable);
    const existing = existingFacilities.find(
      (facility) =>
        facility.isActive &&
        facility.bookingMode !== "walk_in" &&
        facility.name.toLowerCase().includes("court a"),
    );
    if (existing) {
      facilityId = existing.id;
    } else {
      const [created] = await db
        .insert(facilitiesTable)
        .values({
          name: "Court A",
          category: "Badminton",
          pricePerHour: "100000",
          openTime: "06:00",
          closeTime: "22:00",
          minDuration: 1,
          bookingMode: "time_slot",
          isActive: true,
        })
        .returning({ id: facilitiesTable.id });
      facilityId = created.id;
      createdFacility = true;
    }

    await createSession({
      phone,
      facilityId: null,
      bookingDate: null,
      startTime: null,
      durationMinutes: null,
      customerName: null,
      currentStep: "ask_facility",
      bookerName: "Mina regression",
    });

    fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ status: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const { default: express } = await import("express");
    const { default: supertest } = await import("supertest");
    const { default: whatsappRouter } = await import("../whatsapp.js");
    const app = express();
    app.use(express.json());
    app.use("/api", whatsappRouter);
    request = supertest(app);
  });

  afterAll(async () => {
    fetchMock?.mockRestore();
    await db.delete(waBookingSessionsTable).where(eq(waBookingSessionsTable.phone, phone));
    if (createdFacility) {
      await db.delete(facilitiesTable).where(eq(facilitiesTable.id, facilityId));
    }
  });

  it("routes Court A → lanjut di sini → Tri → besok → 2 jam to outbound availability", async () => {
    const messages = ["Court A", "lanjut di sini", "Tri", "besok (tanggal 22)", "2 jam"];

    for (const [index, message] of messages.entries()) {
      const response = await request
        .post("/api/wa/fonnte/webhook")
        .send({
          sender: phone,
          message,
          name: "Mina regression",
          device: "081234567890",
          id: `mina-duration-regression-${index}`,
        });
      expect(response.status).toBe(200);
      await waitFor(() => fetchMock.mock.calls.length >= index + 1);
    }

    const sentMessages = fetchMock.mock.calls.map(([, init]: [unknown, RequestInit?]) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { target?: string; message?: string };
      return body;
    });
    const lastOutbound = sentMessages.at(-1);
    expect(lastOutbound?.target).toBe(phone);
    expect(lastOutbound?.message).toContain("Slot tersedia");
    expect(lastOutbound?.message).toMatch(/Silakan pilih jam mulai|pilih jam/i);

    const session = await getActiveSession(phone);
    expect(session).not.toBeNull();
    expect(session).toMatchObject({
      facilityId,
      customerName: "Tri",
      durationMinutes: 120,
      currentStep: "ask_time",
      startTime: null,
    });
    expect(session?.bookingDate).toBeTruthy();
    expect(session?.bookingDate).not.toBe(todayWIB());
  }, 30_000);
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect(predicate()).toBe(true);
}