---
name: Gyro-magnitude turn confirmation for compass smoothing
description: How to use devicemotion's rotationRate to speed up compass-based heading smoothing without integrating gyro into an absolute heading.
---

When a compass-driven heading value feels sluggish during real turns (multi-sample "confirm" delay + a conservative still-state time constant both add lag), don't switch to integrating raw gyroscope rotation into an absolute heading — `rotationRate.alpha/beta/gamma` sign/axis conventions vary by device/browser and are unverifiable without a physical device.

Instead, use only the **magnitude** of the rotation-rate vector from `devicemotion` as a "a real turn is happening right now" boolean (threshold e.g. ~12°/s). Feed that boolean into the existing smoothing pipeline as an escape hatch:
- bypass any "N consecutive samples must agree" confirmation delay (the same way an unusually large single-sample jump already should)
- select the fast/turn time constant instead of the slow/still time constant

**Why:** This gives the *feel* of gyroscope-driven responsiveness (gyro is what's actually fast/high-frequency) while keeping the compass as the sole source of truth for the actual heading angle — avoiding an entire class of bugs from unverifiable device-specific gyro sign/axis conventions.

**How to apply:** Any time a user says "gyroscope should drive fast changes, magnetometer/compass only for slow drift correction" — this pattern satisfies that without a real sensor-fusion filter (e.g. Madgwick/Kalman). Expose the boolean in debug UI as a separate field from any existing frozen-value compass/gyro fallback source label — they are unrelated concepts and conflating them causes confusing debug panels.
