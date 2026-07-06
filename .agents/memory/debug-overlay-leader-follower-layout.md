---
name: Debug overlay leader/follower layout
description: When a permanent debug strip must sit above other chrome, invert the height-measurement direction and cascade offsets through every sibling banner, not just the immediate one.
---

A small always-visible debug/status strip and a taller sibling UI region (e.g. a top bar with badges/buttons) can't both claim a fixed pixel position — one has to be the "leader" whose real rendered height drives the other's offset, or content reflow (e.g. text wrapping to more lines on a narrow screen) silently causes an overlap again.

**Why:** an earlier version measured the top bar's height and placed the debug strip below it. A follow-up request ("put the debug strip at the very top instead") required flipping which element is measured — but any other absolutely-positioned sibling that had its own *independent* hardcoded offset (e.g. a status banner sitting below the top bar via a guessed `top-32`) still overlapped once the leader's height changed, because it never referenced the leader's measured height at all.

**How to apply:** when moving a debug/status strip to a new anchor point, (1) attach the `ResizeObserver` ref to the strip's actual visible content box, not an outer `position: absolute` wrapper (which always reports height 0 since it's out of flow), and (2) audit for *every* other sibling with a hardcoded/guessed offset relative to the same region and make them all derive from the same measured height, not just the one directly reported as broken.
