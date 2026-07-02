---
name: iOS Safari audio speaker routing
description: How to force Web Audio API output through the main speaker (never earpiece) on iOS Safari
---

On iOS Safari, Web Audio API graphs connected via `AudioContext.destination` can be silently routed to the earpiece speaker instead of the main/loud speaker, especially for low-volume or ambient/procedural sound sources — the OS heuristic sometimes treats them as "call-like" audio.

The reliable fix: route the graph through a `MediaStreamAudioDestinationNode` instead of `audioContext.destination`, then play that MediaStream through a hidden `<audio>` element in the DOM (not an `<audio>` node driven purely by AudioContext). Playing back via an actual `<audio>` element forces iOS to treat it as regular media playback, which always uses the main speaker.

**Why:** discovered while implementing a "always loud, main-speaker" requirement for ambient wind sound in a PWA — direct `AudioContext.destination` output was routing to the earpiece on iOS despite correct gain staging.

**How to apply:** when a spec requires guaranteed main-speaker output for Web Audio content on iOS Safari (not to be confused with call/voice audio), wire the graph to `createMediaStreamDestination()` and feed its `.stream` into a hidden `<audio autoplay>` element rather than connecting directly to `audioContext.destination`.
