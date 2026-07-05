---
name: Ref-driven audio EMA loop decoupled from React render rate
description: How to guarantee a GainNode volume recomputes at a fixed high frequency (e.g. ≥10Hz) regardless of how often the caller re-renders or calls the update function.
---

When a product requirement says a value (e.g. audio volume tracking a
displayed dBA number) must recompute at a fixed minimum frequency
(e.g. ≥10x/sec), don't drive that recomputation from a React
effect/state-change — those only fire when the caller happens to re-render
or when an upstream value (like a throttled/smoothed GPS-derived dBA)
actually changes, which can be far slower than the requirement.

**Why:** `setTargetAtTime`-style Web Audio scheduling and React-effect-driven
updates both only run "when called", not continuously — if the caller's
update cadence is slower than the requirement, the audible/displayed result
lags or steps instead of tracking smoothly, even though the underlying
formula is correct.

**How to apply:** split "set the latest target" from "apply it". The
public update function (e.g. `updateProximity(targetVolume, ...)`) should
only write to a ref. A separate, self-contained `setInterval` loop (started
on playback start, cleared on stop/unmount) reads that ref every tick,
applies the exact smoothing formula (e.g.
`smoothed = smoothed*0.85 + target*0.15`), and writes the result directly to
`GainNode.gain.value` (not a scheduled ramp). This guarantees the tick rate
— and therefore the perceived responsiveness — is independent of how often
upstream state changes or the caller's component re-renders. Expose the
smoothed "actual" value via a ref (not state) if it needs to be shown in a
debug panel, since it's mutated outside React's render cycle.
