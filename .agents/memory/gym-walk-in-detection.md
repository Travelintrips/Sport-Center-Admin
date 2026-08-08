---
name: Gym Walk-in Detection
description: Compatibility rule for Gym facilities whose persisted booking mode may still be time_slot.
---

Gym/Fitness facilities must be treated as walk-in/per-visit when either `bookingMode` is `walk_in` or the facility name/category contains Gym or Fitness.

**Why:** Existing production records can retain `booking_mode = time_slot` after the business rule changed, which otherwise makes customers see hourly slots and sends the wrong booking contract.

**How to apply:** Use this fallback consistently in facility detail UI, booking confirmation UI, availability, and booking creation. Do not apply it to other sports facilities.