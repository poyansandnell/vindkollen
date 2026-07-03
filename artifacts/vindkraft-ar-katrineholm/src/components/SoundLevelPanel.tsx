import { formatDistance } from "@/lib/geo";
import { SEVERITY_COLORS, soundLevelSeverity, SOUND_LEVEL_DISCLAIMER, type SoundLevelEstimate } from "@/lib/soundLevel";

/**
 * Kompakt, alltid synlig liten textrad med ljudnivå (dBA) + antal bidragande
 * vindkraftverk. Går inte att stänga — oberoende av om den större
 * `SoundLevelPanel` är öppen/stängd, syns denna badge i ett hörn av AR-vyn.
 */
export function SoundLevelBadge({ estimate }: { estimate: SoundLevelEstimate }) {
  const hasSignal = Number.isFinite(estimate.totalDba);
  const severity = hasSignal ? soundLevelSeverity(estimate.totalDba) : "green";
  const colors = SEVERITY_COLORS[severity];

  return (
    <span className="pointer-events-none flex items-center gap-1 rounded-full bg-black/40 px-2 py-1 text-[10px] font-medium text-white/90 backdrop-blur-sm">
      {hasSignal ? (
        <>
          <span className={colors.text}>
            {colors.emoji} {estimate.totalDba.toFixed(0)} dBA
          </span>
          <span className="text-white/50">· {estimate.contributingCount} verk</span>
        </>
      ) : (
        <span className="text-white/60">🔊 Väntar på GPS…</span>
      )}
    </span>
  );
}

export function SoundLevelPanel({ estimate, onClose }: { estimate: SoundLevelEstimate; onClose: () => void }) {
  const hasSignal = Number.isFinite(estimate.totalDba);
  const severity = hasSignal ? soundLevelSeverity(estimate.totalDba) : "green";
  const colors = SEVERITY_COLORS[severity];

  return (
    <div
      className={`pointer-events-auto w-full rounded-2xl border ${colors.border} ${colors.bg} p-3.5 text-white shadow-xl backdrop-blur-sm`}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold tracking-wide text-[#FFB347]">🔊 Beräknad ljudnivå</p>
        <button
          onClick={onClose}
          aria-label="Dölj ljudnivåpanel"
          className="flex shrink-0 items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-white/25 active:bg-white/30"
        >
          ✕ Dölj
        </button>
      </div>

      {hasSignal ? (
        <>
          <div className="flex items-baseline gap-1.5">
            <span className={`text-2xl font-bold ${colors.text}`}>{colors.emoji} {estimate.totalDba.toFixed(1)}</span>
            <span className="text-xs text-white/70">dBA</span>
          </div>
          <p className="mt-1.5 text-[11px] text-white/70">
            Närmaste vindkraftverk:{" "}
            <span className="text-white/90">
              {estimate.nearestDistanceM !== null ? formatDistance(estimate.nearestDistanceM) : "–"}
            </span>
          </p>
          <p className="text-[11px] text-white/70">
            Antal vindkraftverk som bidrar: <span className="text-white/90">{estimate.contributingCount}</span>
          </p>
        </>
      ) : (
        <p className="text-xs text-white/60">Väntar på GPS-position…</p>
      )}

      <p className="mt-2 text-[10px] leading-relaxed text-white/45">{SOUND_LEVEL_DISCLAIMER}</p>
    </div>
  );
}
