---
name: Heading turn-confirm gate needs a large-jump escape hatch
description: A multi-sample "confirm this is a real turn, not noise" gate before fast-response smoothing can itself cause perceptible lag on genuinely fast real turns.
---

A common noise-rejection pattern for heading/compass smoothing: require N consecutive samples above a delta threshold, in the same direction, before trusting it's a real turn and switching to a fast response time-constant (rather than a single sample, which could be a handshake spike). This is good for rejecting small jitter, but it adds a fixed latency penalty (one extra sample's worth of wait) on EVERY real turn, including fast, unambiguous ones.

**Why:** A single-sample delta that is far larger than plausible sensor noise (e.g. several times the noise threshold) can never actually be noise — noise is bounded by the sensor's per-sample jitter magnitude, while a delta that large only occurs from a genuine fast rotation (or occasionally a real glitch, which is a separate concern handled by a max-plausible-rate filter). Waiting for confirmation on such an unambiguous sample only adds lag without rejecting any additional noise.

**How to apply:** Add a second, higher "obviously real" threshold. If a single sample's delta exceeds it, immediately mark the turn as confirmed (skip the multi-sample wait) instead of requiring the normal confirm-count. Keep the normal multi-sample gate only for deltas between the noise threshold and this higher threshold, where ambiguity is real.
