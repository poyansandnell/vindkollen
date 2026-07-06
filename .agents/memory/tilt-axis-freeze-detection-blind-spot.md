---
name: Tilt-axis freeze detection blind spot
description: A "sensor still alive" corroboration signal based on one motion axis (tilt) misses the exact use case where that axis naturally doesn't move (pure yaw turning).
---

When detecting a frozen/stuck fused sensor value (e.g. a compass heading) by requiring a *different* raw axis to still be changing as proof "the pipeline is alive," check that the corroborating axis actually moves during the primary user gesture.

- A "heading frozen but pitch/roll still moving" fallback check is blind to the single most common real-world gesture for a heading-driven feature: turning the device purely left-right (yaw), which by definition keeps pitch/roll (tilt) essentially constant.
- Add an independent corroborating signal that *does* respond to the missed axis — e.g. a gyroscope `rotationRate` magnitude, tracked via its own "last active" timestamp against a low activity threshold (well below the threshold used to confirm fast turns) — and OR it in alongside the original axis-based check.
- Apply the same additional signal to any "fully stuck / reconnect listeners" watchdog check, not just the primary fallback, or the watchdog will still fail to recover in the missed-axis case.

**Why:** built for an AR wind-turbine app; the existing pitch/roll-based frozen-heading fallback never triggered during a pure horizontal phone turn (the app's core "aim at target" gesture), because pitch/roll naturally doesn't change during that motion — so a stuck OS-level compass fusion value was undetectable in the most common use case.

**How to apply:** whenever a "sensor liveness" check leans on one specific motion axis as proof, ask which real user gestures leave that axis static, and add an axis-independent corroborating signal (e.g. gyroscope magnitude) for those gestures specifically.
