import { useState } from "react";
import { formatDistance } from "@/lib/geo";
import { SEVERITY_COLORS, soundLevelSeverity, SOUND_LEVEL_DISCLAIMER, dbaToVolume, type SoundLevelEstimate } from "@/lib/soundLevel";

/**
 * Kompakt, alltid synlig liten textrad med ljudnivå (dBA) + antal bidragande
 * vindkraftverk. Går inte att stänga — oberoende av om den större
 * `SoundLevelPanel` är öppen/stängd, syns denna badge i ett hörn av AR-vyn.
 */
export function SoundLevelBadge({ estimate, indoors = false }: { estimate: SoundLevelEstimate; indoors?: boolean }) {
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
          {indoors && <span className="text-white/50">· 🏠 dämpat</span>}
        </>
      ) : (
        <span className="text-white/60">🔊 Väntar på GPS…</span>
      )}
    </span>
  );
}

/**
 * Panelen startar kompakt (bara dBA-talet + en "Visa mer"-knapp) och
 * expanderas först på användarens begäran till den fulla vyn med
 * avstånd/antal-detaljer och ansvarsfriskrivningen — mindre skärmyta
 * upptagen av standardvyn, enligt användartestningens feedback.
 */
export function SoundLevelPanel({
  estimate,
  indoors = false,
  onClose,
}: {
  estimate: SoundLevelEstimate;
  indoors?: boolean;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasSignal = Number.isFinite(estimate.totalDba);
  const severity = hasSignal ? soundLevelSeverity(estimate.totalDba) : "green";
  const colors = SEVERITY_COLORS[severity];

  return (
    <div
      className={`pointer-events-auto w-full rounded-2xl border ${colors.border} ${colors.bg} p-3.5 text-white shadow-xl backdrop-blur-sm`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold tracking-wide text-[#FFB347]">🔊 Ljudnivå</p>
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
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <div className="flex items-baseline gap-1.5">
              <span className={`text-2xl font-bold ${colors.text}`}>{colors.emoji} {estimate.totalDba.toFixed(1)}</span>
              <span className="text-xs text-white/70">dBA</span>
              {indoors && <span className="text-[11px] text-white/50">· 🏠 dämpat</span>}
            </div>
            <button
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/85 transition hover:bg-white/20"
            >
              {expanded ? "Visa mindre" : "Visa mer"}
            </button>
          </div>

          {expanded && (
            <>
              <p className="mt-1.5 text-[11px] text-white/70">
                Närmaste vindkraftverk:{" "}
                <span className="text-white/90">
                  {estimate.nearestDistanceM !== null ? formatDistance(estimate.nearestDistanceM) : "–"}
                </span>
              </p>
              <p className="text-[11px] text-white/70">
                Antal vindkraftverk som bidrar: <span className="text-white/90">{estimate.contributingCount}</span>
              </p>
              <p className="mt-1.5 text-[10px] text-white/50">
                Avstånd: {estimate.nearestDistanceM !== null ? formatDistance(estimate.nearestDistanceM) : "–"} –
                ljudnivå: {Math.round(dbaToVolume(estimate.totalDba) * 100)}%
              </p>
              {indoors && (
                <p className="mt-1.5 text-[11px] font-medium text-white/85">
                  🏠 Inomhus · ljudet dämpas i den här uppskattningen
                </p>
              )}
              <p className="mt-1.5 text-[11px] text-white/70">
                Vindljudets volym följer denna nivå automatiskt — dämpas/höjs i takt med siffran ovan.
              </p>
              <p className="mt-2 text-[10px] leading-relaxed text-white/45">{SOUND_LEVEL_DISCLAIMER}</p>
            </>
          )}
        </>
      ) : (
        <p className="mt-1.5 text-xs text-white/60">Väntar på GPS-position…</p>
      )}
    </div>
  );
}
