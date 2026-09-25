import { describe, expect, it } from "@jest/globals";
import {
  GYM_WALK_IN_DURATION_HOURS,
  GYM_WALK_IN_DURATION_MINUTES,
  GYM_WALK_IN_END_TIME,
  GYM_WALK_IN_START_TIME,
  isGymWalkInFacility,
} from "./waGymBooking";

describe("Gym walk-in booking defaults", () => {
  it("matches only the Gym/Fitness walk-in facility", () => {
    expect(isGymWalkInFacility({
      name: "Gym / Fitness Center",
      category: "Fitness",
      bookingMode: "walk_in",
    })).toBe(true);

    expect(isGymWalkInFacility({
      name: "Badminton Court A",
      category: "Badminton",
      bookingMode: "scheduled",
    })).toBe(false);

    expect(isGymWalkInFacility({
      name: "Generic Walk In",
      category: "Other",
      bookingMode: "walk_in",
    })).toBe(false);
  });

  it("keeps the hidden persistence window and one-unit pricing sentinel stable", () => {
    expect(GYM_WALK_IN_START_TIME).toBe("06:00");
    expect(GYM_WALK_IN_END_TIME).toBe("14:00");
    expect(GYM_WALK_IN_DURATION_MINUTES).toBe(60);
    expect(GYM_WALK_IN_DURATION_HOURS).toBe(1);
  });
});
