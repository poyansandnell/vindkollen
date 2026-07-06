---
name: Debug overlay leader/follower layout
description: When a permanent debug strip must sit above other chrome, invert the height-measurement direction and cascade offsets through every sibling banner, not just the immediate one.
---

A small always-visible debug/status strip and a taller sibling UI region (e.g. a top bar with badges/buttons) can't both claim a fixed pixel position — one has to be the "leader" whose real rendered height drives the other's offset, or content reflow (e.g. text wrapping to more lines on a narrow screen) silently causes an overlap again.

**Why:** an earlier version measured the top bar's height and placed the debug strip below it. A follow-up request ("put the debug strip at the very top instead") required flipping which element is measured — but any other absolutely-positioned sibling that had its own *independent* hardcoded offset (e.g. a status banner sitting below the top bar via a guessed `top-32`) still overlapped once the leader's height changed, because it never referenced the leader's measured height at all.

**How to apply:** when moving a debug/status strip to a new anchor point, (1) attach the `ResizeObserver` ref to the strip's actual visible content box, not an outer `position: absolute` wrapper (which always reports height 0 since it's out of flow), and (2) audit for *every* other sibling with a hardcoded/guessed offset relative to the same region and make them all derive from the same measured height, not just the one directly reported as broken.

Related: an `overflow-x-auto` + hidden-scrollbar badge/chip row is an anti-pattern when the row lives inside a self-measuring, non-clipped absolute overlay (not a fixed-height clipped container) — items that don't fit are invisible and require a scroll gesture nobody knows exists, appearing as a "broken" clipped sliver. Prefer `flex-wrap` there; only fall back to horizontal scroll if the container is genuinely height-constrained and clipped.

**Recurrence confirmed:** switching that badge row to `flex-wrap` fixed the clipping but made the region 2-3x taller, and a sibling banner with a *guessed* fixed offset (`calc(8rem + leaderHeight)`) — not derived from the region's own measured height — collided with the now-taller region's buttons. Fixed by switching the sibling's offset to the region's own already-tracked `ResizeObserver` height (`regionHeight + leaderHeight + gap`) instead of a constant. Confirms: any time a self-measuring region's content is free to grow (wrap, conditional badges, toggled sections), audit every other absolutely-positioned sibling for a hardcoded offset — don't just fix the element that was reported broken.

**Compacting an always-expanding info region:** when wrapping/growth makes a chrome region too tall rather than clipped, the fix isn't more wrapping — collapse secondary items (anything not in the top ~2 priority signals) behind a small toggle button, default collapsed, and move rarely-used one-off actions (e.g. "recalibrate", "toggle visibility") into an existing overflow/menu sheet instead of showing all controls inline at once.
