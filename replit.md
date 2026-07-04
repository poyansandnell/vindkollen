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

High-level map of source files. Full per-file implementation notes (smoothing algorithms, exact thresholds, watchdog timings, prop contracts, etc.) live in `artifacts/vindkraft-ar-katrineholm/docs/file-map.md` — read that file before touching any of the logic below, since the nuance is usually load-bearing.

- `src/lib/` — `turbines.ts` (29 turbine records), `sweref.ts` (SWEREF99↔WGS84), `geo.ts` (distance/bearing/formatting), `soundLevel.ts` (dBA estimation), `noiseImpact.ts` (infrasound impact score + disclaimer), `visualizationTypes.ts`, `ericsbergArea.ts` (boundary + household data + boundary-override system), `placementScoring.ts` (placement impact scoring), `webMercatorTiles.ts` (shared map tile/projection math).
- `src/hooks/` — sensor hooks (`useGeolocation`, `useCompassHeading`, `useCameraStream`, `useDeviceOrientation` — adaptive compass smoothing + calibration state machine, `useSkyDetection` — canvas-2D sky/occlusion heuristic, `useSmoothedGeoPosition`, `useStableGeoPosition`, `useArTrackingStability` — GPS/compass tracking-quality fusion, `useOutdoorConfidenceIndex`, `useSmoothedDba`, `useWindSound`, `useWindDirection`).
- `src/components/` — `ARScene.tsx` (Three.js overlay + real-trig grounding), `CameraBackground.tsx`, `MapView.tsx`, `PetitionModal.tsx`, `PermissionGate.tsx`, `LineOfSightStatus.tsx`, `NearestTurbineArrow.tsx` (fades to a "Du tittar mot närmaste verk" confirmation instead of just disappearing), `VisualizationControls.tsx`, `SoundLevelPanel.tsx`, `PhotoMontageModal.tsx`, `NoiseImpactMonitor.tsx`, `SensorDebugPanel.tsx`, `LoadingSequence.tsx` (branded 3-phase startup sequence), `PlacementMap.tsx` (pannable/zoomable kartverktyg map with tap-to-move and a live boundary editor).
- `src/pages/` — `Home.tsx` (wires everything together; "render first, refine continuously" — the AR scene mounts and builds all 3D objects the instant the user taps start, renders as soon as GPS+camera exist using the first-available/last-known compass heading, and refines continuously as sensors settle, never waiting for or requiring full compass calibration), `PlaceTurbines.tsx` (route `/placera`, the permission-free "Placera vindkraftverken själv" tool).

## Architecture decisions

- Built as a plain React+Vite PWA (not Expo), per explicit user requirement — overrides the default mobile-artifact assumption.
- No backend: turbine data is static/client-side, and petition "signatures" are stored in `localStorage` only (no server persistence).
- AR is done without WebXR — turbines are positioned in a Three.js scene using bearing/distance relative to the user's GPS position and compass heading, for broad mobile browser compatibility.
- The 29 turbines are fictional but grounded in the real Länsterberget wind farm project (OX2) north of Katrineholm and the real 2022 local referendum on wind power.

## Product

Full behavioral detail (exact gating thresholds, disclaimer wording, timing constants) lives in `artifacts/vindkraft-ar-katrineholm/docs/product-details.md`.

- Camera-based AR view: 29 labeled turbines at true bearing/distance, night aviation lights, procedural wind sound (always via main speaker) with a live "🔊 Beräknad ljudnivå" dBA panel and an explicit ute/inne sound toggle, "🌗 Skuggflimmer" shadow-flicker mode, "📸 Fotomontage" capture, "🌬️ Infraljud" noise-impact monitor, and a "Skriv under för folkomröstning" petition modal.
- Turbine visibility is gated by an Outdoor Confidence Index + camera-based sky coverage (show/aim/hide tiers), with per-pixel occlusion (behind trees/buildings) and a full indoor/no-line-of-sight overlay as a backstop — sound/dBA/distance keep working from GPS alone even when the AR view is hidden.
- `NearestTurbineArrow` always points to the closest turbine by GPS bearing; it hides (fading into a green confirmation) once that turbine is on-screen and the user isn't indoors.
- "🗺️ Placera vindkraftverken själv" (`/placera`): a permission-free pannable/zoomable satellite kartverktyg where the user can add/move/remove turbines, see a live impact score, edit the placement-area boundary, save/compare placements, and send a placement to the AR view.
- AR placement stabilization ("prioritize stability over precision"): GPS + compass tracking quality fuse into a tier that freezes the smoothed position on degradation, shows a weak-signal banner, and only fades turbines after several seconds of sustained lost tracking — never abruptly. A hidden `SensorDebugPanel` exposes live sensor/tracking diagnostics.
- Fully Swedish-language UI; installable as a PWA.

## User preferences

_None recorded yet._

## Gotchas

Full detail (exact root causes, thresholds, fixes) lives in `artifacts/vindkraft-ar-katrineholm/docs/gotchas.md`.

- iOS Safari compass permission needs a user-gesture-triggered `requestPermission()` call.
- Camera/GPS/compass are limited in desktop/headless test browsers — expected, not a bug.
- `getUserMedia()`/GPS can hang forever on real devices — both have watchdog timers + manual retry buttons.
- The kartverktyg map reuses the existing Esri World Imagery basemap (no Mapbox GL, no `MAPBOX_TOKEN` use).
- `PlacementMap.tsx`'s wheel zoom needs a native non-passive `wheel` listener, not React's `onWheel`.
- `useSkyDetection.ts`'s classification thresholds are coupled to its grid resolution — retune both together.
- GeoJSON export opens a `Blob` URL in a new tab rather than `<a download>` (which silently no-ops on iOS PWA).
- `scorePlacement()` reads the boundary via a module-level getter, not a parameter — bump an explicit version counter to force recompute after edits.
- The indoor overlay is `z-40`; `NearestTurbineArrow` must stay above it at `z-50`.

## Wind data sync (api-server + lib/wind-sync)

Beyond this AR artifact, the monorepo also has an `api-server` artifact and a `lib/wind-sync` package that ingest Vindbrukskollen (Swedish wind power register) data into Postgres for the `vindkraft-karta` map artifact. Full detail in `artifacts/vindkraft-ar-katrineholm/docs/wind-data-sync.md`.

- `lib/wind-sync` exports `runWindSync()`, used by both a manual CLI script (`pnpm --filter @workspace/scripts run sync:wind`) and `artifacts/api-server`'s in-process scheduler (`WIND_SYNC_INTERVAL_HOURS`, default 24; `GET /api/wind/sync-status`).
- Upsert-based on stable external IDs, so re-running is always safe.
- The scheduler only runs while the api-server process is alive — pair with a Replit Scheduled Deployment if that artifact ever moves to autoscale.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
- Detailed reference docs for this artifact: `artifacts/vindkraft-ar-katrineholm/docs/file-map.md`, `docs/product-details.md`, `docs/gotchas.md`, `docs/wind-data-sync.md`.
