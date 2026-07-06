---
name: Modal overlay z-index must exceed ALL app chrome, not just be "high enough"
description: A full-screen settings/modal overlay silently fails to hide sibling panels if any of them has a higher z-index, even with a backdrop blur.
---

A full-screen modal overlay (`inset-0` + backdrop blur, closes on outside click) only visually and interactively covers siblings with a **lower** z-index than itself. If any other absolutely-positioned panel in the same view (e.g. a status bar, bottom action bar, or an "expanded info" panel) has a higher z-index, it renders on top of the modal — the backdrop blur does nothing to it (blur only affects elements *behind* the blurred layer, not siblings with higher stacking order), and it becomes visually stuck on screen, un-closeable, and can block the modal's own close affordances.

**Why:** In this codebase, a settings/visualization panel was added at `z-40`, but the top bar and bottom action bar (which contain expandable "more info" panels) were already at `z-[45]` for an unrelated reason (staying above an indoor/no-signal overlay at `z-40`). Opening settings didn't hide those expanded panels, so they bled through the settings backdrop, made the screen unreadable, and gave no way back.

**How to apply:** When adding any new full-screen modal/overlay in a view that already has several stacked absolutely-positioned layers, audit ALL existing z-index values in that view first (grep for `z-\[` and `z-\d+`) and assign the new modal a z-index strictly higher than the highest existing one — don't just reuse or guess a value that "seems high enough" relative to only one other element.
