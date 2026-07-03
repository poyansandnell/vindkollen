---
name: dB-subtraction-through-a-clamped-normalize can silently no-op
description: Why subtracting a fixed dB attenuation and re-running it through a floor/ceiling-clamped linear normalize can produce zero perceptible change, and the fix (multiply the linear gain directly).
---

Deriving a linear audio gain from a dB value via `clamp((dba - floor) / (ceiling - floor), 0, 1)`, then applying a manual attenuation (e.g. an "indoors" mode) by subtracting a fixed dB amount *before* that same clamp, can produce **no audible difference at all** — not just a smaller-than-expected one.

**Why:** if the fixed attenuation is large relative to the (ceiling - floor) span, and the unattenuated value already sits near the floor (a common real-world case, e.g. distant sound sources), both the attenuated and unattenuated values clamp to the same result (usually 0). The two states become indistinguishable, even though the underlying formula looks correct on paper.

**How to apply:** when a toggle/mode must always produce a guaranteed, proportional, audible (or otherwise perceptible) change, apply the attenuation as a **direct multiplier on the already-computed linear value** (e.g. `linearGain * 10**(-dB/20)`), not as a pre-clamp subtraction on the underlying raw unit re-fed through the same normalize-and-clamp step. This keeps the two code paths (the displayed raw-unit value and the derived linear output) mathematically equivalent in dB terms while avoiding compounding clamp/floor effects.
