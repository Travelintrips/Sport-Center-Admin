---
name: Company invoice list behavior
description: Company billing UI must distinguish an empty invoice result from an API/authentication error and surface companies without invoices for controlled generation.
---

The company billing page should keep existing `company_invoices` rows visible, show an explicit error state when the admin list query fails, and separately list company accounts that have no invoice so an admin can start the normal generation flow. Invoice generation still requires at least one eligible `unbilled` booking; do not create empty Rp0 invoices.

**Why:** A development database contained a valid paid invoice while the page appeared empty, and the previous empty-state rendering hid query/authentication failures.

**How to apply:** When debugging or extending company billing, inspect the active environment/database and preserve the distinction between missing records, filtered records, and failed authenticated requests.

Invoice preview and generation should select only the booking fields needed for billing rather than using `SELECT *`, and the UI should expose the server error with a retry path.

**Why:** Production can have legacy booking columns missing from the current application schema; broad selects can hide valid eligible bookings behind a generic loading/empty state.

**How to apply:** Keep the eligibility filter (`company_customer_id`, `billing_status = unbilled`, and the selected month) unchanged while narrowing the selected columns and surfacing failed preview requests.