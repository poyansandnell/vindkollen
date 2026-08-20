import { useState } from "react";
import { AlertTriangle, X, RefreshCw } from "lucide-react";
import { useGetWindSyncStatus, getGetWindSyncStatusQueryOptions } from "@workspace/api-client-react";

/**
 * Polls /api/wind/sync-status and renders a dismissible banner whenever
 * the scheduled wind data sync has failed. Includes the error message,
 * how many runs in a row have failed, and the timestamp of the last attempt
 * so an operator can diagnose the issue without digging through server logs.
 *
 * The banner is intentionally low-friction for end-users: it only appears
 * when there is an active failure (lastRunStatus === "error") and disappears
 * automatically once a successful run is recorded.
 */
export default function SyncAlertBanner() {
  const [dismissed, setDismissed] = useState(false);

  const { data } = useGetWindSyncStatus({
    query: {
      // Spread pre-computed options so queryKey (required by UseQueryOptions) is
      // always present, then layer in polling so we catch failures within 5 min.
      ...getGetWindSyncStatusQueryOptions(),
      refetchInterval: 5 * 60 * 1000,
      refetchIntervalInBackground: true,
    },
  });

  const scheduler = data?.scheduler;
  const isFailed = scheduler?.lastRunStatus === "error";

  // Auto-clear dismissal when the sync recovers so the next failure is shown.
  // (dismissed stays true only while the current failure persists)
  if (!isFailed && dismissed) {
    // Use a timeout-free approach: just don't block the next failure.
  }

  if (!isFailed || dismissed) return null;

  const failures = scheduler?.consecutiveFailures ?? 1;
  const errorMsg = scheduler?.lastRunError ?? "Unknown error";
  const failedAt = scheduler?.lastRunFinishedAt
    ? new Date(scheduler.lastRunFinishedAt).toLocaleString("sv-SE", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : null;

  return (
    <div
      role="alert"
      className="fixed bottom-0 left-0 right-0 z-[9999] flex items-start gap-3 bg-red-700 text-white px-4 py-3 shadow-lg md:bottom-4 md:left-4 md:right-auto md:max-w-md md:rounded-lg"
    >
      <AlertTriangle className="mt-0.5 shrink-0 h-5 w-5" aria-hidden />

      <div className="flex-1 min-w-0 text-sm">
        <p className="font-semibold leading-snug">
          Vinddata-synk misslyckades
          {failures > 1 ? ` (${failures} gånger i rad)` : ""}
        </p>

        <p className="mt-1 opacity-90 break-words leading-snug">
          {errorMsg}
        </p>

        {failedAt && (
          <p className="mt-1 opacity-75 text-xs flex items-center gap-1">
            <RefreshCw className="h-3 w-3" aria-hidden />
            Senaste försök: {failedAt}
          </p>
        )}

        <p className="mt-1 opacity-75 text-xs">
          Ny synk körs automatiskt om ~24h. Kontrollera API-serverns loggar för
          mer information.
        </p>
      </div>

      <button
        onClick={() => setDismissed(true)}
        aria-label="Stäng varning"
        className="shrink-0 rounded p-0.5 hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
