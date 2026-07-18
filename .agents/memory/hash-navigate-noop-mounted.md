---
name: Hash-navigate no-op kills mounted-component transitions
description: On iOS native (Capacitor hash-routing), setting window.location.hash to a value already set fires no hashchange and the component does not remount. setState inside the mounted component can also be unreliable in WKWebView.
---

## Rule
Never rely on `window.location.hash = "/same-path"` to trigger a remount of a component that is already mounted at that path. It is a browser no-op — no `hashchange` fires, no Wouter re-render, no fresh `useState` initializers.

**Why:** The trigger for this was the "Öppna projektet" button in NationalMapView. `openSverigekartan()` navigated to `#/placera`, mounting PlaceTurbines. The button called `setShowWelcome(false)` to switch to editor mode — unreliable in WKWebView AND any attempt to re-navigate to `#/placera` was a no-op.

## How to apply
When a component at path X needs to transition to a different mode/state:

**Option A (preferred — guaranteed fresh mount):**
1. Write data to `localStorage` (e.g. `EDIT_HANDOFF_KEY`)
2. Set a `sessionStorage` flag (e.g. `"vindkollen:placeraEditorDirect"`)
3. **Bounce**: `window.location.hash = "/"` then `setTimeout(() => { window.location.hash = "/placera"; }, 80)`
   - The bounce forces a real `hashchange` event both ways
   - PlaceTurbines unmounts at `/` and remounts fresh at `/placera`
   - `consumeEditHandoff()` and `consumeDirectEditorFlag()` run in fresh `useState` initializers

**Option B (web-only — state update):**
- `setShowWelcome(false)` + other React `setState` calls work reliably on web with path-routing
- Do NOT use on native hash-routing for the same-hash case

## Key files
- `artifacts/vindkraft-ar-katrineholm/src/pages/PlaceTurbines.tsx` — `onEnterEditor` callback (native vs web branches)
- `artifacts/vindkraft-ar-katrineholm/src/lib/capacitorBridge.ts` — `openSverigekartan()`, `consumeEditHandoff`, `consumeDirectEditorFlag`
