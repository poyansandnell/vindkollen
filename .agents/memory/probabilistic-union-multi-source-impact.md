---
name: Probabilistic-union combination for multi-source distance impact
description: How to combine several independent sources' distance-decay effects on the same target so overlap increases impact without exceeding 100%.
---

When several independent sources (e.g. turbines, emitters, hazards) each have a
0-1 "impact fraction" on the same target (e.g. a household cluster) based on
distance decay, don't just take the max/nearest source's fraction — that
makes adding more nearby sources invisible to the metric.

Instead combine via a probabilistic union: `combined = 1 - Π(1 - fraction_i)`
over all sources. This guarantees:
- Combined effect only rises as more/closer sources are added (monotonic).
- It never exceeds 100%, so it stays a well-behaved fraction for weighting/averaging.
- A single dominant source still dominates (if one fraction is ~1, combined ≈ 1
  regardless of others), matching intuition.

**Why:** a max-of/nearest-of approach fails the common product requirement
"if multiple sources affect the same area, the effect should increase" —
it's the natural union-of-independent-events analogy, cheap to compute (one
pass per target, no combinatorics), and composes with per-target weighting
(e.g. multiply by household count and sum) to get a population-level index.

**How to apply:** use for any "does this feature affect that point, and do
overlapping features compound" scoring model — noise/impact scoring, coverage
maps, exposure indices. Pair with a continuous (piecewise-linear anchored)
per-source distance-decay function, not a step function, so the whole model
updates smoothly for real-time/live-editing UIs.
