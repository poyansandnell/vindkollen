---
name: Chained permission requests silently lose user-gesture activation
description: Awaiting one browser permission prompt before requesting the next causes later prompts (geolocation, camera) to be silently denied with no dialog shown
---

When a single button click needs to request multiple browser permissions
(e.g. device-orientation/motion, geolocation, camera), do NOT request them
sequentially with `await` in between:

```js
// BAD: await breaks user-activation for what follows
await orientation.requestPermission();
setStarted(true); // triggers geolocation/camera via effect, later tick
```

**Why:** transient user-activation (the "this click is real user gesture"
flag) is short-lived and can be consumed/expired after the first `await` or
after control returns to the event loop. iOS Safari and several Android
browsers require getUserMedia/geolocation requests to happen within that
window; once it's gone, they silently deny the permission (error code
PERMISSION_DENIED / NotAllowedError) instead of ever showing the OS prompt.
This looks identical to "the user never saw the permission dialog" and is
easy to misdiagnose as an in-app-browser or OS-settings issue.

**How to apply:** in the synchronous click handler, fire off ALL
permission-triggering browser calls immediately and in parallel (e.g.
`navigator.geolocation.getCurrentPosition(...)`, a throwaway
`getUserMedia(...)` that stops its tracks right after) before awaiting
anything else (like iOS's `DeviceOrientationEvent.requestPermission()`).
Let state-driven hooks pick up the now-already-decided permission afterward
— their real subsequent calls will resolve instantly since the browser
already cached the grant/deny decision.
