---
name: Mount-time-gated interval never (re)starts
description: An effect with empty deps that early-returns based on data only available at mount time can permanently disable a recurring interval/timer.
---

An effect with an empty dependency array (`[]`, "run once on mount") that early-returns based on a check against data which is only correct *after* some async event (e.g. a GPS fix, a network response) will almost always take the early-return branch, because that data usually isn't ready yet at the exact moment of mount. Since the effect never re-runs, the thing it was supposed to set up (an interval, a subscription, a timer) never starts at all — even after the awaited data arrives and later effects/derived state start updating correctly in the background.

**Why:** This bug is easy to miss because everything *upstream* looks like it's working (the raw data source updates fine, unit-testing the update path in isolation looks fine) — only the down-stream consumer that depends on the never-started interval stays frozen forever. It looks identical to "the raw data is stuck" (e.g. "GPS never resolves") even though the raw data is fine; only a derived/smoothed display value is stuck.

**How to apply:** Don't gate a `[]`-deps setup effect on the current value of props/data — either (a) start the interval/subscription unconditionally regardless of current data state, and let the per-tick logic itself decide whether there's anything to do, or (b) put the real dependency in the effect's dependency array so it can restart once the data becomes available. When debugging a "value stuck on its initial/loading state forever" symptom, check for exactly this pattern before assuming the upstream data source itself is broken.
