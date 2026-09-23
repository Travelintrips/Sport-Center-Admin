---
name: WhatsApp name-before-date invariant
description: Mina booking sessions must collect the booking name before date and reject retried menu commands as names
---

Mina's sequential booking flow asks for the customer name before date. A retried "lanjut di sini" webhook can arrive after the session advances to `ask_name`; flow commands must be rejected there instead of stored as a name.

**Why:** Fonnte retries or concurrent webhook delivery can process the same menu response after the first handler has advanced the persisted session, causing an immediate date prompt before the customer has entered a name.

**How to apply:** Keep `getNextStep()` ordered as facility → customer name → date → duration → time, and preserve guards in the `ask_name` handler for menu, greeting, and booking commands.