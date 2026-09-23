---
name: WhatsApp webhook deduplication
description: Reliability rule for preventing duplicate Mina replies when Fonnte retries inbound messages.
---

Inbound Mina webhooks must use a shared database-backed deduplication claim in addition to process-local caches. Fingerprint by normalized sender plus message content, and also claim the provider message ID when available.

**Why:** Fonnte can retry deliveries without a stable ID, and separate API instances do not share in-memory Maps, so local-only deduplication can send the same reply twice.

**How to apply:** Serialize claims with a PostgreSQL advisory transaction lock, keep the claim window short enough to allow intentional repeated messages later, and ignore duplicate deliveries before AI/session processing.

Fonnte can also echo outbound Mina replies with a standalone `Sent via fonnte.com` footer and quoted-message header. Detect that footer before deduplication/session handling; leading-text bot patterns are not sufficient.