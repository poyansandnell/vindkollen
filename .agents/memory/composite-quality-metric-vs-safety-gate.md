---
name: Composite display metric vs safety-critical gate
description: When a user-facing "quality/stability %" feels misleading because it's secretly just the narrow signal driving a safety gate, add a separate wider composite for display only — don't touch the gate.
---

A displayed confidence/stability percentage that reuses the exact signal driving a
safety-critical gate (e.g. position-freeze, fade-out) will feel wrong to users once they
notice it doesn't reflect other things they intuitively expect it to cover (compass
precision, gyro/tilt steadiness, calibration state, etc).

**Why:** Widening the gate's own formula to "fix" the display risks changing frost/fade
behavior that was already tuned and trusted. The two concerns — "is it safe to keep
rendering at this position" vs "how good does this feel to the user" — have different
tolerance for false positives/negatives.

**How to apply:** Keep the original narrow metric (e.g. `min(gpsQuality, headingQuality)`)
completely unchanged for the gate. Add a second, separately-named composite (weighted
average, not min) that pulls in the additional signals, expose it as its own field, and
point only the display component at it. Same pattern applies any time "the number on
screen doesn't match what users think it measures" — check whether the number is
overloaded for both display and control before touching the underlying gate.
