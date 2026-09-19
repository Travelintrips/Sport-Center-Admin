---
name: WA time validation routing
description: Invariant for natural-language time input during Mina booking sessions
---

When a Mina session is at `ask_time` and the customer message contains a parsed start time, route it through the step handler before the generic natural-language merge path. The step handler is responsible for validating operating hours, duration boundaries, bookings, blocked schedules, and same-slot facility alternatives.

**Why:** The generic merge path can mark the session complete and render a summary without running the requested facility's availability checks, which can make an out-of-hours or full-slot message appear to receive no response.

**How to apply:** Preserve this routing invariant whenever adding correction/merge behavior to the WhatsApp booking webhook. Keep availability lists scoped to the selected facility and date.