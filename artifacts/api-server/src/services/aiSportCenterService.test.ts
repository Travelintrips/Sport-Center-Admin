import { describe, expect, it } from "@jest/globals";
import {
  buildCanonicalBookingUrl,
  canonicalizeBookingReply,
  detectIntent,
} from "./aiSportCenterService";

describe("Mina Gym & Membership intent routing", () => {
  it.each([
    ["Gym & Membership", "membership_inquiry"],
    ["berapa harga member gym?", "membership_inquiry"],
    ["berapa harga sekali masuk gym?", "price_inquiry"],
    ["saya mau perpanjang membership", "membership_inquiry"],
    ["Ini tgl berapa batas akhir pembayarannya?", "status_check"],
    ["deadline bayar booking saya kapan?", "status_check"],
    ["langsung booking", "booking_intent"],
    ["booking sekarang", "booking_intent"],
  ] as const)("routes %s to %s", (message, expectedIntent) => {
    expect(detectIntent(message)).toBe(expectedIntent);
  });

  it.each([
    "Nanti sore ada yang main basket min?",
    "Ada yang main basket nanti sore?",
    "Besok ada yang main futsal?",
    "Hari ini ada yang main badminton?",
    "Sore ini ada orang main voli?",
    "Ada tim latihan basket malam ini?",
  ])("recognizes casual playing inquiries as schedule questions: %s", (message) => {
    expect(detectIntent(message)).toBe("availability_check");
  });

  it.each([
    "Saya mau main basket besok",
    "Mau booking lapangan basket",
    "Booking basket sekarang",
  ])("keeps explicit booking intent unchanged: %s", (message) => {
    expect(detectIntent(message)).toBe("booking_intent");
  });

  it("builds a deterministic web booking URL with the canonical parameters", () => {
    expect(
      buildCanonicalBookingUrl("https://sport-center.replit.dev/", {
        facilityId: 7,
        date: "2026-09-20",
        startTime: "16:00",
        duration: 2,
        source: "web",
      }),
    ).toBe(
      "https://sport-center.replit.dev/booking?facilityId=7&date=2026-09-20&startTime=16%3A00&duration=2&source=web",
    );
  });

  it("keeps backend booking URLs authoritative over an AI-rewritten URL", () => {
    const canonicalUrl =
      "https://sport-center.replit.dev/booking?facilityId=7&date=2026-09-20&startTime=16%3A00&duration=2&source=web";
    const reply = canonicalizeBookingReply(
      "✅ Slot tersedia!\n🔗 https://example.com/booking?facilityId=999",
      [canonicalUrl],
    );

    expect(reply).toContain(canonicalUrl);
    expect(reply).not.toContain("example.com");
    expect(reply).not.toContain("facilityId=999");
  });
});