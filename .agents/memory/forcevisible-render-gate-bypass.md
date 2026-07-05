---
name: Force-visible bypass for render gating
description: Pattern for guaranteeing an AR/visualization object renders even when confidence-based visibility gating would otherwise hide it.
---

When a feature requires "object X must render no matter what" (e.g. a
near-center heading bypass, or a calibration-fallback showing nearest N
objects), add a boolean/set-membership flag per-object (e.g.
`forceVisible`) that is computed independently of the normal confidence
gate, then have the opacity/render logic check that flag *before*
applying the gate's multiplier — never fold the force condition into the
gate's own inputs.

**Why:** Mixing a "must show" condition into the same signal used for
confidence-based fading (e.g. `visibilityFactor * forceCondition`) reintroduces
exactly the flakiness the force-bypass was meant to eliminate. Keeping it
as a separate final check (`if (forceVisible) return full opacity; else
apply gate`) guarantees the bypass truly overrides, while still letting a
hard safety net (e.g. "fully indoors, hide everything") take precedence
over even the force-visible flag.

**How to apply:** Any time you need "show this even though the normal
visibility heuristic says no" (near-center heading bypass, a fallback
calibration display, forced test/debug objects), thread a separate
force-visible signal through to the final opacity/visibility computation
and check it first, before the graduated confidence multiplier — but still
respect any absolute hide (e.g. indoor overlay).
