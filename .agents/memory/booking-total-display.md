---
name: Booking total display
description: Customer-facing booking totals when withholding tax applies
---

Customer-facing booking and payment-status views should show the net amount after PPh as the primary total, while retaining the gross/grand total as a separate reference.

**Why:** The gross amount is the source value for DPP, audit, invoice reconciliation, and accounting; overwriting it would make financial history ambiguous.

**How to apply:** Use the stored `pph_amount` and `net_amount` when PPh applies. Keep payment calculations and accounting based on their explicit gross/net fields rather than replacing `total_price` or `grand_total`.