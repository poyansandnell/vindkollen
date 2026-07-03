---
name: Verifying a physical calibration gesture via sensor sector-sweep
description: How to detect that a "move the device in pattern X" instruction was actually followed, using bucketed raw sensor readings instead of a fixed timer.
---

When an app tells the user to perform a physical device motion for calibration (e.g. "move the phone in a figure-8" for magnetometer/compass calibration), a fixed-duration instruction screen doesn't verify anything — the user could ignore it entirely and the app would proceed regardless.

## Pattern: bucket the sensor's raw range into sectors, require most to be visited

Split the sensor's relevant value range (e.g. compass heading 0–360°) into N discrete buckets. On every raw sensor reading, mark which bucket it falls in as "visited." Consider the gesture done once a required fraction of buckets have been visited (e.g. 8 of 12, ~240° swept) — not just any single large jump, since that could be one glitchy reading rather than a real sweep.

**Why bucket count matters:** too few required buckets (e.g. 3–4) lets someone satisfy it by wiggling the device slightly in one direction; too many (e.g. requiring all 12) can make it nearly impossible to complete, especially with sensor dead zones or when indoors near magnetic interference. A supermajority (not literally 100%) is a reasonable default.

**Why use raw, not smoothed, sensor values:** if the app also runs the same signal through a smoothing/EMA filter for its primary UI purpose, that filter is often tuned to *reject* fast changes as noise — feeding the smoothed value into the gesture detector would make it artificially slow or impossible to complete the exact motion being asked for.

**Why to apply:** always pair this with an independent max-wait timeout (see the sensor-watchdog pattern) — a device with no working sensor, denied permission that silently no-ops, or a headless/test environment must never leave the user stuck on a screen waiting for input that can never arrive.

**How to apply:** expose a start/reset function to begin tracking at the right moment (e.g. right when the relevant screen appears, not from app launch), a 0..1 progress value for live UI feedback, and a boolean "complete" flag once the threshold is crossed. Gate the next step on `(complete AND minimum display time elapsed) OR max wait time elapsed`, polling periodically rather than trying to schedule a single precise timeout, since completion can happen at an unpredictable moment.
