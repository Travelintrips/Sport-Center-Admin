---
name: WhatsApp slot selection inputs
description: Rules for Mina's displayed time-slot prompts and ambiguous numeric replies
---

When Mina displays available booking starts, the reply must end with an explicit question and accepted examples. The booking-time step should accept the exact displayed time, a bare hour such as `11`, and natural-language forms such as `jam 11` or `jam 11 pagi`. If the customer rejects all slots on the selected badminton court, Mina should check sibling courts for the same date and duration, show their slots, and ask for an explicit acceptance before switching facilities. In an alternative-facility menu, only numbers within the actual menu range are menu choices; a larger bare number remains a time selection.

**Why:** Customers commonly answer a displayed `11:00` slot with `11`, and repeating the list without a direct question makes the flow appear stuck. Rejecting Court A is a facility decision, not merely a request to see the same Court A slots again. Numeric alternative-menu choices and numeric hours share the same input channel.

**How to apply:** Preserve this distinction whenever changing `ask_time`, `choose_alternative_facility`, or the slot-list reply builders. Keep provider failures separately observable from session-routing failures, and require an explicit `ya/cocok/setuju` or a Court B time before moving the session to a sibling court.

Duration replies such as `1 jam`, `2 jam`, and `3 jam` must be routed through `ask_duration` before any numeric alternative-menu handling. Numeric menu parsing is opt-in and only applies when the alternative menu is the active displayed choice.