import { describe, expect, it } from "@jest/globals";
import { detectIntent } from "./aiSportCenterService";

describe("Mina Gym & Membership intent routing", () => {
  it.each([
    ["Gym & Membership", "membership_inquiry"],
    ["berapa harga member gym?", "membership_inquiry"],
    ["berapa harga sekali masuk gym?", "price_inquiry"],
    ["saya mau perpanjang membership", "membership_inquiry"],
  ] as const)("routes %s to %s", (message, expectedIntent) => {
    expect(detectIntent(message)).toBe(expectedIntent);
  });
});