---
name: Dynamics compressor + high makeup gain flattens perceived distance
description: A hard compressor plus a large makeup-gain multiplier on a Web Audio chain can flatten dynamic range so much that a "closer = louder" effect stops being perceptible, even though the underlying gain node is correctly distance-driven.
---

A `DynamicsCompressorNode` with an aggressive threshold/ratio (e.g. -26dB / 18:1) followed by a large makeup `GainNode` (e.g. 2.7x) compresses nearly the whole practical input range up toward the same output level. Downstream, a distance-driven gain value that is technically correct (e.g. via `dbaToGain`) still ends up sounding almost the same regardless of distance, because the compressor already squashed the difference before the ear hears it.

**Why:** users reported "the sound is the same volume no matter how far away" — the bug wasn't in the gain calculation itself, it was in a limiter stage applied *before* that gain reaches the speaker, which flattened the dynamic range the gain was trying to create.

**How to apply:** when a distance/proximity-driven sound doesn't audibly change despite a correct gain calculation, check for a compressor/limiter/makeup-gain stage in the audio graph between the gain node and the output. Keep the compressor as a clipping safety net only (soft knee, low ratio like 3-4:1, modest threshold, makeup gain near 1.0-1.1x) rather than a loudness-boosting stage — and independently, consider steepening the gain curve itself (e.g. squaring a normalized 0..1 value) for clearer perceptual tiering across distance.
