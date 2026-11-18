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
    "Sore ini ada yg maen basket ga min?",
    "Min basket nanti malam ada yang main?",
    "Besok ada orang main futsal?",
    "Basket jam 7 ada yg main kak?",
    "Ada yang sparring basket hari ini?",
    "Malam ini ada yg latihan badminton?",
    "Lapangan basket sore ini dipakai ga?",
    "Siapa aja yang main basket sore ini?",
    "Ada yang main bola basket?",
    "Minggu sore rame ga yang main basket?",
    "Basket nanti sore rame gak?",
    "Ada yg main voli ga?",
    "Sore ini ada yang main tenis?",
    "Ntar sore basket ada yg main?",
    "Nanti sore ada yang main badminton?",
    "Ada yang main bulu tangkis hari ini?",
    "Hari ini ada yg main billiard?",
    "Basket hari ini terpakai tidak min?",
  ])("recognizes natural sports-playing and court-use questions: %s", (message) => {
    expect(detectIntent(message)).toBe("availability_check");
  });

  it.each([
    "Saya mau main basket besok",
    "Mau booking lapangan basket",
    "Booking basket sekarang",
    "Mau sewa lapangan basket sore ini",
    "Pengen main badminton nanti sore",
  ])("preserves explicit booking requests: %s", (message) => {
    expect(detectIntent(message)).toBe("booking_intent");
  });

  it.each([
    ["Harga basket berapa?", "price_inquiry"],
    ["Ada promo basket?", "promo_inquiry"],
    ["Jam buka lapangan basket?", "operating_hours"],
    ["Basket itu fasilitas apa?", "general_question"],
  ] as const)("does not turn unrelated sports questions into schedule checks: %s", (message, expected) => {
    expect(detectIntent(message)).toBe(expected);
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