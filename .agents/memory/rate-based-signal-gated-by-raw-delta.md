---
name: Rate-based confirmation signal nested behind a raw-delta gate
description: An independent °/s (rate) sensor confirmation silently never fires if it's only checked inside an `if (rawDelta >= threshold)` branch
---

A gyroscope/rate-based "is this a real, fast motion?" check (e.g. `rotationRate >= X°/s`) becomes effectively dead code if it is only evaluated *inside* a branch gated on the raw per-sample delta between consecutive sensor readings (`if (rawDelta >= NOISE_THRESHOLD_DEG) { ...check rate here... }`).

**Why:** raw per-sample delta and a °/second rate are different units that don't scale the same way — raw delta shrinks as sampling frequency rises (delta ≈ rate × dt). At typical 30-60Hz device-orientation sampling, even a genuinely fast, deliberate turn (20-60°/s) produces well under a degree of per-sample delta — almost always below a "5° raw delta" noise threshold tuned for that axis. So the outer gate silently swallows the case the inner rate-check exists to catch, and the rate signal only ever fires for implausibly large single-sample jumps (which are rare and usually themselves glitches). Symptom: smoothing/lag feels "stuck" or unresponsive to normal motion despite an already-implemented gyro-fusion bypass.

**How to apply:**
- Evaluate a rate-based (units/second) confirmation signal independently of, and before/alongside, any raw-delta-based noise gate — never nest it inside that gate's `if`.
- When the rate signal fires but the raw delta happens to be small (expected at high sample rates), don't let a delta-driven interpolation formula (`t = (delta - noise)/(turn - noise)`) silently clamp back toward the slow end — force the fast/confirmed branch explicitly (e.g. `t = 1`) instead of trusting the same formula that only works when delta is large.
- This pattern generalizes beyond compass/AR: any time you add a secondary, differently-scaled corroborating signal to an existing threshold-based classifier, check whether the new signal can actually reach evaluation in the common case, not just the extreme one.
