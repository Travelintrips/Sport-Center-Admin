---
name: Company ownership evidence
description: Deterministic ownership rules for assigning a company to Sport Center payments.
---

Company ownership must come from an explicit validated relation such as the source payment, company booking relation, company invoice relation, or an approved facility/merchant mapping. Facility identity alone is not company ownership. A manually approved ID is still invalid for a company mapping when the referenced master record is not an active `account_type = company` record. When a dedicated public company master and the Sport Center user/company model both exist, their IDs must not be assumed interchangeable.

**Why:** Historical payments can be personal bookings with no company fields, and the current facility data does not establish a company owner. Guessing a shared company ID would corrupt public accounting attribution. A business approval naming a personal/admin user ID cannot satisfy the application's company master invariant. The active database has CST as `public.companies.id=1`, while `sport_center.users.id=1` is the Admin personal login; converting the latter would blur two distinct models.

**How to apply:** Resolve all available evidence, return NULL with a non-deterministic status when evidence is absent or conflicting, and do not run historical repair or public accounting posting until an approved ownership source exists.