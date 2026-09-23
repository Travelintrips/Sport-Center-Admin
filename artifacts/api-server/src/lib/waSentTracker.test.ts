import { describe, expect, it } from "@jest/globals";
import { isMinaGreetingEcho } from "./waSentTracker";

describe("Mina WhatsApp echo guard", () => {
  it("ignores the greeting when Fonnte appends its footer", () => {
    expect(
      isMinaGreetingEcho(
        "Halo! Aku Mina asisten Sport Center Ada yang bisa Mina bantu hari ini?\n\n> Sent via fonnte.com",
      ),
    ).toBe(true);
  });

  it("does not classify a customer's ordinary greeting as Mina output", () => {
    expect(isMinaGreetingEcho("halo ka")).toBe(false);
  });
});