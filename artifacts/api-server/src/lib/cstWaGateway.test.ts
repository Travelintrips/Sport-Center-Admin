import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  getCstWaGatewayPublicConfig,
  listCstWaGatewayGroups,
  sendCstWaGatewayGroupMessage,
  sendCstWaGatewayTextMessage,
  verifyCstWaGatewayWebhookSignature,
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
          deviceId: "03",
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
    expect(groups[0]?.deviceId).toBe("03");
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

  it("sends Mina direct messages through a stable logical device id", async () => {
    process.env.CST_WA_GATEWAY_URL = "https://wa.cstlogistic.co.id";
    process.env.CST_WA_GATEWAY_TOKEN = "test-token";
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        status: "queued",
        messageId: "b9222c2b-6dac-4195-a9fb-83aeb475fa18",
      }), { status: 202, headers: { "Content-Type": "application/json" } }),
    );

    await sendCstWaGatewayTextMessage({
      deviceId: "mina-01",
      to: "6281111111111",
      text: "Halo dari Mina",
      idempotencyKey: "mina:test",
      replyToProviderMessageId: "provider-1",
    });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({
      deviceId: "mina-01",
      to: "6281111111111",
      type: "text",
      text: "Halo dari Mina",
      replyToProviderMessageId: "provider-1",
    });
  });

  it("verifies inbound signatures derived from the existing gateway client token", async () => {
    const crypto = await import("node:crypto");
    process.env.CST_WA_GATEWAY_TOKEN = "test-token";
    const rawBody = Buffer.from(JSON.stringify({ event: "message.received", deviceId: "mina-01" }));
    const derived = crypto
      .createHmac("sha256", "test-token")
      .update("cst-wa-gateway:webhook:v1")
      .digest("hex");
    const signature = crypto.createHmac("sha256", derived).update(rawBody).digest("hex");

    expect(verifyCstWaGatewayWebhookSignature(rawBody, signature)).toBe(true);
    expect(verifyCstWaGatewayWebhookSignature(rawBody, "0".repeat(64))).toBe(false);
  });

});
