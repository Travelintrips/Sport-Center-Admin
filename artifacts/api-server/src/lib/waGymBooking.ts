export const GYM_WALK_IN_START_TIME = "06:00";
export const GYM_WALK_IN_END_TIME = "14:00";

/**
 * Gym is a walk-in/day-access product. durationMinutes=60 is a persistence/
 * pricing sentinel only; it is intentionally not shown to the customer.
 */
export const GYM_WALK_IN_DURATION_MINUTES = 60;
export const GYM_WALK_IN_DURATION_HOURS = 1;

export type GymWalkInFacilityLike = {
  name?: string | null;
  category?: string | null;
  bookingMode?: string | null;
};

export function isGymWalkInFacility(
  facility: GymWalkInFacilityLike | null | undefined,
): boolean {
  if (!facility || facility.bookingMode !== "walk_in") return false;
  const text = `${facility.name ?? ""} ${facility.category ?? ""}`.toLowerCase();
  return /\bgym\b|fitness/.test(text);
}
