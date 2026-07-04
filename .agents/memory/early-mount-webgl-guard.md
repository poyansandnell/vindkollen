---
name: Early-mounting a WebGL component needs its own try/catch
description: When a heavy WebGL/Three.js component is deliberately mounted before sensor/permission readiness (to pre-build objects), context-creation failure must be caught locally instead of crashing the page.
---

Mounting a `THREE.WebGLRenderer`-based component as early as possible (e.g. immediately on "start" rather than waiting for GPS/camera/compass readiness, so heavy object construction happens in the background) removes an implicit safety net: previously the component only mounted once other async preconditions had already succeeded, so environments without WebGL support rarely reached the renderer construction at all. Once mounted unconditionally and early, `new THREE.WebGLRenderer(...)` throwing (no WebGL support) becomes a hard, immediate crash of the whole page instead of a rare edge case.

**Why:** discovered when switching an AR feature from "wait for full sensor fix, then mount" to "mount immediately, toggle visibility later" — a Playwright/headless test browser without WebGL then crashed on the very first interaction, whereas the old code path never got far enough to expose it.

**How to apply:** whenever restructuring a component to mount earlier/eagerly for perceived-performance reasons, wrap the WebGL context/renderer creation itself in a local `try/catch` that bails out gracefully (leave the mount point empty, no page-level crash) rather than assuming downstream gating still protects it.
