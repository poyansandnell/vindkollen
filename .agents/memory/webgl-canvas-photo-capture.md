---
name: WebGL canvas photo capture without preserveDrawingBuffer
description: How to grab a snapshot of a Three.js/WebGL canvas for compositing without enabling preserveDrawingBuffer
---

Do not enable `preserveDrawingBuffer: true` on a WebGL renderer just to allow
capturing a photo/snapshot later (e.g. compositing camera feed + AR overlay).

**Why:** `preserveDrawingBuffer` keeps the full draw buffer around every frame,
which raises GPU memory pressure on mobile browsers and increases the risk of
WebGL context loss. A lost context can render the canvas as an opaque black
overlay, which — if the canvas sits on top of a live camera `<video>` — looks
like "the camera view suddenly went black/disappeared" to the user.

**How to apply:** Instead, capture `canvas.toDataURL()` synchronously in the
same tick as `renderer.render()`, right after it's called inside the
animation/render loop (e.g. via a "pending capture" flag set from an
imperative handle). This avoids needing `preserveDrawingBuffer` since the
buffer still has fresh contents at that exact moment. Also add
`webglcontextlost`/`webglcontextrestored` listeners on the canvas that
toggle its visibility, so a lost context reveals whatever is behind it
instead of showing a black square.
