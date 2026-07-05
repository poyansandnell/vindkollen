---
name: Safety-fallback vs "hide everything" priority inversion
description: A force-visible/force-show safety net is worthless if any independent "hide everything" condition can still zero it out — audit priority order across ALL code paths that compute the same final visibility/opacity value.
---

When a system has both (a) several independent conditions that can each drive a visual element to "fully hidden" (e.g. an indoor heuristic, a low-confidence tier, a not-yet-calibrated state) and (b) a safety-net flag whose entire purpose is to guarantee something stays visible (e.g. a 2-second "nothing rendered yet, force-show the nearest N" fallback), the safety-net flag must be checked **first**, before any of the hide conditions, in **every single place** the final value is computed.

**Why:** It's easy to add the fallback flag in one place (e.g. the main opacity function) but miss a second parallel calculation of the same value (e.g. a shadow-opacity calc in an animation loop) or an entirely separate UI layer (e.g. a full-screen overlay gated on the same "hide" condition, sitting on top of the 3D scene). If any one of those paths doesn't check the fallback flag first, the fallback is silently defeated and the user sees "nothing rendered" even though the fallback logic itself looks correct in isolation.

**How to apply:** When implementing or reviewing a "never show a blank/empty state" safety net:
1. Find every code path that reads the same underlying "should this be hidden" state (opacity calculations, shadow/secondary render passes, full-screen overlays, CSS classes, etc.) — grep for the hide condition's variable name across the whole codebase, not just the file you're editing.
2. In each one, restructure the logic so the safety-net check is the first branch (`forceVisible ? fullyVisible : ...hideLogic`), not something the hide logic can short-circuit past.
3. Prefer floors over hard zeros for "dim" states (e.g. `Math.max(computedFactor, MIN_FLOOR)`) so a value can be de-prioritized without secretly becoming invisible even when the fallback isn't active — this makes the system fail toward "dim but visible" rather than "gone."
