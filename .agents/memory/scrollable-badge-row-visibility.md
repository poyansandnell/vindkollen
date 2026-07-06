---
name: Horizontally scrollable badge/chip row hides content silently
description: Placing an important status badge late in an overflow-x-auto row without a scroll affordance makes it invisible to users who never think to scroll
---

A row of status badges/chips laid out with `overflow-x-auto` + `whitespace-nowrap` (no wrap, no visible scrollbar) works fine on wide viewports but silently truncates on narrow ones — anything past the initial visible width is still in the DOM and "working correctly" from a data standpoint, but the user never discovers it exists, since there's no visual cue (scroll shadow, arrow, dots) hinting more content is off-screen.

**Why:** the failure looks identical to "the feature doesn't exist" from the user's perspective. They report the feature missing, not "the row doesn't scroll," because they have no way to know scrolling is possible.

**How to apply:**
- Order badges/chips by importance, not just logical grouping — put the most-requested/most-critical status first, since it's the one guaranteed to survive on any screen width.
- If a scrollable row is unavoidable, prefer a subtle affordance (edge fade/gradient, or wrap-with-scroll on very narrow screens) over silent overflow.
- When a user says "there's no indicator for X" and X actually exists in code, check position within a scrollable/overflow container before assuming the logic itself is broken.
