import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCstWaGatewayPublicConfig,
  listCstWaGatewayGroups,
  sendCstWaGatewayGroupMessage,
} from "./cstWaGateway";

const originalUrl = process.env.CST_WA_GATEWAY_URL;
const originalToken = process.env.CST_WA_GATEWAY_TOKEN;

afterEach(() => {
  vi.unstubAllGlobals();
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
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      groups: [{
        id: "d8eda2ec-e559-45f0-8d3b-4425c7857d15",
        deviceId: "03",
        jid: "120363428216180040@g.us",
        name: "Admin Sport center",
        subject: "Admin Sport center",
        participantCount: 8,
        isActive: true,
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const groups = await listCstWaGatewayGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]?.deviceId).toBe("03");
  });

  it("sends group messages with groupId and idempotency key", async () => {
    process.env.CST_WA_GATEWAY_URL = "https://wa.cstlogistic.co.id";
    process.env.CST_WA_GATEWAY_TOKEN = "secret-token";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      status: "queued",
      messageId: "a9222c2b-6dac-4195-a9fb-83aeb475fa18",
    }), { status: 202, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

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
});
