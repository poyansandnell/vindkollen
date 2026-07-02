import { formatDistance } from "@/lib/geo";
import { SEVERITY_COLORS, soundLevelSeverity, SOUND_LEVEL_DISCLAIMER, type SoundLevelEstimate } from "@/lib/soundLevel";

export function SoundLevelPanel({ estimate, onClose }: { estimate: SoundLevelEstimate; onClose: () => void }) {
  const hasSignal = Number.isFinite(estimate.totalDba);
  const severity = hasSignal ? soundLevelSeverity(estimate.totalDba) : "green";
  const colors = SEVERITY_COLORS[severity];

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[5.25rem] z-20 flex justify-center px-4">
      <div
        className={`pointer-events-auto w-full max-w-xs rounded-2xl border ${colors.border} ${colors.bg} p-3.5 text-white shadow-xl backdrop-blur-sm`}
      >
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs font-semibold tracking-wide text-[#FFB347]">🔊 Beräknad ljudnivå</p>
          <button
            onClick={onClose}
            aria-label="Stäng ljudnivåpanel"
            className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/80 hover:bg-white/20"
          >
            ✕
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
    </div>
  );
}
