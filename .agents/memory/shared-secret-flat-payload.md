---
name: Shared GCP secret payload
description: DEV and PROD can share one GCP secret; flat legacy fields are normalized by explicit environment classification.
---

The shared GCP secret may remain flat with `_DEV` pairs. DEV maps only `_DEV` fields after removing the suffix; PROD maps only explicitly classified production fields; global fields are shared only when explicitly listed. Neither environment falls back to the other.

**Why:** The existing `sport-center` secret uses flat Supabase field pairs, and renaming the stored payload would be broader and riskier than normalizing it at load time.

**How to apply:** Preserve fail-closed section/environment validation and never log payload values. Keep the shared secret ID as runtime configuration, not as an environment marker in its name. Paylabs sandbox credentials are DEV-only; production credentials are PROD-only. If Paylabs credentials are supplied as direct Replit Secrets, the loader must preserve those exact environment variables when the shared payload contains only database configuration.