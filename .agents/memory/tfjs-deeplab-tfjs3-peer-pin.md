---
name: TFJS + deeplab peer version pin
description: @tensorflow-models/deeplab requires @tensorflow/tfjs pinned to 3.x, not the latest 4.x
---

`@tensorflow-models/deeplab@0.2.2` (last published ~2020) peer-depends on
`@tensorflow/tfjs-core`/`tfjs-converter@^3.0.0`. Installing the current
`@tensorflow/tfjs` meta-package (4.x) alongside it produces unmet-peer
warnings and risks runtime API mismatches (segment()/GraphModel behavior can
differ across major tfjs versions).

**Why:** deeplab hasn't been updated for tfjs 4.x; the meta-package `@tensorflow/tfjs`
always resolves to the newest major unless pinned, silently mismatching deeplab's
bundled converter/core expectations.

**How to apply:** when adding any `@tensorflow-models/*` pretrained model package,
check its peer deps first and pin `@tensorflow/tfjs` to the matching major version
(e.g. `3.21.0` for deeplab 0.2.2) rather than accepting the latest.
