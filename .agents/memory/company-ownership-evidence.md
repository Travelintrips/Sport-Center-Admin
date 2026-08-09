---
name: Company ownership evidence
description: Deterministic ownership rules for assigning a company to Sport Center payments.
---

Company ownership must come from an explicit validated relation such as the source payment, company booking relation, company invoice relation, or an approved facility/merchant mapping. Facility identity alone is not company ownership.

**Why:** Historical payments can be personal bookings with no company fields, and the current facility data does not establish a company owner. Guessing a shared company ID would corrupt public accounting attribution.

**How to apply:** Resolve all available evidence, return NULL with a non-deterministic status when evidence is absent or conflicting, and do not run historical repair or public accounting posting until an approved ownership source exists.