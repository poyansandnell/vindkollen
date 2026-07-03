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
- `src/components/ARScene.tsx` — the Three.js AR overlay (turbine meshes, name/distance labels, blinking red aviation light at night, sun-synced lighting, Skuggflimmer blade-shadow flicker, exposes its canvas via `canvasRef` for Fotomontage capture).
- `src/components/CameraBackground.tsx`, `MapView.tsx`, `PetitionModal.tsx`, `PermissionGate.tsx` — supporting UI. `CameraBackground` accepts an optional `videoRef` to expose its `<video>` element for Fotomontage capture.
- `src/components/VisualizationControls.tsx` — sun/scale/visibility/night mode toggles, plus the Skuggflimmer toggle + info tooltip.
- `src/components/SoundLevelPanel.tsx` — live "🔊 Beräknad ljudnivå" dBA estimate panel (`SoundLevelBadge` shows "Väntar på GPS…" fallback until a position fix exists).
- `src/components/PhotoMontageModal.tsx` — Fotomontage capture preview with Spara/Ta ny bild/Dela (Web Share API) actions.
- `src/lib/soundLevel.ts` — dBA estimation from GPS distance to every turbine, logarithmic combination, severity color coding, exact disclaimer text.
- `src/lib/visualizationTypes.ts` — shared visualization mode types, incl. `shadowFlickerActive()` gating (only active in "current"/"low" sun modes).
- `src/lib/noiseImpact.ts` — weighted green/yellow/red "infraljud-/bullerpåverkan" score combining dBA level, contributing-turbine count, downwind wind direction (if available), and exposure duration; owns the exact Swedish disclaimer text (`NOISE_IMPACT_DISCLAIMER`) — do not reword it, must keep "kan bidra till"/"kan upplevas"/"för känsliga personer" phrasing and avoid absolute claims.
- `src/hooks/useWindDirection.ts` — fetches current wind direction/speed for the user's GPS position from the free Open-Meteo API (no key required); fails silently to `null` on network errors so the noise monitor just ignores the wind factor.
- `src/components/NoiseImpactMonitor.tsx` — `NoiseImpactBadge` (always-visible top-bar status) + `NoiseImpactPanel` (expandable detail panel with reasons + disclaimer), mirrors the `SoundLevelPanel.tsx` pattern.
- `src/pages/Home.tsx` — wires camera + AR + GPS + compass + permission gate + top/bottom UI chrome + dBA panel + noise impact monitor (incl. exposure-duration timer) + Fotomontage capture together.

## Architecture decisions

- Built as a plain React+Vite PWA (not Expo), per explicit user requirement — overrides the default mobile-artifact assumption.
- No backend: turbine data is static/client-side, and petition "signatures" are stored in `localStorage` only (no server persistence).
- AR is done without WebXR — turbines are positioned in a Three.js scene using bearing/distance relative to the user's GPS position and compass heading, for broad mobile browser compatibility.
- The 29 turbines are fictional but grounded in the real Länsterberget wind farm project (OX2) north of Katrineholm and the real 2022 local referendum on wind power.

## Product

- Camera-based AR view showing 29 wind turbines at true bearing/distance from the user, each labeled with name + distance.
- Blinking red aviation obstruction lights on turbines at night (22:00–06:00).
- Optional procedurally generated wind sound (Web Audio, no audio files), always routed through the device's main speaker (never the earpiece) even on iOS Safari.
- Live "🔊 Beräknad ljudnivå" dBA panel estimating sound exposure from turbine distance. The wind sound's actual playback volume now scales continuously with this same dBA estimate (`soundLevel.ts`'s `dbaToGain`), instead of a plain on/off.
- Explicit always-visible "🔊 Ljud ute / 🔈 Ljud inne" toggle (bottom controls) that the user controls directly — always starts on "Ljud ute" at app launch. This toggle (not the camera-based sky heuristic) is the sole input to the dBA estimate's indoor attenuation and therefore to the wind sound volume, so the displayed dBA number and the actual sound always agree.
- "🌗 Skuggflimmer" (shadow flicker) mode simulating blade-shadow flicker, only active in "Aktuell sol"/"Låg sol" sun modes, with an info tooltip explaining the effect.
- "📸 Fotomontage": captures a composite photo (camera + AR overlay + watermark + disclaimer) with Spara/Ta ny bild/Dela (Web Share API) actions.
- "🌬️ Infraljud"-monitor: always-visible green/yellow/red badge + expandable panel estimating overall noise/infrasound impact (a distinct indicator from the dBA panel above) from distance, number of contributing turbines, wind direction (if available), and how long the user has been on-site, with a calm Swedish disclaimer emphasizing it is an estimated indicator, not a medical measurement (never claims guaranteed harm).
- Map view (SVG-based) showing all turbines and the user's position.
- "Skriv under för folkomröstning" petition button/modal referencing the real 2022 Katrineholm wind-power referendum.
- Turbines only render in the AR view when the camera-based sky detection is confident of a clear outdoor sky view; any uncertainty (including "indoors" classification) hides turbines and shows a large, high-z-index "Gå utomhus" (go outside) message that always renders above all UI chrome (top/bottom bars, badges).
- Fully Swedish-language UI; installable as a PWA.

## User preferences

_None recorded yet._

## Gotchas

- iOS Safari requires a user-gesture-triggered `DeviceOrientationEvent.requestPermission()` call before compass data is available — handled in `useCompassHeading.ts`, triggered from the "Starta AR-vyn" button.
- Camera/GPS/compass are unavailable or limited in desktop/headless test browsers — the app's top/bottom UI chrome and map/petition overlays are intentionally still usable even if AR itself can't fully initialize.

## Wind data sync (api-server + lib/wind-sync)

Beyond this AR artifact, the monorepo also has an `api-server` artifact and a `lib/wind-sync` package that ingest Vindbrukskollen (Swedish wind power register) data into Postgres for the `vindkraft-karta` map artifact.

- `lib/wind-sync` — shared lib exporting `runWindSync()` (adapters + upsert logic + locality impact scoring). Used by both the manual CLI script and the API server's automatic scheduler.
- `scripts/src/wind-sync/run.ts` — thin CLI wrapper (`pnpm --filter @workspace/scripts run sync:wind`) for one-off manual syncs.
- `artifacts/api-server/src/lib/windSyncScheduler.ts` — in-process scheduler started on server boot. Runs once ~15s after startup, then every `WIND_SYNC_INTERVAL_HOURS` (default 24; set `WIND_SYNC_DISABLE_SCHEDULER=true` to turn it off). Guards against overlapping runs and tracks last-run status. Exposed via `GET /api/wind/sync-status` (`scheduler` field: `enabled`, `intervalHours`, `isRunning`, `lastRunStartedAt/FinishedAt`, `lastRunStatus`, `lastRunError`, `nextRunAt`).
- The sync is upsert-based on stable external IDs, so re-running it at any time is safe — it only refreshes existing rows and adds newly discovered localities/turbines/project areas.
- The in-process scheduler only keeps data fresh while the api-server process itself is running. If that artifact is ever switched to an autoscale (scale-to-zero) production deployment, pair it with a Replit **Scheduled Deployment** (configured by the user in the Deployments pane — deployment type can't be changed from code) running `pnpm --filter @workspace/scripts run sync:wind` on a cron schedule for a guaranteed periodic run.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
