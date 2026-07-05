---
name: Stale camera matrixWorldInverse in same-frame reads
description: Three.js/R3F camera.matrixWorldInverse is not refreshed just because quaternion/position was set; frustum/camera-space math read before renderer.render() in the same frame sees last frame's orientation.
---

Three.js (and `@react-three/fiber`'s render loop) normally refreshes a camera's
`matrixWorldInverse` and dependent camera-space math inside `renderer.render()`,
which runs at the END of the frame. If your own `useFrame`/`animate()` code sets
`camera.quaternion`/`camera.position` and then, in that SAME callback, does
frustum culling or projects world points into camera space (screen coords,
"is this in frustum", bearing-relative-to-camera, etc.), it is reading the
PREVIOUS frame's camera orientation — one frame stale.

With a fast-changing orientation source (e.g. a phone compass updating every
frame), this can systematically misclassify currently-visible objects as
"outside frustum"/not visible, even though position, scale, and all visibility
flags are otherwise correct — a hard bug to spot because everything upstream
of the camera looks healthy.

**Why:** `matrixWorldInverse` is a derived/cached matrix, not automatically
recomputed on every property write — only `updateMatrixWorld()` (called by
`renderer.render()` normally) refreshes it.

**How to apply:** if any code path reads camera-space/frustum data earlier in
the same frame than `renderer.render()`, call
`camera.updateMatrixWorld(true)` manually right after updating the camera's
quaternion/position, before that read.
