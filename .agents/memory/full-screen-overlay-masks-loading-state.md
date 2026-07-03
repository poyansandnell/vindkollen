---
name: Full-screen conditional overlay can mask an unrelated loading/error state
description: A secondary environment-quality overlay that renders independent of a primary readiness flag can visually hide the primary feature's loading spinner/error UI, making users misreport the wrong bug.
---

A "environment confidence" overlay (unrelated to GPS/sensors themselves) rendered
with `{condition && <FullScreenOverlay/>}` where `condition` was intentionally
independent of the app's main `ready` flag. Once a secondary ML signal (here: a
camera-based sky/indoor classifier) reached its "hide" verdict — which could
happen within a few seconds of app start, before GPS/compass ever got a fix —
the overlay (`z-40`, `bg-black/85`, covering the full screen) rendered on top
of the GPS loading spinner and any GPS error message.

**Why:** The user reported "GPS doesn't work, spins forever, then everything
shuts off after ~5 sec" — but GPS itself was working fine in the background.
The real bug was a second, independently-gated full-screen overlay obscuring
the GPS UI entirely, making a totally unrelated subsystem look like the
culprit. The overlay's own doc comment even said "shows independent of
`ready`" as an intentional past decision, but that decision silently created
this failure mode once a fast-triggering secondary heuristic was added later.

**How to apply:** When a full-screen/high-z-index conditional overlay can
activate before a feature's primary "ready" state, gate it behind that ready
flag (or otherwise guarantee mutual exclusion) so loading/error UI for the
primary feature is never invisibly masked. When a user describes a symptom
that doesn't match the primary feature's actual code path, check for other UI
elements that might visually cover the real (working or failing) state.
