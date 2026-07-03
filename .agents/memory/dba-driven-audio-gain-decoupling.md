---
name: dBA-estimate-driven audio gain, decoupled from camera heuristics
description: Design pattern for tying a procedural ambient sound's playback volume to a displayed numeric estimate (e.g. dBA) instead of a separate distance/proximity curve, and for letting an explicit user toggle (not an automatic camera/sensor heuristic) drive both.
---

When a UI already shows a computed numeric estimate (e.g. "🔊 52 dBA") derived from distance/physics, and a companion feature needs to make ambient sound "feel like" that estimate, drive the sound's gain from the *same* estimate function via a single `estimateToGain(value)` mapping — do not maintain a second, independent distance/proximity curve for the audio. Two curves computed from the same inputs will drift out of sync over time as either one is tuned.

**Why:** Users compare the displayed number to what they hear. If the number comes from curve A and the volume comes from curve B, tuning either one in isolation silently breaks the correlation, and it's very easy to not notice this in review since both "look reasonable" independently.

**How to apply:** Add one pure function (e.g. `dbaToGain(value)`) next to the existing estimate function, feed the *already-computed* display value into it, and pass the result into the audio hook. Also prefer routing any indoor/outdoor (or similar environment) modifier through a single explicit, user-controlled toggle rather than an automatic camera/sensor heuristic when both audio *and* a displayed number need to change together — a manual toggle is deterministic and testable, while wiring both to a shared heuristic risks the same drift problem plus flicker from noisy sensor data.

**Gotcha found later:** even with gain correctly computed as 0, a synth/audio layer with a `BASE + gain * (MAX - BASE)` volume formula (a "floor" so ambience never fully disappears) will stay audible at `BASE` when gain is 0 — silently breaking the "0 estimate ⇒ silent" contract the user expects (e.g. "quiet indoors" still audibly played). Scale every gain target as `gain * MAX` (no additive floor) if the estimate can legitimately reach a state that should be silence, including any of that node's own startup/initialization volume ramps.
