---
name: Sensor/permission watchdog timeout pattern
description: Any browser API that returns a promise/callback for device access (camera, GPS, etc.) can hang forever on real devices with neither success nor error firing — always pair it with an independent watchdog timer.
---

Browser device-access APIs (`getUserMedia`, `geolocation.watchPosition`, etc.) are documented as always eventually resolving or rejecting, but on real devices (seen on both GPS and camera in this project) they sometimes do neither — no success callback, no error, no rejection — leaving the UI in a permanent "loading" state with no way for the user to recover.

**Why:** Users hit this in the wild as "the app just spins forever" with no error and no retry option. The browser's own `timeout` option (e.g. on `getCurrentPosition`) is not reliable across platforms/browsers for this.

**How to apply:** For every such API call, start an independent `setTimeout` watchdog (15-20s) alongside the call. If the real callback/promise hasn't settled by then, force the hook's state into an explicit error with a user-facing message and expose a `retry()` function (bump a retry-token state to re-run the effect). Clear the watchdog as soon as the real result arrives. Surface `error` + a "Försök igen" button in the UI wherever the corresponding "waiting" overlay is shown.
