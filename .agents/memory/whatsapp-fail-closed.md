---
name: WhatsApp fail-closed policy
description: Safety rule for every WhatsApp provider dispatch path outside production
---

Non-production and test processes must not call the WhatsApp provider. Missing `WA_DRY_RUN` and `WA_DRY_RUN=false` both fail closed; `WA_DRY_RUN=true` is simulated/logged only. Production retains its existing provider-send behavior.

**Why:** A scheduler warning-only guard allowed a development process to queue real messages when the dry-run variable was absent.

**How to apply:** Put the server-side policy at every provider boundary, including scheduled notifications, manual admin sends, invoice delivery, webhooks, OTP, and company messaging; never rely on UI state or environment defaults alone.