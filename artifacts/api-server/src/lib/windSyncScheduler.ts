import { runWindSync } from "@workspace/wind-sync";
import { logger } from "./logger";

const DEFAULT_INTERVAL_HOURS = 24;
const MIN_INTERVAL_HOURS = 1;

function readIntervalHours(): number {
  const raw = process.env["WIND_SYNC_INTERVAL_HOURS"];
  if (!raw) return DEFAULT_INTERVAL_HOURS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.warn(
      { raw },
      `Invalid WIND_SYNC_INTERVAL_HOURS, falling back to ${DEFAULT_INTERVAL_HOURS}h`,
    );
    return DEFAULT_INTERVAL_HOURS;
  }
  return Math.max(parsed, MIN_INTERVAL_HOURS);
}

export interface WindSyncSchedulerState {
  enabled: boolean;
  intervalHours: number;
  isRunning: boolean;
  lastRunStartedAt: Date | null;
  lastRunFinishedAt: Date | null;
  lastRunStatus: "ok" | "error" | null;
  lastRunError: string | null;
  nextRunAt: Date | null;
}

const state: WindSyncSchedulerState = {
  enabled: false,
  intervalHours: DEFAULT_INTERVAL_HOURS,
  isRunning: false,
  lastRunStartedAt: null,
  lastRunFinishedAt: null,
  lastRunStatus: null,
  lastRunError: null,
  nextRunAt: null,
};

export function getWindSyncSchedulerState(): WindSyncSchedulerState {
  return { ...state };
}

async function runOnce(): Promise<void> {
  if (state.isRunning) {
    logger.warn("Wind sync already running, skipping this scheduled tick");
    return;
  }
  state.isRunning = true;
  state.lastRunStartedAt = new Date();
  logger.info("Scheduled wind data sync starting...");
  try {
    const result = await runWindSync({
      log: (msg) => logger.info(msg),
    });
    state.lastRunStatus = "ok";
    state.lastRunError = null;
    logger.info({ countries: result.countries }, "Scheduled wind data sync completed");
  } catch (err) {
    state.lastRunStatus = "error";
    state.lastRunError = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Scheduled wind data sync failed");
  } finally {
    state.isRunning = false;
    state.lastRunFinishedAt = new Date();
    state.nextRunAt = new Date(Date.now() + state.intervalHours * 60 * 60 * 1000);
  }
}

/**
 * Starts an in-process scheduler that periodically re-runs the wind data
 * sync so turbine/project status changes and new localities stay current
 * without manual intervention. Runs once shortly after startup, then on a
 * fixed interval (default 24h, configurable via WIND_SYNC_INTERVAL_HOURS).
 *
 * The sync itself is upsert-based and safe to re-run at any time. This
 * scheduler only keeps data fresh while this process is running — if this
 * service is ever deployed with a scale-to-zero (autoscale) target in
 * production, pair it with a Replit Scheduled Deployment that runs
 * `pnpm --filter @workspace/scripts run sync:wind` on a cron schedule for
 * a guaranteed periodic run even when no traffic is keeping the app warm.
 */
export function startWindSyncScheduler(): void {
  if (process.env["WIND_SYNC_DISABLE_SCHEDULER"] === "true") {
    logger.info("Wind sync scheduler disabled via WIND_SYNC_DISABLE_SCHEDULER");
    return;
  }

  state.enabled = true;
  state.intervalHours = readIntervalHours();

  const intervalMs = state.intervalHours * 60 * 60 * 1000;
  const STARTUP_DELAY_MS = 15_000;

  logger.info(
    { intervalHours: state.intervalHours },
    "Starting wind sync scheduler",
  );

  const timer = setTimeout(() => {
    void runOnce();
    setInterval(() => void runOnce(), intervalMs).unref();
  }, STARTUP_DELAY_MS);
  timer.unref();

  state.nextRunAt = new Date(Date.now() + STARTUP_DELAY_MS);
}
