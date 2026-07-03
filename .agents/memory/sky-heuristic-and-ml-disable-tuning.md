---
name: Sky-detection heuristic and ML disable tuning
description: Why the brightness/texture "sky" heuristic false-positives on bright indoor walls, and why aggressive ML slow-sample thresholds can permanently disable a heavy on-device segmentation model within seconds.
---

Two related pitfalls found in the wind-turbine AR occlusion feature (`useSkyDetection.ts`), both of which silently made the "occlude turbines / detect indoors" feature stop working on real devices while looking correct in code review.

## 1. Bright-wall / low-texture heuristic false positive

A cheap brightness+saturation+texture heuristic used to guess "is this patch of camera image sky?" (bright, low local stddev, low saturation or blueish) will also match a well-lit, plainly-painted indoor wall or ceiling — especially if the analysis downsamples to very few pixels per cell (e.g. 3x3), which erases the texture signal that would otherwise distinguish a painted wall from open sky.

**Why:** Downsampling that aggressively destroys the very texture cue the heuristic depends on, so "smooth wall under room lighting" and "overcast sky" become statistically indistinguishable.

**How to apply:** When using a luminance/texture heuristic like this, sample enough pixels per cell (8x8, not 3x3) to preserve real-world texture, and set brightness/texture/saturation thresholds conservatively (validated against actual indoor lighting brightness, not just guessed values) — err toward under-detecting "sky" rather than over-detecting it, since a false "outdoors" reading silently disables indoor-only UX.

## 2. Heavy on-device ML model + tight "too slow, disable permanently" threshold

A pattern like "if single inference > X ms, count as slow; after N slow samples, permanently disable ML for the session" is dangerous when the model itself (e.g. DeepLab/TFJS in a mobile browser) is inherently heavy: cold-start shader compilation on the very first inference is always much slower than steady-state, and steady-state itself may legitimately take 1-3s on mid-range phones for a feature that only needs to update a few times per second (not every frame).

**Why:** A threshold tuned as if the model needed near-real-time (e.g. under 1s, 3 strikes) will trip on ordinary mobile hardware within the first second or two of every session, permanently falling back to "feature never engages" — which looks like a total feature failure to the end user even though the fallback code path itself works exactly as designed.

**How to apply:** Exclude the first (warm-up) inference from the slow-sample counter, and set the slow threshold against what the *feature* actually needs (e.g. "updates a few times per second" != "30fps"), not an arbitrary conservative ms value.

## 3. Raising grid resolution (finer cells) silently raises texture noise per cell too

Increasing `GRID_ROWS`/`GRID_COLS` for a canvas-downsample heuristic (to improve spatial precision, e.g. matching a treeline boundary) while keeping the same per-cell sample size (`CELL_PX`) shrinks how much of the source video each cell represents — which means *less* averaging/blurring of real-world noise per cell, not more precision for free. A `stdDev`-based "is this smooth like sky" texture threshold tuned for the old, coarser grid will then misfire: real sky (especially hazy/overcast, common near the horizon) can exceed the old threshold purely from finer sampling, not from a real texture change, and gets misclassified as "occluded."

**Why:** This shipped as a real regression — a same-session change that only bumped grid resolution (12x8 → 16x20) made an "occlude behind trees" overlay start rendering as if entire wind turbines against open sky were occluded, turning them visibly red/dashed everywhere instead of only when genuinely behind trees.

**How to apply:** Any time you change a downsample-grid resolution for a brightness/texture heuristic, re-derive (don't just carry over) the texture/brightness thresholds — the effective smoothing ratio (source pixels per cell) changed, so the old thresholds no longer mean the same thing. Retest against synthetic "sky-like" pixel patches with realistic added noise, not just clean averages.
