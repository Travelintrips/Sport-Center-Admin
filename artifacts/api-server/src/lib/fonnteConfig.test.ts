import {
  MINA_FONNTE_DEVICE,
  normalizeFonnteDevice,
  resolveFonnteToken,
  selectFonnteToken,
  validateMinaFonnteWebhookDevice,
} from "./fonnteConfig";

describe("Fonnte Mina device and token separation", () => {
  it("normalizes common WhatsApp device formats", () => {
    expect(normalizeFonnteDevice("0819 929 3537")).toBe(MINA_FONNTE_DEVICE);
    expect(normalizeFonnteDevice("+62 819 929 3537")).toBe(MINA_FONNTE_DEVICE);
    expect(normalizeFonnteDevice("628199293537@c.us")).toBe(MINA_FONNTE_DEVICE);
  });

  it("accepts payloads without device for backward-compatible Fonnte payloads", () => {
    expect(validateMinaFonnteWebhookDevice({ sender: "628123456789" })).toEqual({
      accepted: true,
      providedDevice: null,
    });
  });

  it("accepts only the configured Mina device when device is supplied", () => {
    expect(validateMinaFonnteWebhookDevice({ device: MINA_FONNTE_DEVICE })).toEqual({
      accepted: true,
      providedDevice: MINA_FONNTE_DEVICE,
    });
    expect(validateMinaFonnteWebhookDevice({ device: "6285112345678" })).toEqual({
      accepted: false,
      providedDevice: "6285112345678",
    });
  });

  it("never falls back from a missing customer token to the admin token", () => {
    const config = { adminToken: "admin-token", customerToken: "" };
    expect(selectFonnteToken(config, true)).toBe("");
    expect(selectFonnteToken(config, false)).toBe("admin-token");
  });

  it("prioritizes the Admin Settings token over FONNTE_CUSTOMER_TOKEN", () => {
    expect(resolveFonnteToken("  settings-customer-token  ", "environment-token")).toBe("settings-customer-token");
    expect(resolveFonnteToken("", "environment-token")).toBe("environment-token");
    expect(resolveFonnteToken("   ", " ")).toBe("");
  });
});