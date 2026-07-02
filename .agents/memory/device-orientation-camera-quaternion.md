---
name: Device orientation → camera quaternion for marker-less AR
description: How to rotate a Three.js camera to match a phone's full physical orientation (yaw+pitch+roll) so AR overlays feel anchored to the real world, not the screen
---

If AR objects are positioned using only compass heading (yaw) each frame — e.g. `angle = bearing - heading`, then placed at a fixed screen-relative x/z with a constant y — tilting the phone up/down (pitch) or sideways (roll) does nothing to their apparent position. The result: overlays feel "stuck to the screen" instead of anchored to the horizon, because the camera itself never rotates.

The fix: keep AR objects at fixed absolute world positions (see ar-without-webxr.md), and instead rotate the **camera** every frame using the device's full orientation sensors (`alpha`/`beta`/`gamma` from `deviceorientation`), via the same transform three.js's (deprecated) `DeviceOrientationControls` used:

```js
euler.set(betaRad, alphaRad, -gammaRad, "YXZ");
quaternion.setFromEuler(euler);
quaternion.multiply(new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5))); // -90° around X
quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1), -screenAngleRad));
```

Key details:
- `alpha` from the raw device event is not reliably referenced to true north (especially on iOS, which instead exposes `event.webkitCompassHeading`). Compute a trusted compass heading first (existing smoothing/platform-branch logic), then convert back to an "alpha" for the formula via `alphaForQuaternion = (360 - heading) % 360`. Feed the device's raw `beta`/`gamma` directly for pitch/roll — those don't need a compass reference.
- Include the screen orientation angle (`screen.orientation.angle`) in the transform, or portrait/landscape rotation will roll incorrectly.
- Update the camera's quaternion via a ref/mutable object each sensor event or frame — do not push this through React state every event (sensors fire ~60Hz); that causes excessive re-renders for no benefit since Three.js reads the ref directly in its own render loop.
- A "calibrate horizon" affordance (user holds phone level, taps a button) is just recording the current raw `beta` as a bias offset, then always subtracting that offset from future `beta` readings — compensates for per-device sensor bias without needing full sensor fusion.

**Why:** This is the standard, correct way to do marker-less orientation-based AR without WebXR, and it's easy to accidentally build the "yaw-only" version first since it looks correct until you actually tilt the device.

**How to apply:** Any time overlays need to feel anchored to the real world during camera tilt/roll, not just pan (yaw).
