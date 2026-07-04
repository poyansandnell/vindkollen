---
name: Full-screen overlay z-index vs persistent indicator
description: A full-screen status overlay can silently hide an always-should-be-visible indicator (arrow, badge) unless the indicator's z-index is explicitly higher.
---

When a feature must remain usable/visible even during a full-screen blocking state (e.g. "you're indoors, but sound/direction still work"), any persistent indicator meant to survive that state (a directional arrow, a status badge) needs a higher `z-index` than the overlay, not just correct logical gating.

**Why:** it's easy to reason about the *logical* condition ("render the arrow whenever `ready`, independent of indoor state") and forget that a separate full-screen `inset-0` overlay rendered later in the DOM with a high z-index will still visually cover it, even though both pass their own render conditions correctly. The bug is invisible in code review of either component alone — it only shows up by tracing z-index across sibling elements.

**How to apply:** whenever adding an overlay meant to replace/mask a feature during a degraded state, explicitly audit every element that is supposed to remain visible during that overlay (arrows, retry buttons, status badges) and give it a z-index above the overlay's. Document the z-index ordering in a comment near the overlay so future additions don't regress it.
