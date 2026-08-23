import { describe, expect, it } from "@jest/globals";
import { getWhatsAppDispatchMode } from "./whatsappSafety";

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
    expect(getWhatsAppDispatchMode("production", "false")).toBe("production");
  });
});