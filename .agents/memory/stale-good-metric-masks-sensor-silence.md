---
name: Stale-but-good metric masks total event-stream silence
description: A stability/quality metric that is only mutated inside an event handler can freeze at its last good value and hide a total sensor/event silence, producing misleading "everything looks fine" diagnostics while the feature is fully frozen.
---

A derived quality/stability metric (e.g. a 0-100% "tracking stability" score) that is only ever updated from inside an event handler (e.g. `deviceorientation`) has no way to represent "no new data has arrived at all" — if the event stream stops firing entirely, the metric just freezes at whatever value it last had, which is often a *good* one. Consumers polling that ref/state on an interval see a plausible, healthy-looking number and have no signal that it's stale.

**Why:** In production this presented as "the AR arrow and all turbines freeze completely, yet FPS stayed 60 and AR-stability stayed 98%" — both numbers were real measurements of a pipeline that had already gone silent; nothing was measuring the silence itself. A separate existing "frozen value" fallback (detecting an unchanging raw sensor value while events keep arriving) is a different failure mode and does not catch total event silence.

**How to apply:** Add an independent watchdog (a `setInterval`, decoupled from the event source) that tracks `Date.now()` of the last received event and explicitly flags/forces the dependent metrics toward a degraded value once silence exceeds a threshold — don't rely solely on values that are only mutated by the event you're trying to detect the absence of. Pair this with a render-loop watchdog (a separate interval checking last-frame timestamp) for any rAF-driven animation loop, since the same "healthy metric measured from inside the thing that might be stalled" trap applies there too.
