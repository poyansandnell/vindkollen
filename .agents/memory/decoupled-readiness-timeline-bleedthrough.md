---
name: Loading overlay bleed-through — fix with z-index, not a shared visibility gate
description: A boolean "ready" flag and a separate loading/calibration screen's internal timeline can both be true/showing at once; the correct fix is a z-index/stacking fix, NOT combining them into one gate that blocks the underlying feature's rendering.
---

A `ready` flag (e.g. GPS+compass+camera fix present) gates the main feature's
UI (3D scene, HUD bars, arrows, banners, toasts). Separately, a `LoadingSequence`
component runs its own internal phase timeline (calibration → countdown →
checklist) driven by timers/effects, unrelated to `ready`. Because both are
independent state machines, `ready` can flip true while the loading screen is
still visually showing, and if several `ready`-gated elements sit at a z-index
equal to or higher than the loading screen's overlay, they paint on top of it
inconsistently instead of being cleanly hidden.

**Revision (superseded prior advice):** an earlier version of this note
recommended deriving `contentVisible = ready && !showLoadingScreen` and gating
every post-loading element (including the 3D scene itself) behind that
combined flag. That fix was later reported as a regression: if the loading
screen's own timeline has a long worst-case duration (e.g. multi-phase sensor
calibration with per-phase watchdog timeouts), gating the *entire* underlying
render loop's visibility on the loading screen's closure makes the whole
feature look frozen/broken for that entire worst-case duration, even though
the render loop was running and positioning objects correctly underneath the
whole time (a CSS-opacity `visible` prop doesn't pause a `requestAnimationFrame`
loop — it just chooses not to show what it drew).

**Why:** "Ready to show content" and "the loading screen has finished
displaying" are two different conditions, but conflating them by blocking
render visibility on the second one couples an unrelated decorative timeline's
worst case directly to the user's perception of whether the core feature
works at all.

**How to apply:** Keep the underlying feature's visibility gated on `ready`
ALONE — never on the loading screen's own closure state. Solve bleed-through
purely via stacking order: give the loading overlay a z-index strictly higher
than every HUD/content element it should cover, and make the overlay itself
dismiss quickly (short timeouts, an always-visible skip button) rather than
holding the real content hostage to its animation timeline.
