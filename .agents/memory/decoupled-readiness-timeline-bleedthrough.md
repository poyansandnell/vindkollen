---
name: Decoupled readiness flag vs. own-timed loading screen causes bleed-through
description: A boolean "ready" flag and a separate loading/calibration screen's internal timeline can both be true/showing at once, letting gated content render on top of or behind the loading screen instead of strictly after it.
---

A `ready` flag (e.g. GPS+compass+camera fix present) gated the main feature's
UI (3D scene, HUD bars, arrows, banners, toasts). Separately, a `LoadingSequence`
component ran its own internal phase timeline (calibration → countdown →
checklist) driven by timers/effects, unrelated to `ready`. Because both were
independent state machines, `ready` could flip true while the loading screen
was still visually showing, so `ready`-gated elements began rendering
immediately — with several of them (banners, HUD bars, an arrow) also sitting
at a z-index equal to or higher than the loading screen's overlay, so they
painted on top of/behind it inconsistently instead of being cleanly hidden.

**Why:** "Ready to show content" and "the loading screen has finished
displaying" are two different conditions. Treating either one alone as the
gate for post-loading content causes a race: the feature can be ready before
the loading screen closes, or the loading screen's timeline can outlast the
underlying readiness check.

**How to apply:** When a dedicated loading/calibration screen has its own
timeline separate from the underlying async readiness signal, derive a single
combined flag (e.g. `contentVisible = ready && !showLoadingScreen`) and gate
*every* post-loading element behind that combined flag, not `ready` alone.
Audit z-index too — even a correctly-gated element can visually clash with a
loading overlay if it's not strictly gated by the same combined condition.
