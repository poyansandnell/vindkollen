---
name: Smoothing tau scaled by measurement uncertainty vs. actual target sensitivity
description: A noise-adaptive EMA time constant that scales with input uncertainty can create very long perceived wait times if the downstream use case isn't actually that sensitive to the leftover error
---

Scaling an EMA smoothing filter's time constant up when input measurement quality is poor (e.g. GPS accuracy) is a reasonable way to suppress noise, but an aggressive multiplier (e.g. 5x base tau) can push worst-case convergence time (~3×tau to reach ~95%) into the tens of seconds — long enough that users perceive the feature as "stuck" or "wrong for a full minute."

**Why:** the multiplier is usually chosen to protect against worst-case jitter in the abstract, without checking how sensitive the actual downstream computation is to that residual error. For a bearing/direction calculation to a target many kilometers away, tens of meters of position uncertainty translates to only a small angular error — much less disruptive than the multi-second (or multi-ten-second) delay incurred by over-damping.

**How to apply:**
- Before tuning a noise-adaptive tau multiplier, compute (or reason through) how much the final displayed/used value actually changes for the residual error the multiplier is meant to hide. If the visible effect of "not waiting" is small, a large multiplier is buying stability nobody needed at the cost of a wait nobody wants.
- Prefer capping the multiplier to the smallest value that still suppresses the specific spike pattern that motivated it (verify with a separate spike-rejection check, e.g. an implausible-speed/rate filter) rather than fixed multipliers picked for a "worst case" that may not matter for this specific consumer of the value.
