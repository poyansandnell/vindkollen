---
name: Duplicate concurrent geolocation requests contend for GPS chip
description: A throwaway getCurrentPosition() fired to preserve a user gesture can starve a real concurrent watchPosition() call if both request high accuracy.
---

When a "fire-and-forget" `getCurrentPosition()` call is used purely to trigger the browser's permission dialog synchronously within a user gesture (so a later `watchPosition()` isn't silently denied for missing the gesture window), it must not also request high accuracy.

**Why:** Two concurrent `enableHighAccuracy: true` geolocation requests compete for the same GPS hardware on many Android devices, which can meaningfully delay or effectively stall the real `watchPosition()` fix — presenting to the user as "GPS hangs forever," even though the code path and watchdog timers are otherwise correct.

**How to apply:** Any throwaway/gesture-preserving geolocation call whose result is discarded should use `enableHighAccuracy: false` (network/Wi-Fi based, doesn't touch the GPS chip) and a large `maximumAge`, leaving the GPS chip free for the one real high-accuracy watch. Also prefer running proactive `navigator.permissions.query({name:"geolocation"})` checks unconditionally (not gated behind an "enabled/started" flag) so permission-denied state can be surfaced before the user even taps a start button, and add a lightweight on-screen elapsed-time + permission-state readout during any long GPS wait — this makes future "it just hangs" reports diagnosable without needing device console access.
