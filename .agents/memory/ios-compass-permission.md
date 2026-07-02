---
name: iOS compass permission timing
description: DeviceOrientationEvent.requestPermission() must run inside the direct user-gesture call stack
---

On iOS Safari, `DeviceOrientationEvent.requestPermission()` is a permission API gated by the "user activation" rule: it only succeeds when called synchronously (or within a microtask chain that iOS still treats as part of the same gesture) from a click/tap handler.

**Why:** If you `await` something else (e.g. an unrelated async setup step, or a different permission request) before calling `requestPermission()`, iOS may silently treat the gesture as expired and the permission prompt won't appear, or it auto-denies.

**How to apply:** Call `DeviceOrientationEvent.requestPermission()` as the first async operation inside the button's `onClick` handler, before any other awaited work (e.g. before requesting camera/GPS). Structure onboarding flows so the compass permission request fires immediately on tap.
