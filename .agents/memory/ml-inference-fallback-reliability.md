---
name: ML inference fallback reliability (warmup exemption + timeout stacking)
description: Two subtle bugs in "disable heavy ML after N slow/failed samples" fallback logic that let failures silently never count, or let timed-out inferences pile up.
---

When building a "fall back to safe default after N consecutive slow/failed ML inferences" guard on a recurring sampling loop (e.g. `setInterval`-driven per-frame inference with a watchdog timeout):

1. **Bound the warm-up exemption to a fixed number of attempts, not to "has it ever succeeded."** If the exemption flag is only set on the *success* path (e.g. `warmedUp = true` after a successful run), and inference never succeeds, every subsequent attempt is still treated as an exempt warm-up forever — the failure counter never advances and the permanent-disable threshold is never reached. Use a monotonically incrementing attempt counter and exempt only the first attempt, regardless of outcome.

2. **A `Promise.race([work, timeout])` watchdog doesn't cancel `work`.** If the timeout branch wins, the underlying promise keeps running in the background. If the busy/lock flag is released as soon as the race settles, the next scheduled tick can start a second overlapping inference — on a device already too slow to finish one, this stacks concurrent GPU/CPU work and can cause exactly the freeze the fallback was meant to prevent. Fix: on timeout, count the failure immediately, then still `await` the original (now-stale) promise before releasing the busy flag — and use a generation/token counter to discard the stale result if it eventually resolves, rather than reusing it.

**Why:** both bugs pass a naive read-through and even a first-pass code review focused on "is there a fallback at all" — they only surface when reasoning about the *failure* path over multiple iterations, not the happy path.

**How to apply:** whenever adding a slow/error threshold + permanent-disable pattern around a `Promise.race` timeout, checklist: (a) attempt-based (not success-based) warm-up exemption, bounded to one attempt; (b) never release the "busy" lock until the raced-away promise actually settles; (c) discard stale results via a generation token.
