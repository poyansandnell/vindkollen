/**
 * ProjectPickerSheet — ett dragbart bottom-sheet som låter användaren
 * välja bland vindkraftsprojekt i närheten.
 *
 * Visas automatiskt vid GPS-fix om flera projekt hittas, och kan öppnas
 * manuellt via "Byt projekt"-knappen i menyn.
 */
import { useCallback } from "react";
import type { NearbyProjectEntry } from "@/lib/projectSelection";

interface Props {
  entries: NearbyProjectEntry[];
  currentProjectId?: number | string;
  onSelect: (entry: NearbyProjectEntry) => void;
  onClose: () => void;
}

function formatDist(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

export function ProjectPickerSheet({ entries, currentProjectId, onSelect, onClose }: Props) {
  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col justify-end"
      onClick={handleBackdrop}
    >
      {/* Halvtransparent bakgrund */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Sheet-panel */}
      <div className="relative z-10 flex max-h-[70dvh] flex-col rounded-t-2xl bg-[#111] text-white shadow-2xl">
        {/* Handtag */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-white/20" />
        </div>

        {/* Rubrik */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 pb-3 pt-1">
          <h2 className="text-base font-semibold">Vindkraftsprojekt i närheten</h2>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white transition-colors text-xl leading-none p-1"
            aria-label="Stäng"
          >
            ✕
          </button>
        </div>

        {/* Lista */}
        <div className="overflow-y-auto overscroll-contain">
          {entries.length === 0 && (
            <p className="px-5 py-8 text-sm text-white/50 text-center">
              Inga projekt hittades inom räckhåll.
            </p>
          )}
          {entries.map((entry) => {
            const isCurrent = String(entry.projectArea.id) === String(currentProjectId);
            const isExact = entry.projectArea.id === 32; // Ericsberg — exakta koordinater
            return (
              <button
                key={entry.projectArea.id}
                onClick={() => { onSelect(entry); onClose(); }}
                className={`w-full flex items-start gap-4 px-5 py-4 text-left border-b border-white/5 transition-colors last:border-b-0
                  ${isCurrent ? "bg-white/10" : "hover:bg-white/5 active:bg-white/10"}`}
              >
                {/* Avståndscirkel */}
                <div className="mt-0.5 flex-shrink-0 flex flex-col items-center">
                  <div className={`text-xs font-bold ${isCurrent ? "text-[#FF8B01]" : "text-white/60"}`}>
                    {formatDist(entry.distanceM)}
                  </div>
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-medium leading-snug ${isCurrent ? "text-[#FF8B01]" : "text-white"}`}>
                      {entry.projectArea.name}
                    </span>
                    {isCurrent && (
                      <span className="text-[10px] bg-[#FF8B01]/20 text-[#FF8B01] px-1.5 py-0.5 rounded-full font-medium">
                        Aktiv
                      </span>
                    )}
                    {isExact && (
                      <span className="text-[10px] bg-green-500/15 text-green-400 px-1.5 py-0.5 rounded-full font-medium">
                        Exakta koordinater
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-white/50">
                    {entry.projectArea.kommun && `${entry.projectArea.kommun} · `}
                    {entry.turbineCount} planerade verk
                    {!isExact && <span className="ml-1 opacity-60">≈ ungefärliga positioner</span>}
                  </div>
                </div>

                {/* Pil */}
                <div className="mt-1 flex-shrink-0 text-white/30 text-sm">
                  {isCurrent ? "✓" : "›"}
                </div>
              </button>
            );
          })}
        </div>

        {/* Sidfot */}
        <div className="border-t border-white/10 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <p className="text-xs text-white/30 text-center">
            Projekt utan exakta koordinater visas med ≈ ungefärliga positioner i AR.
          </p>
        </div>
      </div>
    </div>
  );
}
