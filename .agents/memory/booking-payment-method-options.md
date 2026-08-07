---
name: Booking payment method options
description: Source of truth and backward-compatible behavior for editing payment methods on admin bookings.
---

Admin booking payment-method selectors should read active method names from the Paylabs settings configuration, while always retaining the saved label as a selectable legacy option when that method is no longer active.

**Why:** Payment method configuration is environment-specific and administrators need to edit historical payments without losing or blanking an old method after configuration changes.

**How to apply:** Keep the booking payment update endpoint independent from the current active-method list; validate a non-empty trimmed label, preserve existing payment status/proof/amount, and invalidate the booking list after saving.