# Wind data sync (api-server + lib/wind-sync)

Beyond this AR artifact, the monorepo also has an `api-server` artifact and a `lib/wind-sync` package that ingest Vindbrukskollen (Swedish wind power register) data into Postgres for the `vindkraft-karta` map artifact.

- `lib/wind-sync` — shared lib exporting `runWindSync()` (adapters + upsert logic + locality impact scoring). Used by both the manual CLI script and the API server's automatic scheduler.
- `scripts/src/wind-sync/run.ts` — thin CLI wrapper (`pnpm --filter @workspace/scripts run sync:wind`) for one-off manual syncs.
- `artifacts/api-server/src/lib/windSyncScheduler.ts` — in-process scheduler started on server boot. Runs once ~15s after startup, then every `WIND_SYNC_INTERVAL_HOURS` (default 24; set `WIND_SYNC_DISABLE_SCHEDULER=true` to turn it off). Guards against overlapping runs and tracks last-run status. Exposed via `GET /api/wind/sync-status` (`scheduler` field: `enabled`, `intervalHours`, `isRunning`, `lastRunStartedAt/FinishedAt`, `lastRunStatus`, `lastRunError`, `nextRunAt`).
- The sync is upsert-based on stable external IDs, so re-running it at any time is safe — it only refreshes existing rows and adds newly discovered localities/turbines/project areas.
- The in-process scheduler only keeps data fresh while the api-server process itself is running. If that artifact is ever switched to an autoscale (scale-to-zero) production deployment, pair it with a Replit **Scheduled Deployment** (configured by the user in the Deployments pane — deployment type can't be changed from code) running `pnpm --filter @workspace/scripts run sync:wind` on a cron schedule for a guaranteed periodic run.
