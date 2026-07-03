---
name: Nationwide-zoom payload bloat
description: A bounding-box "load everything visible" API is fine at city zoom but can return several MB of unrendered detail (e.g. full polygon geometry) at country zoom, hanging or crashing the page on mobile.
---

A map that fetches all features within the current viewport bounds (turbines, project areas, etc.) scales its response size with the bounding box. At city/regional zoom this is small. At whole-country zoom, if the response includes heavy per-feature geometry (e.g. full GeoJSON polygons with hundreds of vertices sourced from a government GIS layer) for thousands of rows, the payload can reach several MB — and that data isn't even visually distinguishable at that zoom (polygons render as sub-pixel blobs or aren't rendered as area outlines at all below a certain zoom). On a real mobile device (slower network + slower JSON parsing + less memory), this can manifest as "the map doesn't work" — slow, hangs, or effectively broken — even though it loads fine on desktop / in a fast sandbox environment.

**Why:** The bug only shows up at the wide/zoomed-out end of the range, which is easy to skip during manual testing (developers tend to test a specific city, not scroll all the way out to national scale) and impossible to reproduce in a headless/screenshot sandbox that also can't render WebGL maps at all (see `sandbox-webgl-unavailable.md`). A user report as vague as "the whole-Sweden view doesn't work" (versus "the map is broken" generically) is actually a strong, specific signal pointing at zoom-dependent payload size, not missing config or WebGL support.

**How to apply:**
- When a map/list endpoint accepts an open-ended bounding box, add an optional `detail=summary|full` (or similar) query param that omits genuinely heavy fields (e.g. full polygon/geometry) in summary mode, keeping only what's needed to render points/counts.
- On the client, compute whether the current bounds/zoom represents a "wide" view (e.g. bbox span above some threshold in degrees) and request summary detail in that case; switch to full detail once the user zooms in enough that the omitted detail would actually be visible.
- Verify the fix by comparing actual payload byte size (not just "it loads") for a full-country bounding box before/after — response time in a fast sandbox can look fine even when payload size would choke a real phone.
- Ask the user a clarifying question distinguishing "doesn't load at all" vs "specific view (e.g. zoomed out) doesn't work" before assuming a sandbox limitation (like WebGL) is the cause — the latter is a much stronger signal of a scale/performance bug.
