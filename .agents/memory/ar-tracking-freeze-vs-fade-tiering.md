---
name: AR tracking freeze-vs-fade tiering
description: How to combine a position freeze with a delayed visual fade when fusing multiple sensor-quality signals into a single stability tier for AR.
---

When a "prioritize stability over precision" AR requirement demands (a) freezing placement immediately on bad sensor data but (b) never abruptly hiding the rendered object, do NOT use the same threshold/timer for both behaviors — they need different urgency.

- Freeze the smoothed position (e.g. via a `freeze: boolean` param that pauses an existing EMA hook rather than adding a second filter) as soon as the fused tier degrades. This is cheap to reverse and prevents drift instantly.
- Only start fading opacity/visibility toward a floor (never fully to 0) after a **sustained** period of the worst tier (a grace duration, e.g. several seconds), and ramp the fade itself over a few more seconds. A momentary bad reading should never cause a visible flicker/disappearance.
- Fuse independent quality signals (e.g. GPS accuracy + compass/heading stability) by taking the *worse* of normalized per-signal tiers, not an average — an average can mask one badly-degraded input.
- Keep this positional/heading tracking-stability hook separate from an unrelated "should we render at all" visibility hook (e.g. one driven by camera/light/environment heuristics) — conflating the two makes both harder to tune independently.
- Unfreezing should let the existing continuous smoothing filter re-converge naturally (no separate "correction" animation needed) — freeze/unfreeze on a hook that already does EMA is enough for the required soft multi-second correction, no jump.

**Why:** built for a Swedish AR wind-turbine app where GPS/compass sensors intermittently degrade; the exact same freeze timer used for the fade caused perceptible turbine disappearance on single bad readings, and averaging GPS+compass quality masked compass-only degradation.

**How to apply:** when building sensor-fusion stability gating for AR/geo overlays, always split into (freeze threshold, sustained-bad grace period, fade ramp duration) as three separate tunables, and reuse an existing position-smoothing hook's freeze capability rather than writing a second smoothing/correction path.
