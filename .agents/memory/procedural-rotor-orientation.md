---
name: Procedural rotor blade orientation
description: How to build and orient a procedural wind-turbine rotor so it spins visibly facing the viewer instead of edge-on
---

When building a fanned rotor (e.g. 3 blades arranged via `blade.rotation.z = i * 120°` around a hub, each blade extending outward from the origin along local +Y), the fan's visible face normal is the local **Z** axis, not the tilted axis you might assume.

Do not add an extra `rotor.rotation.x = Math.PI / 2` (or any additional tilt) "to make the rotor face the tower's front." That tilt rotates the whole fan so its normal points along Y (up) instead of Z, meaning a viewer looking down the local -Z axis sees the blades edge-on (thin slivers) instead of fanned out — this looks like "blades spinning on the wrong axis."

The correct approach: build the nacelle/hub/rotor assembly so its own "front" is the local -Z axis (matching `Object3D.lookAt`'s convention of pointing -Z at the target), position the hub/blades group slightly in -Z ahead of the nacelle with **no extra rotation**, and spin the blades group by incrementing its own `rotation.z` each frame. After the outer group is oriented via `lookAt(camera)`, the fan's normal (Z) automatically ends up facing the viewer.

**Why:** This bug is easy to introduce because "tilt the rotor to face forward" sounds intuitively correct, but the fan's own local-Z normal already IS the forward-facing axis — no tilt is needed, and adding one breaks it.

**How to apply:** Any time you build a fanned/pinwheel rotor (turbines, propellers, fans) via per-blade Z-rotation around a hub — verify the spin axis and viewer-facing axis are the same (Z) before adding "orientation" transforms on the parent group.
