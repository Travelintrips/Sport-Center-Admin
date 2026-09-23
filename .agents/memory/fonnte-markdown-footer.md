---
name: Fonnte Markdown footer
description: The exact provider footer format seen in inbound Fonnte echo payloads.
---

Fonnte echo payloads can include a quoted-message header followed by a Markdown-formatted footer such as `> _Sent via fonnte.com_`, not only plain `> Sent via fonnte.com`.

**Why:** A footer-only detector that does not allow Markdown markers misses the echoed Mina prompt, so the prompt is treated as customer input and advances the booking session.

**How to apply:** Keep echo detection line-bound and allow the provider's optional quote and Markdown markers while rejecting ordinary customer text that merely mentions Fonnte.