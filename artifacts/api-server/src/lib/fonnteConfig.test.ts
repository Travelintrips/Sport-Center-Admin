import {
  normalizeFonnteDevice,
  normalizeFonnteDeviceList,
  resolveMinaFonnteDeviceValue,
  resolveFonnteToken,
  selectFonnteToken,
  validateMinaFonnteWebhookDevice,
} from "./fonnteConfig";

describe("Fonnte Mina device and token separation", () => {
  const deviceA = "6281111111111";
  const deviceB = "6282222222222";

  it("normalizes common WhatsApp device formats", () => {
    expect(normalizeFonnteDevice("0811 1111 1111")).toBe(deviceA);
    expect(normalizeFonnteDevice("+62 811 1111 1111")).toBe(deviceA);
    expect(normalizeFonnteDevice("6281111111111@c.us")).toBe(deviceA);
    expect(normalizeFonnteDevice("not-a-phone")).toBe("");
  });

  it("uses Settings DB first and falls back to the environment only when Settings is blank", () => {
    expect(resolveMinaFonnteDeviceValue("0811 1111 1111", "0822 2222 222")).toEqual({
      deviceNumber: deviceA,
      source: "settings",
    });
    expect(resolveMinaFonnteDeviceValue("", "0822 2222 2222")).toEqual({
      deviceNumber: deviceB,
      source: "environment",
    });
  });

  it("fails closed when Settings contains a non-empty invalid device", () => {
    expect(resolveMinaFonnteDeviceValue("not-a-device", deviceB)).toEqual({
      deviceNumber: "",
      source: "missing",
    });
  });

  it("accepts payloads without device for backward-compatible Fonnte payloads", () => {
    return expect(validateMinaFonnteWebhookDevice({ sender: "628123456789" }, deviceA)).resolves.toEqual({
      accepted: true,
      providedDevice: null,
      configuredDevice: deviceA,
      source: "settings",
    });
  });

  it("changes acceptance from device A to device B without restarting", async () => {
    await expect(validateMinaFonnteWebhookDevice({ device: deviceA }, deviceA)).resolves.toMatchObject({
      accepted: true,
      configuredDevice: deviceA,
    });
    await expect(validateMinaFonnteWebhookDevice({ device: deviceA }, deviceB)).resolves.toMatchObject({
      accepted: false,
      configuredDevice: deviceB,
    });
    await expect(validateMinaFonnteWebhookDevice({ device: deviceB }, deviceB)).resolves.toMatchObject({
      accepted: true,
      configuredDevice: deviceB,
    });
  });

  it("accepts only explicitly allowlisted secondary inbound devices", async () => {
    const previous = process.env.FONNTE_CUSTOMER_INBOUND_DEVICES;
    process.env.FONNTE_CUSTOMER_INBOUND_DEVICES = "0812 1610 4734, 0823-2130-1338";

    expect(normalizeFonnteDeviceList(process.env.FONNTE_CUSTOMER_INBOUND_DEVICES)).toEqual([
      "6281216104734",
      "6282321301338",
    ]);

    await expect(
      validateMinaFonnteWebhookDevice({ device: "081216104734" }, deviceA),
    ).resolves.toMatchObject({
      accepted: true,
      providedDevice: "6281216104734",
      configuredDevice: deviceA,
    });

    await expect(
      validateMinaFonnteWebhookDevice({ device: "081399999999" }, deviceA),
    ).resolves.toMatchObject({
      accepted: false,
      providedDevice: "628139999999",
      configuredDevice: deviceA,
    });

    if (previous === undefined) delete process.env.FONNTE_CUSTOMER_INBOUND_DEVICES;
    else process.env.FONNTE_CUSTOMER_INBOUND_DEVICES = previous;
  });

  it("fails closed when the configured device is empty or invalid", async () => {
    await expect(validateMinaFonnteWebhookDevice({ device: deviceA }, "")).resolves.toMatchObject({
      accepted: false,
      configuredDevice: null,
      source: "settings",
    });
    await expect(validateMinaFonnteWebhookDevice({ device: deviceA }, "invalid")).resolves.toMatchObject({
      accepted: false,
      configuredDevice: null,
    });
  });

  it("never falls back from a missing customer token to the admin token", () => {
    const config = {
      adminToken: "admin-token",
      adminTokenSource: "settings" as const,
      customerToken: "",
      customerTokenSource: "missing" as const,
      customerDevice: deviceA,
      customerDeviceSource: "settings" as const,
    };
    expect(selectFonnteToken(config, true)).toBe("");
    expect(selectFonnteToken(config, false)).toBe("admin-token");
  });

  it("prioritizes the Admin Settings token over FONNTE_CUSTOMER_TOKEN", () => {
    expect(resolveFonnteToken("  settings-customer-token  ", "environment-token")).toBe("settings-customer-token");
    expect(resolveFonnteToken("", "environment-token")).toBe("environment-token");
    expect(resolveFonnteToken("   ", " ")).toBe("");
  });
});