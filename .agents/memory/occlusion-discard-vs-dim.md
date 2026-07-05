---
name: Occlusion shader discard vs dim
description: A per-pixel occlusion mask that fully discards fragments can hide an entire AR scene at once if the underlying sky/occlusion classifier misclassifies a whole frame.
---

A per-pixel occlusion shader that uses `discard` (or any hard 0-opacity branch) when a coarse camera-image heuristic (brightness/texture/saturation classifier) says a pixel is "not sky/occluded" is dangerous: that heuristic can misclassify an entire camera frame at once (overcast light, glare, haze, a bright-but-textured sky) — not just isolated pixels. Because the same misclassification applies to every AR object's fragments simultaneously, the practical symptom is "nothing renders at all" even though GPS/compass/positioning/frustum are all completely healthy — which looks like a positioning or sensor bug but is actually a shader/classifier issue.

**Why:** Root-caused a "turbines never render" bug report where every other diagnostic (GPS fix, compass fix, tracking-stability tier, per-turbine world position) was healthy. The only thing wrong was a `discard` in the occlusion fragment shader driven by a per-frame sky classifier that occasionally called the whole visible frame "not sky."

**How to apply:** Any occlusion/masking effect driven by a heuristic classifier (not ground-truth depth data) should only ever dim/attenuate (e.g. `alpha *= mix(FLOOR, 1.0, mask)`), never fully hide via `discard` or `opacity = 0`. This mirrors the more general "dampen never remove" pattern for any single fallible signal that can drive full-scene visibility to zero. When debugging "nothing renders," check occlusion/masking shaders even when positioning/sensor pipelines all report healthy — a classifier misfire elsewhere in the render path can look identical to a positioning bug.
