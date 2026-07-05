---
name: AR "direct render" to "world-locked" blend transition
description: Guaranteeing objects render immediately (even indoors) then smoothly blending into full sensor-stabilized/occluded rendering, without any single hide-path breaking the guarantee.
---

When a product requires "always render immediately, then smoothly stabilize over N seconds" (e.g. AR overlays that must never be hidden by occlusion/indoor detection at first), don't gate visibility with a boolean or a threshold switch. Instead:

- Compute one shared 0..1 blend ref, driven by elapsed time since the session/feature started (`blend = clamp(elapsed / N_MS, 0, 1)`), read every frame.
- Find **every** place in the code that can independently reduce opacity/visibility (e.g. a shader occlusion branch, a global confidence-index multiplier, a sky-detection dimming factor) and blend each one toward "fully visible" using the *same* ref: `mix(1.0, normalComputedFactor, blend)`. Missing even one such site re-introduces the bug the whole feature was meant to fix.
- Keep an unrelated, purely-manual toggle (e.g. a user "show/hide" button) on a completely separate blend factor with its own timing — never reuse the sensor-driven blend ref for a manual on/off choice, and never let a manual toggle be overridden by `toggle || derivedCondition` (see `manual-toggle-vs-derived-mode-coupling.md`).
- Derive any debug "current mode" label (e.g. "direct" / "stabilizing" / "world-locked") directly from the same blend ref's value (0 / between / 1), not from a separately tracked state machine, so the debug readout can never drift from what's actually rendered.

**Why:** a hard cutover (either a boolean gate or a single per-object threshold) causes exactly the "hidden until fully calibrated" or "sudden pop-in/pop-out" symptom the product spec is trying to eliminate. Auditing for *all* independent dimming/occlusion sites is the same lesson as the "safety-fallback vs hide priority inversion" bug in this same codebase — any one unaudited site can override the guarantee.

**How to apply:** whenever asked to make a rendered/AR overlay "always show immediately, then refine", search for every existing multiplicative opacity/alpha factor in both CPU-side code and any shaders, and confirm the new time-based blend factor is applied at each one — not just the most obvious one.
