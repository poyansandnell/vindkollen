---
name: Boundary polygon live-edit indirection
description: Pattern for an interactive editable polygon (drag/add/remove vertices) whose edits must stay decoupled from a scoring function that reads the polygon via a module-level getter rather than a parameter.
---

A live polygon editor needs three separate values in play at once: the persisted/scored polygon, the in-progress live edit, and the read-only debug overlay. Conflating any two causes either edits to leak into scoring before "save", or the debug overlay to silently keep showing stale data.

**Why:** the scoring function reads its input polygon through a getter (module-level state, e.g. `getActiveBoundary()`) rather than as an explicit argument, so a memoized computation calling it has no natural dependency to invalidate on — a save/reset must bump an explicit version counter or the memo returns a stale result forever.

**How to apply:**
- Give the editor its own local live-edit state, seeded from the getter only when edit mode is entered — never write into the persisted store until an explicit "Save" action.
- Any `useMemo`/`useCallback` that calls the getter-based scorer must depend on an explicit version counter bumped by save/reset, not just on the values that logically changed.
- When a click adds a new vertex to a polygon, insert it on the nearest edge (closest point on any segment, computed via a per-segment projection/clamp, not nearest vertex) so an arbitrary tap can't make the polygon self-intersect.
- Guard vertex removal with a minimum vertex count (3) so the polygon can't collapse to a degenerate line/point.
- For exporting the edited shape as a file (e.g. GeoJSON) from a client-only PWA, prefer a `Blob` URL opened via `window.open(url, "_blank")` over an `<a download>` link — see the iOS PWA download-attribute pointer in `.agents/memory/MEMORY.md`.
