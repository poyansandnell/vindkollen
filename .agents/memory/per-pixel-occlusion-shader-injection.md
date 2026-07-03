---
name: Per-pixel occlusion via onBeforeCompile + shared DataTexture
description: Technique for masking only the covered portion of a 3D object (not the whole object) using a screen-space occlusion grid sampled per-fragment.
---

When an app needs "only the occluded part of an object hides" instead of a binary whole-object show/hide (e.g. AR overlays occluded by real-world obstructions), inject a per-fragment mask via `material.onBeforeCompile` rather than toggling `material.opacity`/`visible` per object:

- Keep a single shared low-res occlusion grid (row-major, small like 12x8) updated once per frame from whatever detection heuristic exists (camera/ML/etc.), temporally smoothed (EMA) to avoid flicker.
- Upload it into one shared `THREE.DataTexture` (RGBA/Uint8 for broad compatibility — avoid single-channel formats that need WebGL2) each frame; `flipY = false` and do the vertical flip manually in the shader instead, since GL texture v=0 always maps to buffer row 0 regardless of visual "up".
- In each material's `onBeforeCompile`, add a varying carrying `gl_Position` from the vertex shader, then in the fragment shader convert it to a screen-space UV (`clip.xy/clip.w*0.5+0.5`, then `uv.y = 1-uv.y` to correct for NDC-top vs texture-row convention) and `texture2D()` sample the shared occlusion texture — this correctly varies per-fragment across a single mesh, unlike a single anchor-point check.
- Use `smoothstep(lowThreshold, highThreshold, occlusion)` rather than a hard cutoff, for a soft edge between visible/hidden regions.
- Collect the compiled `shader` objects returned by `onBeforeCompile` into an array so per-frame uniform updates (e.g. a user-toggled "show hidden as ghost outline" mode) don't require recompiling materials.
- Reserve the simple single-anchor-point check (e.g. one point projected to screen space, sampled against a boolean grid) for small/point-like elements (labels, icons, lights) where per-pixel masking isn't meaningful — don't force everything through the shader path.

**Why:** binary per-object occlusion looks wrong when part of a large object crosses an occluder boundary (e.g. half a wind turbine behind a tree); per-pixel shader sampling fixes this without expensive per-triangle CPU work.

**How to apply:** any WebGL/Three.js AR-style overlay where a coarse camera-derived visibility/depth grid must gate visibility of large 3D meshes at sub-object granularity.
