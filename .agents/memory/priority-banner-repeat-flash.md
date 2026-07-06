---
name: Priority-ordered status banner re-flashes low-priority messages
description: A "show the highest-priority active condition" banner with no shown-memory can repeatedly re-display a low-priority message during one long event
---

A single status banner that recomputes "which message wins" from scratch on every render (priority list: critical errors > confirmations > warnings > low-priority info) will re-show a low-priority message every time it happens to become the current winner — even if it already displayed that exact message moments earlier. During one long-running background condition (e.g. ambient audio playing for minutes), other higher-priority messages flicker in and out (e.g. intermittent sensor warnings), and each time they clear, the low-priority message "wins" again and reappears, feeling like a repeated nag even though nothing new happened.

**Why:** the priority-selection logic is stateless by design (pure function of current conditions), which is correct for urgent/changing conditions but wrong for "mention this once" informational messages tied to a single long-lived event.

**How to apply:**
- For a message that only needs to be communicated once per event (not once per render-cycle-where-it-wins), add a small per-event "already shown" ref/flag, set the first time it's actually displayed, and only reset it when the underlying event ends (not when a higher-priority message temporarily takes over).
- Keep this separate from the priority ordering itself — the ordering still governs *which* message wins when several are eligible; the shown-flag governs whether a specific low-priority message is even eligible anymore this event.
