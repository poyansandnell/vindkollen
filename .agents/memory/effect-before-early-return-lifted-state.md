---
name: Effect-before-early-return for lifted boolean state
description: A child component that reports a derived boolean up to a parent via callback prop must compute/report it before any early `return null`, not after.
---

When a component lifts a derived condition (e.g. "am I currently on-target / visible / active?") to a parent via a callback prop (`onXChange?.(value)`), the reporting `useEffect` must run on every render where the underlying inputs are known — including renders where the component is about to early-return `null` because some other input is temporarily invalid (e.g. GPS fix lost, data not yet settled).

**Why:** If the derived value and its reporting effect are placed *after* an early `return null`, then whenever the component starts returning `null` the effect simply stops running — the parent never receives the "false"/"off" report and keeps believing the last-known "true" value forever. This produces a stale, stuck parent state (e.g. a unified status banner that never clears a "you're on target" message even after the underlying condition became invalid).

**How to apply:** Compute the derived boolean and call the reporting effect *before* any conditional `return null` in the component body. Guard the boolean expression itself with all the necessary null-checks (so it safely evaluates to `false` when inputs are invalid) rather than relying on the early return to skip the reporting logic.
