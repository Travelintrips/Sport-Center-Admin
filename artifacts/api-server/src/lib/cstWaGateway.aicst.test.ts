import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { getCstWaGatewayPublicConfig, listCstWaGatewayDevices, sendCstWaGatewayGroupMessage } from "./cstWaGateway";

const previousUrl = process.env.CST_WA_GATEWAY_URL;
const previousToken = process.env.CST_WA_GATEWAY_TOKEN;
afterEach(() => {
  jest.restoreAllMocks();
  if (previousUrl === undefined) delete process.env.CST_WA_GATEWAY_URL;
  else process.env.CST_WA_GATEWAY_URL = previousUrl;
  if (previousToken === undefined) delete process.env.CST_WA_GATEWAY_TOKEN;
  else process.env.CST_WA_GATEWAY_TOKEN = previousToken;
});

describe("CST WA gateway aicst.co.id cutover", () => {
  it("uses the new domain with unchanged Bearer token for read-only device discovery", async () => {
    process.env.CST_WA_GATEWAY_URL = "https://aicst.co.id/";
    process.env.CST_WA_GATEWAY_TOKEN = "test-only-token";
    const spy = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ devices: [] }), { status: 200 }));
    expect(getCstWaGatewayPublicConfig()).toEqual({ configured: true, baseUrl: "https://aicst.co.id" });
    expect(await listCstWaGatewayDevices()).toEqual([]);
    expect(spy.mock.calls[0]?.[0]).toBe("https://aicst.co.id/v1/devices");
    expect(spy.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer test-only-token" });
  });
  it("preserves idempotency and group-routing payload without a real send", async () => {
    process.env.CST_WA_GATEWAY_URL = "https://aicst.co.id";
    process.env.CST_WA_GATEWAY_TOKEN = "test-only-token";
    const spy = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "queued", messageId: "test-message-id" }), { status: 202 }));
    await sendCstWaGatewayGroupMessage({ groupId: "test-group", text: "synthetic", idempotencyKey: "migration-regression-test" });
    expect(spy.mock.calls[0]?.[0]).toBe("https://aicst.co.id/v1/messages");
    expect(spy.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer test-only-token", "Idempotency-Key": "migration-regression-test" });
    expect(JSON.parse(String(spy.mock.calls[0]?.[1]?.body))).toEqual({ groupId: "test-group", type: "text", text: "synthetic" });
  });
  it("keeps legacy domain functional during transition", () => {
    process.env.CST_WA_GATEWAY_URL = "https://wa.cstlogistic.co.id";
    process.env.CST_WA_GATEWAY_TOKEN = "test-only-token";
    expect(getCstWaGatewayPublicConfig()).toEqual({ configured: true, baseUrl: "https://wa.cstlogistic.co.id" });
  });
});
