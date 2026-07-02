---
name: AR without WebXR
description: Positioning 3D objects relative to a phone camera using GPS + compass instead of WebXR, for broad browser support
---

Marker-less AR (real-world objects overlaid on a live camera feed) can be done without WebXR by:

1. Rendering the camera stream (`getUserMedia`) as a plain `<video>` background.
2. Rendering a transparent Three.js canvas on top with a perspective camera fixed at the origin.
3. For each real-world point of interest, computing bearing + distance from the user's GPS position (haversine/bearing formulas), then subtracting the device's compass heading to get an angle relative to what the camera is currently pointing at.
4. Mapping that relative angle to an x/z position around the Three.js camera (e.g. `x = sin(angle) * dist, z = -cos(angle) * dist`), and hiding objects outside the camera's field of view.

**Why:** WebXR device/session support is inconsistent across mobile browsers (especially iOS Safari), while `getUserMedia` + `DeviceOrientationEvent` + `Geolocation` work broadly. This tradeoff sacrifices some AR realism (no depth occlusion, no SLAM) for compatibility.

**How to apply:** Use this approach whenever the AR requirement is "show labeled real-world points of interest in the camera view" rather than "let the user place/manipulate 3D objects in physical space" — the former doesn't need true 6DOF tracking.
