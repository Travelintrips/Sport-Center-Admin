---
name: Fonnte customer channel separation
description: Durable rules for separating Mina/customer WhatsApp traffic from admin notifications.
---

Customer-facing Fonnte sends must resolve `settings.fonnteCustomerToken` first and `FONNTE_CUSTOMER_TOKEN` second; an empty customer token is a hard stop, never an invitation to use the admin token. Admin notifications continue to use the admin token.

**Why:** The Mina device and admin device are separate WhatsApp identities. Falling back to the admin credential can send customer replies from the wrong number and hides a missing production configuration.

**How to apply:** Keep `FONNTE_CUSTOMER_TOKEN` in the shared GCP runtime configuration alongside `FONNTE_TOKEN`, keep Mina device validation fail-closed when Fonnte supplies a device field, and redact both token values from settings responses and status endpoints.

All registered Fonnte webhook paths, including legacy compatibility paths, must apply the same Mina device validation; the canonical path is `/api/wa/fonnte/webhook`.

**Why:** Duplicate webhook handlers can leave an older configured endpoint without the newer device guard, allowing messages from a non-Mina device to enter the customer flow.

**How to apply:** When adding or retaining a webhook alias, run `validateMinaFonnteWebhookDevice` before deduplication or message processing, and document the canonical endpoint separately from compatibility aliases.

Development may preserve a Replit-scoped `FONNTE_CUSTOMER_TOKEN` when the shared GSM payload is temporarily missing that shared field; this fallback is DEV-only, while controlled provider access still requires the normalized Mina test allowlist.

**Why:** A DEV bootstrap can otherwise delete the newly configured customer secret before the Mina path reads it, while allowing an unrestricted fallback would weaken the outbound safety boundary.

**How to apply:** Keep the DEV fallback scoped to the development loader, require the customer token and exact normalized allowlisted recipient at the provider guard, and continue blocking dry-run, admin, and non-allowlisted sends.