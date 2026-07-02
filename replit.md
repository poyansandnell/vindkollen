# Vindkraft AR Katrineholm

A Swedish-language progressive web app that lets people in Katrineholm point their phone camera at the horizon and see, in augmented reality, the 29 wind turbines planned at Länsterberget — with live GPS/compass-based placement, distance labels, a map view, and a petition button tied to the town's real wind-power referendum debate.

## Run & Operate

- `pnpm --filter @workspace/vindkraft-ar-katrineholm run dev` — run the app (dev workflow: "artifacts/vindkraft-ar-katrineholm: web")
- `pnpm --filter @workspace/vindkraft-ar-katrineholm run typecheck` — typecheck this artifact
- `pnpm run typecheck` — full typecheck across all packages
- No database, no backend, no OpenAPI codegen — this artifact is fully client-side.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- React + Vite artifact (`artifacts/vindkraft-ar-katrineholm`)
- Three.js for the AR/3D rendering layer
- proj4 for SWEREF99 TM (EPSG:3006) → WGS84 coordinate conversion
- vite-plugin-pwa for installable PWA support (manifest + service worker)
- Native browser APIs: `getUserMedia` (camera), `navigator.geolocation` (GPS), `DeviceOrientationEvent` (compass)
- No backend/database for this artifact — signatures for the petition are stored in `localStorage`.

## Where things live

- `src/lib/turbines.ts` — the 29 turbine records (SWEREF99 TM easting/northing + height), grounded near the real Länsterberget wind farm site north of Katrineholm.
- `src/lib/sweref.ts` — proj4-based SWEREF99 TM ↔ WGS84 conversion.
- `src/lib/geo.ts` — haversine distance, bearing, angle normalization, night-time check, Swedish distance formatting.
- `src/hooks/useGeolocation.ts`, `useCompassHeading.ts`, `useCameraStream.ts`, `useWindSound.ts` — device sensor/media hooks.
- `src/components/ARScene.tsx` — the Three.js AR overlay (turbine meshes, name/distance labels, blinking red aviation light at night).
- `src/components/CameraBackground.tsx`, `MapView.tsx`, `PetitionModal.tsx`, `PermissionGate.tsx` — supporting UI.
- `src/pages/Home.tsx` — wires camera + AR + GPS + compass + permission gate + top/bottom UI chrome together.

## Architecture decisions

- Built as a plain React+Vite PWA (not Expo), per explicit user requirement — overrides the default mobile-artifact assumption.
- No backend: turbine data is static/client-side, and petition "signatures" are stored in `localStorage` only (no server persistence).
- AR is done without WebXR — turbines are positioned in a Three.js scene using bearing/distance relative to the user's GPS position and compass heading, for broad mobile browser compatibility.
- The 29 turbines are fictional but grounded in the real Länsterberget wind farm project (OX2) north of Katrineholm and the real 2022 local referendum on wind power.

## Product

- Camera-based AR view showing 29 wind turbines at true bearing/distance from the user, each labeled with name + distance.
- Blinking red aviation obstruction lights on turbines at night (22:00–06:00).
- Optional procedurally generated wind sound (Web Audio, no audio files).
- Map view (SVG-based) showing all turbines and the user's position.
- "Skriv under för folkomröstning" petition button/modal referencing the real 2022 Katrineholm wind-power referendum.
- Fully Swedish-language UI; installable as a PWA.

## User preferences

_None recorded yet._

## Gotchas

- iOS Safari requires a user-gesture-triggered `DeviceOrientationEvent.requestPermission()` call before compass data is available — handled in `useCompassHeading.ts`, triggered from the "Starta AR-vyn" button.
- Camera/GPS/compass are unavailable or limited in desktop/headless test browsers — the app's top/bottom UI chrome and map/petition overlays are intentionally still usable even if AR itself can't fully initialize.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
