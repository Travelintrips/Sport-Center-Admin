import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  getCstWaGatewayPublicConfig,
  getCstWaGatewayInboundEvent,
  getCstWaGatewayMinaDeviceId,
  getCstWaGatewayReportDeviceId,
  listCstWaGatewayGroups,
  sendCstWaGatewayDirectMessage,
  sendCstWaGatewayGroupMessage,
} from "./cstWaGateway";

const originalUrl = process.env.CST_WA_GATEWAY_URL;
const originalToken = process.env.CST_WA_GATEWAY_TOKEN;

afterEach(() => {
  jest.restoreAllMocks();
  if (originalUrl === undefined) delete process.env.CST_WA_GATEWAY_URL;
  else process.env.CST_WA_GATEWAY_URL = originalUrl;
  if (originalToken === undefined) delete process.env.CST_WA_GATEWAY_TOKEN;
  else process.env.CST_WA_GATEWAY_TOKEN = originalToken;
});

describe("CST WA Gateway client", () => {
  it("keeps the API token server-side while exposing only public config", () => {
    process.env.CST_WA_GATEWAY_URL = "https://wa.cstlogistic.co.id/";
    process.env.CST_WA_GATEWAY_TOKEN = "secret-token";
    expect(getCstWaGatewayPublicConfig()).toEqual({
      configured: true,
      baseUrl: "https://wa.cstlogistic.co.id",
    });
  });

  it("lists group metadata through the sport-center client", async () => {
    process.env.CST_WA_GATEWAY_URL = "https://wa.cstlogistic.co.id";
    process.env.CST_WA_GATEWAY_TOKEN = "secret-token";
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        groups: [{
          id: "d8eda2ec-e559-45f0-8d3b-4425c7857d15",
          deviceId: "sport-center-report",
          jid: "120363428216180040@g.us",
          name: "Admin Sport center",
          subject: "Admin Sport center",
          participantCount: 8,
          isActive: true,
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const groups = await listCstWaGatewayGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]?.deviceId).toBe("sport-center-report");
  });

  it("sends group messages with groupId and idempotency key", async () => {
    process.env.CST_WA_GATEWAY_URL = "https://wa.cstlogistic.co.id";
    process.env.CST_WA_GATEWAY_TOKEN = "secret-token";
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        status: "queued",
        messageId: "a9222c2b-6dac-4195-a9fb-83aeb475fa18",
      }), { status: 202, headers: { "Content-Type": "application/json" } }),
    );

    const result = await sendCstWaGatewayGroupMessage({
      groupId: "d8eda2ec-e559-45f0-8d3b-4425c7857d15",
      text: "test",
      idempotencyKey: "booking:123",
    });

    expect(result.status).toBe("queued");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://wa.cstlogistic.co.id/v1/messages");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer secret-token",
      "Content-Type": "application/json",
      "Idempotency-Key": "booking:123",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      groupId: "d8eda2ec-e559-45f0-8d3b-4425c7857d15",
      type: "text",
      text: "test",
    });
  });

  it("uses a stable Mina device id so changing the paired phone does not change application routing", () => {
    const previous = process.env.CST_WA_MINA_DEVICE_ID;
    process.env.CST_WA_MINA_DEVICE_ID = "mina-ai-sport-center";
    expect(getCstWaGatewayMinaDeviceId()).toBe("mina-ai-sport-center");
    if (previous === undefined) delete process.env.CST_WA_MINA_DEVICE_ID;
    else process.env.CST_WA_MINA_DEVICE_ID = previous;
  });

  it("uses Sport Center Report as the stable admin/report device", () => {
    const previous = process.env.CST_WA_REPORT_DEVICE_ID;
    delete process.env.CST_WA_REPORT_DEVICE_ID;
    expect(getCstWaGatewayReportDeviceId()).toBe("sport-center-report");
    if (previous === undefined) delete process.env.CST_WA_REPORT_DEVICE_ID;
    else process.env.CST_WA_REPORT_DEVICE_ID = previous;
  });

  it("sends Mina direct replies through the Mina AI Sport Center device", async () => {
    process.env.CST_WA_GATEWAY_URL = "https://wa.cstlogistic.co.id";
    process.env.CST_WA_GATEWAY_TOKEN = "secret-token";
    process.env.CST_WA_MINA_DEVICE_ID = "mina-ai-sport-center";
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        status: "queued",
        messageId: "11111111-1111-4111-8111-111111111111",
      }), { status: 202, headers: { "Content-Type": "application/json" } }),
    );

    await sendCstWaGatewayDirectMessage({
      to: "6281111111111",
      text: "Halo dari Mina",
      idempotencyKey: "mina-test",
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://wa.cstlogistic.co.id/v1/messages");
    expect(JSON.parse(String(init?.body))).toEqual({
      deviceId: "mina-ai-sport-center",
      to: "6281111111111",
      type: "text",
      text: "Halo dari Mina",
    });
  });

  it("verifies inbound events through the authenticated gateway callback endpoint", async () => {
    process.env.CST_WA_GATEWAY_URL = "https://wa.cstlogistic.co.id";
    process.env.CST_WA_GATEWAY_TOKEN = "secret-token";
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        deliveryId: "22222222-2222-4222-8222-222222222222",
        eventType: "message.received",
        companyId: "1",
        deviceId: "mina-ai-sport-center",
        payload: { senderPhone: "6281111111111" },
        createdAt: "2026-09-30T06:00:00.000Z",
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const event = await getCstWaGatewayInboundEvent("22222222-2222-4222-8222-222222222222");
    expect(event.deviceId).toBe("mina-ai-sport-center");
    expect(event.companyId).toBe("1");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://wa.cstlogistic.co.id/v1/inbound-events/22222222-2222-4222-8222-222222222222",
    );
  });

});
