---
name: WhatsApp slot selection inputs
description: Rules for Mina's displayed time-slot prompts and ambiguous numeric replies
---

When Mina displays available booking starts, the reply must end with an explicit question and accepted examples. The booking-time step should accept the exact displayed time, a bare hour such as `11`, and natural-language forms such as `jam 11` or `jam 11 pagi`. In an alternative-facility menu, only numbers within the actual menu range are menu choices; a larger bare number remains a time selection.

**Why:** Customers commonly answer a displayed `11:00` slot with `11`, and repeating the list without a direct question makes the flow appear stuck. Numeric alternative-menu choices and numeric hours share the same input channel.

**How to apply:** Preserve this distinction whenever changing `ask_time`, `choose_alternative_facility`, or the slot-list reply builders. Keep provider failures separately observable from session-routing failures.