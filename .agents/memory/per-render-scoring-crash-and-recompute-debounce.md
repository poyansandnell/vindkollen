---
name: Per-render scoring crash and committed-snapshot recompute debounce
description: Why calling an O(n)-or-worse scoring function per marker on every pan/zoom re-render crashes an interactive map, and the pattern used to fix it with smooth UX.
---

Calling a non-trivial scoring/derivation function (e.g. distance-to-many-points impact scoring) once per rendered object, inline in the render path, is fine at low object counts but compounds badly: every pan/zoom/gesture-driven re-render re-invokes it for every object, and the cost grows with both render frequency and object count simultaneously. On mobile this manifests as a hang/crash during ordinary gestures (pan, pinch), not just at high object counts.

**Fix pattern — two decoupled layers:**
1. **Child render layer**: memoize the per-object derived value (e.g. `useMemo` keyed only on the *inputs that should trigger recolor*, such as an explicit `colorTurbines` prop), never on every prop/state change the component receives. This stops re-scoring on pan/zoom frames where nothing scoring-relevant changed.
2. **Parent state layer**: keep two snapshots of the mutable list — a "live" one that updates immediately for responsive dragging/moving/adding (visual position only), and a "committed" one that the expensive scoring function actually reads, which only catches up to the live one after a short debounce (e.g. 700ms) following the last edit. Show a lightweight "calculating…" indicator during the debounce window.

**Why:** This both fixes the crash (expensive scoring is now off the synchronous gesture/render path) and produces better UX than eliminating the delay entirely — a debounced "Beräknar…" pill communicates that a real recalculation is happening, rather than the score appearing to silently lag or flicker.

**How to apply:** Any interactive map/canvas/list where (a) each item has a non-trivial per-item derived value used for coloring/scoring, and (b) the container supports continuous gestures (pan/zoom/drag) that trigger frequent re-renders independent of data changes.
