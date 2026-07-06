---
name: Render-loop watchdog blind to a never-started loop
description: A "watchdog detects stalled rAF loop" pattern is useless if its liveness timestamp starts as null and the watchdog early-returns on null.
---

Pattern: an independent `setInterval` watchdog checks `Date.now() - lastFrameAtRef.current > threshold` to detect a stalled `requestAnimationFrame` loop, and restarts it. If `lastFrameAtRef` is initialized to `null` and the watchdog does `if (lastAt === null) return;`, then a loop that never fires its *first* callback (browser tab backgrounded at mount, GPU driver hiccup, etc.) is invisible to the watchdog forever — nothing ever sets a non-null timestamp for it to compare against.

Symptom this causes in the wild: a page that appears frozen from the very start but "wakes up" the moment something incidentally forces a browser repaint/composite (e.g. taking a screenshot, switching tabs back) — because that side effect is what finally triggers the first rAF callback, not the watchdog.

**Why:** A watchdog's job is to detect "no progress since we started expecting it" — but if progress hasn't started, the null-guard silently opts that case out of the exact check meant to catch it.

**How to apply:** Set the liveness timestamp once, synchronously, immediately before the *first* scheduling call (e.g. right before the first `requestAnimationFrame(loop)`), not only from inside the loop body itself. Then the watchdog always has a concrete baseline to compare against, even if the very first callback never arrives. Pair with explicit start/first-tick log lines (e.g. `startLoop()` vs `first tick ran`) so a future report can tell which side of the gap failed.
