---
name: Accumulated angle rotation vs clamped cone/toggled anchor
description: How to make a directional indicator rotate continuously and smoothly through 360°, instead of clamping to a cone or toggling between fixed CSS positions.
---

A "point toward X" UI arrow can look "stuck" even when its underlying sensor
math (bearing/heading diff) is fully correct, if the *rendering* layer does
either of these:

1. Toggles between two fixed anchor positions (e.g. `right-3` vs `left-3`)
   instead of rotating freely around one fixed point — causes a visual jump
   across the screen instead of a sweep.
2. Clamps the icon's own rotation to a cone (e.g. ±80°) instead of showing
   the full signed diff angle — makes the arrow feel like it "stops
   following" past that threshold.

**Why:** both bugs were previously mistaken for a sensor/plumbing problem
(GPS or compass), when the actual sensor diff (`bearing - heading`) was
correct the whole time. The bug was purely in how that diff got mapped to a
CSS transform.

**How to apply:** use one fixed anchor point, and rotate the icon by the
*full* diff angle every frame (`requestAnimationFrame`, not a coarse
`setInterval`). Never set `rotate()` directly to a value re-wrapped into
[-180, 180] each tick — that causes a CSS "long way around" jump at the
wraparound. Instead keep an accumulated/unwrapped rotation ref: each tick,
compute the shortest-path delta between the new target diff and the
*normalized* current accumulated angle, then add that (small) delta onto the
accumulated (unbounded) value. This keeps the transform monotonic and lets
the browser interpolate the shortest visual path, even as the underlying
diff wraps past ±180° repeatedly.
