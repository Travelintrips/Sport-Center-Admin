---
name: Posted journal metadata backfill
description: Safe migration ordering for copying payment settlement metadata into posted Sport Center journals.
---

The metadata backfill for posted Sport Center journals must install the expanded metadata-only guard before the backfill update and enable its GUC only with `SET LOCAL` inside the same transaction. Financial columns must remain outside the allowlist.

**Why:** Posted-journal triggers correctly reject any update that could alter financial history. Installing the guard after the backfill causes a safe migration to fail, while a broad permanent bypass would weaken accounting controls.

**How to apply:** In production and startup migrations, replace the guard function first, set `sport_center.allow_posted_accounting_metadata_correction` locally, backfill only payment snapshot fields, then install/verify the payment metadata triggers before commit.