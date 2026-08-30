---
name: Group payment confirmation UI
description: Admin confirmation behavior for recurring/group booking sessions
---

Recurring sessions share one payment decision per group, even though each session remains a separate booking row and may retain a mirrored payment record for history.

**Why:** Showing every mirrored session in the confirmation queue makes one customer payment look like multiple payments and invites duplicate admin actions.

**How to apply:** Deduplicate the admin payment-confirmation queue by `groupRef`; keep the full session list available in general booking views and preserve server-side group status propagation.