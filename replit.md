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
- `src/hooks/useDeviceOrientation.ts` — time-based EMA compass/tilt smoothing. Listens to both `deviceorientationabsolute` and plain `deviceorientation` (needed since iOS never fires the former), but once any absolute-referenced reading arrives (event type `deviceorientationabsolute`, `event.absolute === true`, or iOS's `webkitCompassHeading`) it latches on and ignores further non-absolute `deviceorientation` events — otherwise two conflicting heading sources (some browsers' plain `deviceorientation.alpha` isn't reliably north-referenced) feed the same smoother and cause large, unattenuated bearing swings (heading error maps directly to on-screen angle, unlike GPS position error which is angularly damped by distance to the turbines).
- `src/hooks/useSkyDetection.ts` — lightweight canvas-2D (no WebGL/ML) brightness/texture/saturation heuristic on a 12x8 grid of the camera frame; drives both `outdoorConfidence`/`indoors` and (via `isPointSky`/`getOcclusionGrid`) the real per-pixel sky/occlusion mask consumed by `ARScene.tsx`'s shader. `method` is permanently `"disabled"` — the previous heavier ML segmentation model was removed for causing real-device freezes (see Gotchas) and is not reintroduced by this heuristic.
- `src/components/ARScene.tsx` — the Three.js AR overlay (turbine meshes, name/distance labels, blinking red aviation light at night, sun-synced lighting, Skuggflimmer blade-shadow flicker, exposes its canvas via `canvasRef` for Fotomontage capture).
- `src/components/CameraBackground.tsx`, `MapView.tsx`, `PetitionModal.tsx`, `PermissionGate.tsx` — supporting UI. `CameraBackground` accepts an optional `videoRef` to expose its `<video>` element for Fotomontage capture.
- `src/components/VisualizationControls.tsx` — sun/scale/visibility/night mode toggles, plus the Skuggflimmer toggle + info tooltip.
- `src/components/SoundLevelPanel.tsx` — live "🔊 Beräknad ljudnivå" dBA estimate panel (`SoundLevelBadge` shows "Väntar på GPS…" fallback until a position fix exists).
- `src/components/PhotoMontageModal.tsx` — Fotomontage capture preview with Spara/Ta ny bild/Dela (Web Share API) actions.
- `src/lib/soundLevel.ts` — dBA estimation from GPS distance to every turbine, logarithmic combination, severity color coding, exact disclaimer text.
- `src/lib/visualizationTypes.ts` — shared visualization mode types, incl. `shadowFlickerActive()` gating (only active in "current"/"low" sun modes).
- `src/lib/noiseImpact.ts` — weighted green/yellow/red "infraljud-/bullerpåverkan" score combining dBA level, contributing-turbine count, downwind wind direction (if available), and exposure duration; owns the exact Swedish disclaimer text (`NOISE_IMPACT_DISCLAIMER`) — do not reword it, must keep "kan bidra till"/"kan upplevas"/"för känsliga personer" phrasing and avoid absolute claims.
- `src/hooks/useWindDirection.ts` — fetches current wind direction/speed for the user's GPS position from the free Open-Meteo API (no key required); fails silently to `null` on network errors so the noise monitor just ignores the wind factor.
- `src/components/NoiseImpactMonitor.tsx` — `NoiseImpactBadge` (always-visible top-bar status) + `NoiseImpactPanel` (expandable detail panel with reasons + disclaimer), mirrors the `SoundLevelPanel.tsx` pattern. Both `SoundLevelPanel` and `NoiseImpactPanel` default to a compact view (headline number/level + independent "Visa mer" toggle) and only render distance/count/disclaimer detail when expanded.
- `src/hooks/useOutdoorConfidenceIndex.ts` — weighted "Outdoor Confidence Index" (0-100%: camera/AI sky-detection 45%, GPS accuracy 20%, ambient light 15%, compass stability 10%, motion/gyro 5%, WiFi/indoor signal 5%) with four tiers (`show` ≥90, `cautious` ≥70, `aim` ≥40, `hide` <40) driving turbine visibility gating in `Home.tsx`/`ARScene.tsx`.
- `src/hooks/useStableGeoPosition.ts` — freezes the lat/lon fed into the dBA calculation until the user moves ≥15m, so ordinary GPS jitter doesn't recompute sound level.
- `src/hooks/useSmoothedGeoPosition.ts` — continuous time-based EMA low-pass filter (~2.5s base time constant, same pattern as `useDeviceOrientation.ts`'s compass smoothing) on raw `lat`/`lon`, feeding `ARScene`'s turbine placement (`userLat`/`userLon` in `Home.tsx`). The effective time constant scales up further when `geo.accuracy` is poor, and single implausible GPS "spike" readings (would imply a faster-than-walking jump) are rejected outright rather than blended in. Distinct from `useStableGeoPosition`: it smooths continuously rather than freezing in 15m jumps, so turbines still track real walking movement smoothly but no longer visibly "fladdrar" (flicker/jitter) from ordinary meter-scale consumer GPS noise, which previously fed straight into `ARScene.tsx`'s `layoutObjects()` on every >~11cm raw position change. Note: at the app's real-world viewing distances (turbines are several km from Katrineholm town), GPS noise alone produces well under 1° of bearing error — see `useDeviceOrientation.ts` below for the dominant, higher-impact jitter source that was fixed alongside this.
- `src/hooks/useSmoothedDba.ts` — 7s rolling average of the raw dBA estimate, throttled to at most one visible update per second; both `SoundLevelPanel`/`NoiseImpactMonitor` display and the wind sound's `dbaToGain` volume consume this same smoothed value so they always agree.
- `src/pages/Home.tsx` — wires camera + AR + GPS + compass + permission gate + top/bottom UI chrome + dBA panel + noise impact monitor (incl. exposure-duration timer) + Fotomontage capture + Outdoor Confidence Index gating together. Also reads a custom turbine placement (if any) via `AR_HANDOFF_KEY`/`loadCustomPlacement()` and swaps it in for the default 29-turbine set as `activeTurbines`, with a bottom-bar link to `/placera` and a button to clear the custom placement.
- `src/lib/ericsbergArea.ts` — Ericsberg estate boundary polygon, household clusters, sensitive/positive zones, and the "Placera vindkraftverken själv" disclaimer text.
- `src/lib/placementScoring.ts` — `scorePlacement()`: weighted 0–100 impact score (distance to households, sensitive-zone proximity, spacing, etc.) plus playful Swedish warnings for the placement game.
- `src/lib/webMercatorTiles.ts` — shared Web Mercator tile/projection math (Esri World Imagery tiles, `computeTileLayout`, `fitBoundsToAspect`, `makeProjector`); used by both `MapView.tsx` and `PlacementMap.tsx` so the two maps stay visually consistent.
- `src/components/PlacementMap.tsx` — SVG drag-and-drop map for the 8 user-placeable turbines on Ericsberg's land.
- `src/pages/PlaceTurbines.tsx` (route `/placera`) — "Placera vindkraftverken själv" game: drag the 8 turbines, live score/warnings panel, save/compare placements (`localStorage` keys `vindkraft-ar-katrineholm:savedPlacements` and `vindkraft-ar-katrineholm:customPlacement`), and a "Se denna placering i AR" handoff back to the main AR view.

## Architecture decisions

- Built as a plain React+Vite PWA (not Expo), per explicit user requirement — overrides the default mobile-artifact assumption.
- No backend: turbine data is static/client-side, and petition "signatures" are stored in `localStorage` only (no server persistence).
- AR is done without WebXR — turbines are positioned in a Three.js scene using bearing/distance relative to the user's GPS position and compass heading, for broad mobile browser compatibility.
- The 29 turbines are fictional but grounded in the real Länsterberget wind farm project (OX2) north of Katrineholm and the real 2022 local referendum on wind power.

## Product

- Camera-based AR view showing 29 wind turbines at true bearing/distance from the user, each labeled with name + distance.
- Blinking red aviation obstruction lights on turbines at night (22:00–06:00).
- Optional procedurally generated wind sound (Web Audio, no audio files), always routed through the device's main speaker (never the earpiece) even on iOS Safari.
- Live "🔊 Beräknad ljudnivå" dBA panel estimating sound exposure from turbine distance. The wind sound's actual playback volume scales continuously with this same dBA estimate (`soundLevel.ts`'s `dbaToGain`), instead of a plain on/off.
- Explicit always-visible "🔊 Ljud ute / 🔈 Ljud inne" toggle (top controls) that the user controls directly — always starts on "Ljud ute" at app launch. This toggle (not the camera-based sky heuristic) drives both the displayed dBA number (via `applyIndoorAttenuation`, a -35dB subtraction before the panel's own `dbaToGain`) and the actual wind sound gain — but the two use separate mechanisms by design: the panel number goes through `applyIndoorAttenuation` → `dbaToGain`, while the actual playback gain is computed as `applyIndoorGain(dbaToGain(smoothedOutdoorDba), indoor)`, i.e. `dbaToGain` on the *unattenuated* outdoor dBA, then a direct linear multiplier (`INDOOR_SOUND_GAIN_MULTIPLIER = 10**(-35/20)`) applied afterward. This avoids a bug where subtracting 35dB and re-running it through `dbaToGain`'s floor/ceiling clamp silently produced *zero* audible change whenever the outdoor level was already near the audibility floor (common at real Katrineholm-to-turbine GPS distances) — both "ute" and "inne" clamped to the same near-zero gain. The multiplier approach guarantees a consistent, always-perceptible ~35dB-equivalent drop regardless of the absolute outdoor level.
- "🌗 Skuggflimmer" (shadow flicker) mode simulating blade-shadow flicker, only active in "Aktuell sol"/"Låg sol" sun modes, with an info tooltip explaining the effect.
- "📸 Fotomontage": captures a composite photo (camera + AR overlay + watermark + disclaimer) with Spara/Ta ny bild/Dela (Web Share API) actions.
- "🌬️ Infraljud"-monitor: always-visible green/yellow/red badge + expandable panel estimating overall noise/infrasound impact (a distinct indicator from the dBA panel above) from distance, number of contributing turbines, wind direction (if available), and how long the user has been on-site, with a calm Swedish disclaimer emphasizing it is an estimated indicator, not a medical measurement (never claims guaranteed harm).
- Map view (SVG-based) showing all turbines and the user's position.
- "Skriv under för folkomröstning" petition button/modal referencing the real 2022 Katrineholm wind-power referendum.
- Turbines only render in the AR view when the weighted Outdoor Confidence Index (camera/AI sky detection, GPS accuracy, ambient light, compass stability, motion/gyro, WiFi/indoor signal) is in its "show" or "cautious" tier AND camera-based sky coverage is ≥15% of the frame; the "aim" tier (40-70%) shows a "Rikta kameran mot öppen himmel" banner instead of turbines, and the "hide" tier (<40%) or insufficient sky coverage shows the large, high-z-index "Gå utomhus" (go outside) message that always renders above all UI chrome (top/bottom bars, badges). This whole-screen OCI-based gate only ever applies while the (now-removed) ML sky-segmentation model would have been active (`useSkyDetection`'s `method === "ml"`, permanently `"disabled"`) — it never suppresses turbines or shows the "Gå utomhus"/aim banner on its own.
- Per-pixel occlusion (turbines hidden behind trees/buildings, not just a whole-turbine show/hide) is driven separately by `useSkyDetection`'s existing lightweight canvas-2D brightness/texture/saturation heuristic (the same one behind `outdoorConfidence`) — NOT by the old ML model. `isPointSky`/`getOcclusionGrid` now expose the real (EMA-smoothed) 12x8 sky/non-sky grid from that heuristic to `ARScene.tsx`'s existing per-fragment occlusion shader, so only the covered part of a turbine (e.g. below a treeline) is masked. This is coarser than the removed ML segmentation but uses no extra WebGL context and cannot reintroduce the freeze (see Gotchas).
- "🗺️ Placera vindkraftverken själv" (`/placera`): a drag-and-drop game letting the user reposition 8 turbines on Ericsberg's land, with a live 0–100 impact score (distance to households, sensitive zones, spacing), color-coded severity, playful Swedish warnings, save/compare of multiple placements, and a "Se denna placering i AR" button that swaps the AR view's turbine set to the custom placement.
- Fully Swedish-language UI; installable as a PWA.

## User preferences

_None recorded yet._

## Gotchas

- iOS Safari requires a user-gesture-triggered `DeviceOrientationEvent.requestPermission()` call before compass data is available — handled in `useCompassHeading.ts`, triggered from the "Starta AR-vyn" button.
- Camera/GPS/compass are unavailable or limited in desktop/headless test browsers — the app's top/bottom UI chrome and map/petition overlays are intentionally still usable even if AR itself can't fully initialize. The dBA and Infraljud panels are gated behind `ready` (needs GPS + orientation + camera stream all present), so they cannot be opened/expanded in a headless/sensor-less test browser — this is expected, not a bug.

## Wind data sync (api-server + lib/wind-sync)

Beyond this AR artifact, the monorepo also has an `api-server` artifact and a `lib/wind-sync` package that ingest Vindbrukskollen (Swedish wind power register) data into Postgres for the `vindkraft-karta` map artifact.

- `lib/wind-sync` — shared lib exporting `runWindSync()` (adapters + upsert logic + locality impact scoring). Used by both the manual CLI script and the API server's automatic scheduler.
- `scripts/src/wind-sync/run.ts` — thin CLI wrapper (`pnpm --filter @workspace/scripts run sync:wind`) for one-off manual syncs.
- `artifacts/api-server/src/lib/windSyncScheduler.ts` — in-process scheduler started on server boot. Runs once ~15s after startup, then every `WIND_SYNC_INTERVAL_HOURS` (default 24; set `WIND_SYNC_DISABLE_SCHEDULER=true` to turn it off). Guards against overlapping runs and tracks last-run status. Exposed via `GET /api/wind/sync-status` (`scheduler` field: `enabled`, `intervalHours`, `isRunning`, `lastRunStartedAt/FinishedAt`, `lastRunStatus`, `lastRunError`, `nextRunAt`).
- The sync is upsert-based on stable external IDs, so re-running it at any time is safe — it only refreshes existing rows and adds newly discovered localities/turbines/project areas.
- The in-process scheduler only keeps data fresh while the api-server process itself is running. If that artifact is ever switched to an autoscale (scale-to-zero) production deployment, pair it with a Replit **Scheduled Deployment** (configured by the user in the Deployments pane — deployment type can't be changed from code) running `pnpm --filter @workspace/scripts run sync:wind` on a cron schedule for a guaranteed periodic run.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
