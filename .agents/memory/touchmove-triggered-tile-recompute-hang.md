---
name: Unthrottled touchmove/pointermove state updates hang a tiled map
description: Calling setState directly from every raw touchmove/pointermove event (pinch-zoom or pan) on a custom tiled map re-triggers expensive tile-layout recomputation and image src churn far faster than the screen can render, feeling like a hang/freeze.
---

A custom (non-Mapbox) tiled map component that recomputes `bounds`/`project`/tile list from a `view` state on every render can appear to "hang" during two-finger pinch-zoom or fast panning — not because of a logic bug in the pinch math, but because raw `touchmove`/`pointermove` events can fire many times per animation frame on real devices, and each one triggers a full `setState` → re-render → tile-layout recompute → up to N `<img src>` swaps.

**Why:** the fix isn't in the pinch-distance/scale math itself; it's that nothing coalesces multiple events into one update per frame, so the browser does far more work than the display can show.

**How to apply:** when a pinch-zoom or drag-pan feels like it hangs/freezes rather than just being imprecise, throttle the `setState` calls driving the map's view to once per `requestAnimationFrame` — store only the latest pending updater in a ref and flush it in a single rAF callback, canceling/rescheduling as needed. This keeps the gesture feeling responsive (last position always wins) while capping recomputation to the display refresh rate instead of the raw event rate.
