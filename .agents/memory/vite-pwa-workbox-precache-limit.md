---
name: vite-plugin-pwa workbox precache size limit
description: Adding vite-plugin-pwa to a Vite app that bundles a large client library (e.g. mapbox-gl) can fail the production build with a workbox precache size error.
---

vite-plugin-pwa's default `generateSW` workbox strategy has a 2MB
`maximumFileSizeToCacheInBytes` limit. If the app's main JS bundle exceeds
that (common with heavy client libs like mapbox-gl, three.js, etc.), the
production build throws `Assets exceeding the limit ... won't be precached`
and fails entirely (not just a warning).

**Why:** discovered when adding PWA support to a map app whose bundle
(mapbox-gl) was ~2.28MB — build failed until the limit was raised.

**How to apply:** when adding `vite-plugin-pwa` to an app with a large
bundle, proactively set `workbox.maximumFileSizeToCacheInBytes` to a higher
value (e.g. 5MB) in the VitePWA config, rather than waiting for the build to
fail.
