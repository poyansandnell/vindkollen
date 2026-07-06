---
name: Grace period timer anchor point
description: A "show X for N seconds before degrading" grace-period clock must start when the user can actually see the result, not when the underlying measurement becomes available.
---

When implementing a "give the user N seconds before applying a penalty/dimming/hiding state" grace period, anchor the start of that clock to the moment the user-visible session/view actually becomes visible — not to the moment the background signal driving the penalty first becomes available.

- A background measurement (e.g. a camera-based heuristic) can start running, and reach its "bad" state, well before the gated UI it affects is actually shown to the user (e.g. while still waiting on GPS/compass fix).
- If the grace-period timer starts counting from the background signal instead of from user-visible-session-start, the whole grace window can silently elapse before the user ever sees anything — making the grace period feel like it never existed.
- Fix by adding the "session is actually visible" flag as an explicit gating condition (and effect dependency) alongside the raw background signal, so the timer only starts once both are true.
- This is a distinct bug pattern from freeze-vs-fade tiering (see `ar-tracking-freeze-vs-fade-tiering.md`) — that pattern is about *timer duration/urgency* differences; this one is about *timer anchor point* being wrong entirely.

**Why:** built for an AR app where a 5s "look for free before we dim for being indoors" grace period was timed from a camera heuristic that runs as soon as the camera starts, while the AR view itself waited on a separately-timed GPS/compass fix that could take 10-15s — so the grace period was already fully consumed by the time the user could see anything.

**How to apply:** whenever building a grace/leniency timer tied to a background signal, ask "could this signal reach its trigger state before the gated view is even shown?" — if yes, gate the timer's start on view-visibility too.
