---
name: Threshold-freeze vs EMA smoothing for visual position
description: Why a hard movement-threshold freeze (good for recompute-gating) is the wrong smoothing strategy for continuously-rendered on-screen positions.
---

A hard threshold freeze (ignore updates until movement exceeds N meters/degrees) is a good fit for gating an *expensive recompute* that only needs to reflect real movement eventually (e.g. re-running a sound/exposure estimate). It is a bad fit for anything the user watches move continuously on screen (e.g. AR object placement from raw GPS) — the object either sits still or teleports in one big jump the instant the threshold trips, and sub-threshold sensor noise still visibly jitters if it's allowed to feed the renderer directly with no filtering at all.

**Why:** Consumer GPS noise is typically several meters, far larger than the sub-meter change thresholds a renderer might use to decide "should I recompute this frame's layout". Feeding raw noisy coordinates straight into a per-frame layout function (recomputing on any change above a tiny epsilon) reproduces the raw jitter visually, while switching to a large hard-freeze threshold (borrowed from a different consumer that only cares about eventual correctness) trades jitter for uncomfortable teleport-snapping instead.

**How to apply:** For values that drive continuous visual rendering, use a time-based EMA/low-pass filter (mirroring whatever pattern the codebase already uses for smoothing other continuous sensor inputs, e.g. compass heading) instead of reusing a hard freeze-threshold hook built for a different (recompute-gating) consumer. Keep the two smoothing strategies as separate hooks/values even when they're derived from the same raw sensor stream — one config does not serve both jobs well.
