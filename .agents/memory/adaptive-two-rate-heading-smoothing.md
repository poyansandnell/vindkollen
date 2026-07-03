---
name: Adaptive two-rate heading smoothing
description: Fixing AR/compass overlay jitter that survives a fixed-tau EMA and event-source dedup
---

A single fixed-tau exponential moving average on device-orientation heading cannot satisfy both goals at once: a low tau (fast) lets several-degrees-even-when-stationary magnetometer noise through unfiltered, while a high tau (slow) makes the overlay lag noticeably behind real turns.

**Why:** Heading error maps directly to on-screen angular error in a bearing/distance-based AR overlay, with no distance-based attenuation (unlike GPS position error, which is angularly damped by distance to the target). So *any* leftover raw-heading jitter — even after removing duplicate/conflicting event sources — is fully visible as object jitter, and fixing it requires more than one smoothing constant.

**How to apply:**
- Compute the raw delta between the new heading reading and the current smoothed value, then interpolate the EMA time constant based on delta size: small deltas (a few degrees, likely noise) get a long tau (heavy damping), large deltas (tens of degrees, a real turn) get a short tau (fast response), linearly interpolated in between. This is the same idea as "one-euro" filters.
- Separately reject single readings that imply an implausible turn rate (e.g. >720°/s) as sensor glitches, before they ever reach the smoother.
- Don't gate dependent UI/rendering on "a fix exists" alone — track a stability signal (e.g. a rolling measure of how consistent recent headings have been) and only flip a `hasSettled`-style ready flag once that stability has held for a continuous window, with a max-wait timeout fallback so a device that never fully stabilizes doesn't block forever. This is strictly better than a fixed blind countdown because it adapts to how quickly the specific device/environment actually settles.
