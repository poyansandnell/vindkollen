---
name: GPS jitter freezing + smoothed metric consistency
description: How to keep a GPS-derived metric (e.g. dBA estimate) stable and keep two dependent consumers (a display panel and an audio/visual effect) from disagreeing.
---

When a displayed metric is derived from live GPS coordinates, raw `lat`/`lon` updates cause two separate problems that need two separate fixes:

1. **Input jitter** — ordinary GPS noise (device reports movement of a few meters even when the user is stationary) causes the metric to recompute on every fix, even though nothing really changed. Fix by freezing the position used for the calculation until real movement exceeds a distance threshold (e.g. 15m), not by smoothing the *output* — smoothing the output alone still recomputes needlessly and can mask real, fast movement.
2. **Output volatility / cross-consumer disagreement** — even with clean input, a computed value can update once per render/GPS-tick, which is too jumpy for a UI number or an audio gain to track directly. Fix with a rolling time-window average plus a throttle on how often the *visible*/*applied* value is allowed to change.

**Why:** If a display panel and an effect (e.g. wind sound volume) each independently read the raw value, they can visibly disagree during a transition. Route both through the *same* smoothed derived value so they always show/behave consistently.

**How to apply:** Build a "stabilize position" hook (freeze until movement ≥ threshold) that feeds a "smooth metric" hook (rolling window average, throttled emission) whose single output is consumed by every downstream reader — display and effect alike.
