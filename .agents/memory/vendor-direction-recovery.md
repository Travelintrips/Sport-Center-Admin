---
name: Vendor direction recovery
description: Safety rule for correcting legacy bank mutations imported with the wrong direction.
---

Legacy vendor transactions imported as IN must only be corrected when the original debit/keluar evidence is still available in stored columns or the raw import payload. Vendor wording alone is not enough.

**Why:** A direction flip changes reconciliation candidates and financial reporting. Final approvals, posted journals, approved matches, duplicate OUT rows, and closed periods must remain untouched.

**How to apply:** Provide a preview/report first, require an explicit privileged apply operation, reset stale candidates to unmatched, and record before/after values in the audit log.