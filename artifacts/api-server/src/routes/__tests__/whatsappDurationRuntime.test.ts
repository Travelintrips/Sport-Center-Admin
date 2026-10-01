import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { eq } from "drizzle-orm";
import { db, facilitiesTable, waBookingSessionsTable } from "@workspace/db";
import { createSession, getActiveSession, todayWIB } from "../../lib/waBookingSession";

jest.unstable_mockModule("../../lib/whatsappSafety.js", () => ({
  allowWhatsAppProviderSend: jest.fn(() => true),
}));

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
const originalMinaProvider = process.env.CST_WA_MINA_PROVIDER;

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
    // This suite is specifically a Fonnte webhook/runtime regression test and
    // asserts Fonnte request bodies. Keep it isolated from a CI/host environment
    // that may also provide CST WA Gateway credentials.
    process.env.CST_WA_MINA_PROVIDER = "fonnte";
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
    if (originalMinaProvider === undefined) delete process.env.CST_WA_MINA_PROVIDER;
    else process.env.CST_WA_MINA_PROVIDER = originalMinaProvider;
    await db.delete(waBookingSessionsTable).where(eq(waBookingSessionsTable.phone, phone));
    if (createdFacility) {
      await db.delete(facilitiesTable).where(eq(facilitiesTable.id, facilityId));
    }
  });

  it("greets a salutation and opens the facility list when the customer replies Booking", async () => {
    const outboundStart = fonnteSendCalls(fetchMock).length;

    const greetingResponse = await request
      .post("/api/wa/fonnte/webhook")
      .send({
        sender: phone,
        message: "Selamat pagi",
        name: "Mina regression",
        device: "081234567890",
        inboxid: "8998",
        id: "mina-greeting-booking-regression-1",
      });
    expect(greetingResponse.status).toBe(200);
    const greetingBody = fonnteSendCalls(fetchMock)[outboundStart]?.[1]?.body as FormData;
    expect(String(greetingBody?.get("message"))).toBe(
      "Halo! Aku Mina asisten Sport Center Ada yang bisa Mina bantu hari ini? " +
      "Mau booking fasilitas, cukup ketik Booking.",
    );

    const bookingResponse = await request
      .post("/api/wa/fonnte/webhook")
      .send({
        sender: phone,
        message: "Booking",
        name: "Mina regression",
        device: "081234567890",
        inboxid: "8999",
        id: "mina-greeting-booking-regression-2",
      });
    expect(bookingResponse.status).toBe(200);
    const facilityListBody = fonnteSendCalls(fetchMock)[outboundStart + 1]?.[1]?.body as FormData;
    const facilityListMessage = String(facilityListBody?.get("message") ?? "");
    expect(facilityListMessage).toContain("Fasilitas tersedia:");
    expect(facilityListMessage).toContain("Sebutkan nama fasilitas");
    expect(facilityListMessage).not.toContain("Fasilitas tidak ditemukan");

    const session = await getActiveSession(phone);
    expect(session).toMatchObject({
      facilityId: null,
      currentStep: "ask_facility",
    });
  }, 30_000);

  it("routes Court A → lanjut di sini → Tri → besok → 2 jam to outbound availability before webhook ACK", async () => {
    const setupMessages = ["Court A", "lanjut di sini", "Tri", "besok (tanggal 22)"];
    const setupOutboundStart = fonnteSendCalls(fetchMock).length;

    for (const [index, message] of setupMessages.entries()) {
      const response = await request
        .post("/api/wa/fonnte/webhook")
        .send({
          sender: phone,
          message,
          name: "Mina regression",
          device: "081234567890",
          inboxid: `900${index}`,
          id: `mina-duration-regression-${index}`,
        });
      expect(response.status).toBe(200);
      await waitFor(() => fonnteSendCalls(fetchMock).length >= setupOutboundStart + index + 1);
    }

    let releaseFinalSend!: () => void;
    const blockedFonnteResponse = new Promise<Response>((resolve) => {
      releaseFinalSend = () => resolve(new Response(JSON.stringify({ status: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    });
    let blockNextFonnteSend = true;
    fetchMock.mockImplementation(async (url: unknown) => {
      if (blockNextFonnteSend && String(url).startsWith("https://api.fonnte.com/send")) {
        blockNextFonnteSend = false;
        return blockedFonnteResponse;
      }
      return new Response(JSON.stringify({ status: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    let webhookSettled = false;
    const finalWebhook = request
      .post("/api/wa/fonnte/webhook")
      .send({
        sender: phone,
        message: "2 jam",
        name: "Mina regression",
        device: "081234567890",
        inboxid: "9004",
        id: "mina-duration-regression-4",
      })
      .then((response: any) => {
        webhookSettled = true;
        return response;
      });

    await waitFor(() =>
      fonnteSendCalls(fetchMock).length >= setupOutboundStart + setupMessages.length + 1,
    );
    expect(webhookSettled).toBe(false);

    releaseFinalSend();
    const response = await finalWebhook;
    expect(response.status).toBe(200);

    const sentMessages = fonnteSendCalls(fetchMock).map(([, init]: [unknown, RequestInit?]) => {
      const body = init?.body;
      if (body instanceof FormData) {
        return {
          target: String(body.get("target") ?? ""),
          message: String(body.get("message") ?? ""),
          connectOnly: body.get("connectOnly"),
          inboxid: body.get("inboxid"),
        };
      }
      return JSON.parse(String(body ?? "{}")) as {
        target?: string;
        message?: string;
        connectOnly?: unknown;
        inboxid?: unknown;
      };
    });
    const finalOutbounds = sentMessages.slice(
      setupOutboundStart + setupMessages.length,
    );
    const combinedFinalMessage = finalOutbounds
      .map((outbound: { message?: string }) => outbound.message ?? "")
      .join("\n\n");

    expect(finalOutbounds).toHaveLength(1);
    expect(finalOutbounds[0]?.target).toBe(phone);
    expect(finalOutbounds[0]?.inboxid).toBe("9004");
    expect(finalOutbounds[0]?.connectOnly).toBeNull();

    const originalMessage = finalOutbounds[0]?.message ?? "";
    expect(originalMessage).toBe(
      "Jam berapa mau mulai?\nContoh: jam 8 pagi, jam 20.00, 19:00",
    );
    expect(originalMessage).not.toContain("Slot tersedia tanggal");
    expect(originalMessage).not.toContain("|");
    expect(originalMessage).not.toMatch(/[⏰🟢]/u);

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

    // Fonnte may send Mina's own greeting back as an inbound webhook. It must
    // not be routed through the active ask_time session as customer input.
    const outboundBeforeEcho = fonnteSendCalls(fetchMock).length;
    const echoResponse = await request
      .post("/api/wa/fonnte/webhook")
      .send({
        sender: phone,
        message: "Halo! Aku Mina asisten Sport Center Ada yang bisa Mina bantu hari ini?\n\n> Sent via fonnte.com",
        name: "Mina",
        device: "081234567890",
        inboxid: "9005",
        id: "mina-greeting-echo-regression",
      });
    expect(echoResponse.status).toBe(200);
    expect(fonnteSendCalls(fetchMock).length).toBe(outboundBeforeEcho);
  }, 45_000);
});

function fonnteSendCalls(fetchMock: any): Array<[unknown, RequestInit?]> {
  return (fetchMock.mock.calls as Array<[unknown, RequestInit?]>).filter(([url]) =>
    String(url).startsWith("https://api.fonnte.com/send"),
  );
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect(predicate()).toBe(true);
}