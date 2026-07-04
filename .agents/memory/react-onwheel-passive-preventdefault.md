---
name: React onWheel passive listener preventDefault no-op
description: React's synthetic onWheel handler is passive by default, so preventDefault() inside it only warns and doesn't block scroll/zoom.
---

Calling `e.preventDefault()` inside a React `onWheel={...}` handler does not actually
prevent the browser's default scroll/zoom behavior — React attaches wheel listeners as
passive by default, so the call only produces a console warning ("Unable to
preventDefault inside passive event listener invocation") and has no effect.

**Why:** discovered while building wheel-to-zoom on a custom pan/zoom map component —
zoom worked visually (state updated) but the warning fired on every scroll, and the
underlying page could still scroll/bounce during the gesture.

**How to apply:** for any custom scroll-hijacking / wheel-to-zoom / wheel-to-pan
interaction, skip React's `onWheel` prop and instead attach a native `wheel` listener
via `useEffect` with `{ passive: false }` on the target element/ref, calling
`preventDefault()` from that native listener instead.
