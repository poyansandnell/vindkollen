---
name: World-lock blend timer vs loading screen
description: arStartedAtMs must start when LoadingSequence completes, not when sensors are ready — or the force-visible window expires before the user sees anything.
---

The AR "direct AR → world-locked" blend (worldLockBlend 0→1 over WORLD_LOCK_BLEND_MS) is meant to guarantee turbines are visible the first few seconds the user sees the AR view.

**The bug:** `arStartedAtMs` was set when `arSessionVisible` (= sensors ready) became true. Sensors settle 10–30 s before LoadingSequence finishes. By the time LoadingSequence closes and the user first sees the AR canvas, worldLockBlend ≈ 1 — the force-visible guarantee is already over. At night, sky detection classifies dark sky as "not sky" → occlusion damps turbines to OCCLUSION_MIN_ALPHA (was 0.18 = nearly invisible).

**Why:** The timer should measure time since the user CAN see the AR view, not since sensors settled.

**How to apply:**
- Call `setArStartedAtMs(Date.now())` inside `handleLoadingSequenceComplete` (when the loading screen closes), NOT in the `arSessionVisible` useEffect.
- Keep the `if (!arSessionVisible) setArStartedAtMs(null)` reset so each new AR session gets a fresh window.
- Keep OCCLUSION_MIN_ALPHA ≥ 0.45 so turbines remain at least 45% opacity even when sky heuristic fails (night, overcast, dark camera).
