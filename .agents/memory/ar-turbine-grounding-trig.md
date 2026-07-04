---
name: AR object grounding via real trig, not fixed offset
description: How to keep a bearing/distance-placed AR object's base pinned near the horizon instead of floating, and keep its scale physically correct.
---

In a camera-fixed, bearing/distance-based AR scene (object position = fixed world XZ from bearing/distance, camera rotates via device orientation — see `ar-without-webxr.md`), a **fixed vertical offset** (e.g. `y = -8`) for every object's base decouples height from real geometry entirely. Combined with a heuristic (non-trig) distance-based scale falloff, this makes distant tall objects subtend a far larger vertical angle than physically correct — the reported symptom is objects appearing to "float in the sky" instead of sitting on the horizon.

**Fix:** compute both quantities from real trigonometry, using the same *real* (uncompressed) distance even when render distance is compressed/clamped for the scene's compressed draw distance:
- **Base Y** = `renderPlaneDistance * tan(atan2(groundHeightDelta - eyeHeight, realDistance))`. `groundHeightDelta` is the object's real ground elevation minus an assumed observer ground elevation (flat-terrain approximation when no user altitude is available — browser GPS altitude is unreliable/absent).
- **Scale** = `renderPlaneDistance / (realDistance * unitsPerMeter)` — reproduces the object's true angular size at the compressed render distance. A "boost for visibility" mode should multiply this scale only (grows upward from the grounded local origin), never adjust the base Y, or boosted objects will visibly lift off the ground.
- **Safety clamp:** if the object's computed top elevation angle would exceed a generous plausible max (paired with the site's real min viewing distance), recompute the angle using a capped minimum distance instead of the real (possibly GPS-glitched) one — but do NOT clamp scale the same way, since a legitimately close/tall object's large angular size is physically correct, not a bug.

**Why:** the “floating” bug persists even with correct camera-rotation/horizon-calibration code, because camera rotation only decides *what direction* the camera looks — it can't fix an object's own world position being wrong.
