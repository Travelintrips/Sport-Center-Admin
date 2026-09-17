---
name: Canonical facility foreign keys
description: The facility table migration boundary between legacy facilities and the current sport_facilities table
---

Booking and facility-image foreign keys must reference `sport_center.sport_facilities(id)`, the table used by the application schema. The legacy `sport_center.facilities` table may still exist for older data, but it is not the canonical facility source.

**Why:** Production had both tables, and older constraints pointed at the legacy table. Newly-created facilities existed only in `sport_center.sport_facilities`, so booking inserts and image inserts failed with a generic HTTP 500 even though the API could read the facility.

**How to apply:** When syncing production schema, verify the target relation for `sport_bookings.facility_id` and `facility_images.facility_id`, check for orphan rows, then repair the constraints transactionally before testing the booking and upload paths.