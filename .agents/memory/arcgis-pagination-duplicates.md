---
name: ArcGIS resultOffset pagination needs orderByFields
description: ArcGIS REST "query" endpoints can return duplicate/skipped features across resultOffset pages unless a stable sort order is specified.
---

Paging an ArcGIS MapServer/FeatureServer layer with `resultOffset` +
`resultRecordCount` alone does not guarantee a stable row order between
requests. Without an explicit `orderByFields` (e.g. `orderByFields=OBJECTID`),
the server's default ordering can shift between page requests, so the same
feature can appear on two consecutive pages (or a feature can be skipped
entirely).

**Why:** hit this as a downstream Postgres error — `ON CONFLICT DO UPDATE
command cannot affect row a second time` — when batch-upserting paginated
ArcGIS features keyed by external ID. The duplicate wasn't a data-source
bug, it was unstable pagination order.

**How to apply:** always add a deterministic `orderByFields` (a unique/
near-unique field such as the layer's object ID) to any ArcGIS `query`
request that pages via `resultOffset`. As a second safety net, dedupe
paginated results by external/natural key before bulk upserting, since
some ArcGIS servers are still inconsistent even with `orderByFields`.
