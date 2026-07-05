---
name: DOM-measurement effect must depend on the exact mount-gating flag
description: A useEffect that measures a ref'd DOM element (ResizeObserver, getBoundingClientRect) silently locks in a wrong value forever if its dependency array doesn't match the flag controlling that element's conditional render.
---

Pattern: `useEffect` reads `someRef.current`, sets up a `ResizeObserver` on it, and falls back to a default (often `0`) if the ref isn't populated yet. This is correct only if the effect re-runs at the moment the ref's element actually mounts.

**Why:** If the effect's dependency array uses an earlier flag in the same loading sequence (e.g. "user tapped start") instead of the actual flag gating the ref'd element's conditional render (e.g. "fully ready" — GPS+camera+sensors), the effect fires too early. It finds `ref.current === null`, sets the fallback, and returns — and since the dependency never changes again, it never re-runs. The element mounts later, but nothing re-triggers the measurement. The fallback value silently becomes permanent, even though the real element is on screen the whole time.

**How to apply:** When measuring a conditionally-rendered ref'd element, make the effect depend on exactly the same boolean/condition that gates that element's JSX (not an earlier proxy in the same sequence). Symptom to watch for: a persistent "the browser measures element X as height/size 0" bug where visually the element clearly overlaps or has zero offset, despite an apparently-correct ResizeObserver setup.
