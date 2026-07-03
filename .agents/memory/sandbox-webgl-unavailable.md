---
name: Sandboxed test browsers lack WebGL/GPU
description: Both the app_preview screenshot tool and the Playwright-based testing subagent fail to initialize WebGL — relevant for any app using mapbox-gl, three.js, or other canvas/GPU rendering.
---

Both the `screenshot` tool's headless browser and the Playwright `runTest` testing subagent throw `Error: Failed to initialize WebGL` when loading a page that creates a WebGL context (observed with mapbox-gl, likely applies to any WebGL library — three.js, deck.gl, etc). The rest of the DOM/React app renders and is testable normally; only the actual GPU-backed canvas fails.

**Why:** These sandboxed browser environments run without GPU access. This is a fixed environment constraint, not a bug in application code — the same page works fine in a real end-user browser with GPU support.

**How to apply:**
- Don't chase this as a code bug. Confirm it's the WebGL-init error specifically (not a different crash) before assuming environment limitation.
- Add a graceful `mapboxgl.supported({ failIfMajorPerformanceCaveat: false })` (or equivalent) fallback UI for genuinely unsupported real-world browsers/devices — good practice regardless.
- When testing with `runTest`, explicitly tell the test plan that the WebGL fallback message is expected and not a bug, then have it verify everything else (search, filters, panels, data loading) around the map.
- Same category as the previously-documented camera/GPS/compass restrictions in headless test browsers — sensor/GPU hardware access is broadly limited in these sandboxes.
