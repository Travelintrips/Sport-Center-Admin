import { describe, expect, it } from "@jest/globals";
import { isFonnteProviderEcho, isMinaGreetingEcho } from "./waSentTracker";

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

  it("ignores any Fonnte echoed message with the provider footer", () => {
    expect(
      isFonnteProviderEcho(
        "You • +62 819-9293-5158\nlanjut di sini\n\n" +
        "👤 Pesan/Booking atas nama siapa?\n\nContoh: Andi\n\n" +
        "> Sent via fonnte.com",
      ),
    ).toBe(true);
  });

  it("does not ignore a customer message that only mentions Fonnte", () => {
    expect(isFonnteProviderEcho("Saya kirim bukti via Fonnte")).toBe(false);
  });
});
