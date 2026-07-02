---
name: AR without WebXR
description: Positioning 3D objects relative to a phone camera using GPS + compass instead of WebXR, for broad browser support
---

Marker-less AR (real-world objects overlaid on a live camera feed) can be done without WebXR by:

1. Rendering the camera stream (`getUserMedia`) as a plain `<video>` background.
2. Rendering a transparent Three.js canvas on top with a perspective camera at the origin.
3. Placing each real-world point of interest at a **fixed absolute world position** computed once from bearing (from true north) + distance off the user's GPS position (haversine/bearing formulas): `x = sin(bearingRad) * dist, z = -cos(bearingRad) * dist`. Only recompute this when GPS actually moves, not every frame.
4. Rotating the **camera itself** every frame to match the phone's full physical orientation (yaw + pitch + roll), instead of moving objects to a "relative angle". See device-orientation-camera-quaternion.md for how to build that rotation correctly.

**Why:** WebXR device/session support is inconsistent across mobile browsers (especially iOS Safari), while `getUserMedia` + `DeviceOrientationEvent` + `Geolocation` work broadly. This tradeoff sacrifices some AR realism (no depth occlusion, no SLAM) for compatibility.

**How to apply:** Use this approach whenever the AR requirement is "show labeled real-world points of interest in the camera view" rather than "let the user place/manipulate 3D objects in physical space" — the former doesn't need true 6DOF tracking. Do NOT reposition objects using only yaw/heading each frame (see device-orientation-camera-quaternion.md) — that ignores pitch/roll and makes objects feel stuck to the screen instead of anchored to the horizon.
