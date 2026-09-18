import { describe, expect, it } from "@jest/globals";
import { allowWhatsAppProviderSend, getWhatsAppDispatchMode } from "./whatsappSafety";

describe("WhatsApp development safety", () => {
  it("defaults to fail-closed when development omits WA_DRY_RUN", () => {
    expect(getWhatsAppDispatchMode("development", undefined)).toBe("blocked");
  });

  it("fails closed when development explicitly disables dry-run", () => {
    expect(getWhatsAppDispatchMode("development", "false")).toBe("blocked");
  });

  it("simulates dispatch when development enables dry-run", () => {
    expect(getWhatsAppDispatchMode("development", "true")).toBe("dry-run");
    expect(getWhatsAppDispatchMode("test", "true")).toBe("dry-run");
  });

  it("preserves the existing provider-send mode in production", () => {
    expect(getWhatsAppDispatchMode("production", undefined)).toBe("production");
    expect(getWhatsAppDispatchMode("prod", "false")).toBe("production");
    expect(getWhatsAppDispatchMode("production", "false")).toBe("production");
  });

  it("allows the configured Mina test recipient with a customer token", () => {
    expect(
      allowWhatsAppProviderSend({
        nodeEnv: "development",
        dryRun: undefined,
        channel: "mina",
        recipient: "0812 3456 7890",
        allowlistedRecipient: "+62 812 3456 7890",
        customerTokenConfigured: true,
      }),
    ).toBe(true);
  });

  it("blocks a non-allowed recipient", () => {
    expect(
      allowWhatsAppProviderSend({
        channel: "mina",
        recipient: "6281234567891",
        allowlistedRecipient: "6281234567890",
        customerTokenConfigured: true,
      }),
    ).toBe(false);
  });

  it("blocks when the Mina test allowlist is missing", () => {
    expect(
      allowWhatsAppProviderSend({
        channel: "mina",
        recipient: "6281234567890",
        allowlistedRecipient: undefined,
        customerTokenConfigured: true,
      }),
    ).toBe(false);
  });

  it("blocks Mina controlled sends without the customer token", () => {
    expect(
      allowWhatsAppProviderSend({
        channel: "mina",
        recipient: "6281234567890",
        allowlistedRecipient: "6281234567890",
        customerTokenConfigured: false,
      }),
    ).toBe(false);
  });

  it("does not grant the Mina exception to admin sends", () => {
    expect(
      allowWhatsAppProviderSend({
        channel: "admin",
        recipient: "6281234567890",
        allowlistedRecipient: "6281234567890",
        customerTokenConfigured: true,
      }),
    ).toBe(false);
  });
});