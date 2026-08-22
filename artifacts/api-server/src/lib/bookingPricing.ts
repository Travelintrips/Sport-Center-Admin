/**
 * Event bookings receive a fixed 21.4% discount of the pre-tax session price.
 * Keep the calculation integer-safe so regular and recurring booking flows
 * cannot drift apart through different rounding behavior.
 */
export function calculateEventDiscount(basePrice: number): number {
  const EVENT_DISCOUNT_NUMERATOR = 214;
  const EVENT_DISCOUNT_DENOMINATOR = 1000;
  return Math.floor(
    (basePrice * EVENT_DISCOUNT_NUMERATOR + EVENT_DISCOUNT_DENOMINATOR / 2) /
      EVENT_DISCOUNT_DENOMINATOR,
  );
}