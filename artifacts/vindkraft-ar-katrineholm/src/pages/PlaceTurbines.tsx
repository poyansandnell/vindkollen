import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { PlacementMap } from "@/components/PlacementMap";
import {
  PLACEMENT_DISCLAIMER,
  PLACEMENT_LEVEL_COLORS,
  PLACEMENT_LEVEL_LABELS,
  scorePlacement,
  type PlacedTurbine,
} from "@/lib/placementScoring";
import { ERICSBERG_AREA_DISCLAIMER } from "@/lib/ericsbergArea";

const SAVED_KEY = "vindkraft-ar-katrineholm:savedPlacements";
const AR_HANDOFF_KEY = "vindkraft-ar-katrineholm:customPlacement";

const DEFAULT_TURBINES: PlacedTurbine[] = [
  { id: "p1", lat: 58.893, lon: 16.045 },
  { id: "p2", lat: 58.891, lon: 16.075 },
  { id: "p3", lat: 58.883, lon: 16.035 },
  { id: "p4", lat: 58.883, lon: 16.06 },
  { id: "p5", lat: 58.883, lon: 16.085 },
  { id: "p6", lat: 58.874, lon: 16.04 },
  { id: "p7", lat: 58.873, lon: 16.065 },
  { id: "p8", lat: 58.874, lon: 16.078 },
];

interface SavedPlacement {
  id: string;
  name: string;
  timestamp: number;
  turbines: PlacedTurbine[];
  totalScore: number;
}

function loadSaved(): SavedPlacement[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    return raw ? (JSON.parse(raw) as SavedPlacement[]) : [];
  } catch {
    return [];
  }
}

export default function PlaceTurbines() {
  const [, navigate] = useLocation();
  const [turbines, setTurbines] = useState<PlacedTurbine[]>(DEFAULT_TURBINES);
  const [saved, setSaved] = useState<SavedPlacement[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setSaved(loadSaved());
  }, []);

  const result = useMemo(() => scorePlacement(turbines), [turbines]);
  const colors = PLACEMENT_LEVEL_COLORS[result.level];

  const handleMove = useCallback((id: string, lat: number, lon: number) => {
    setTurbines((prev) => prev.map((t) => (t.id === id ? { ...t, lat, lon } : t)));
  }, []);

  function handleReset() {
    setTurbines(DEFAULT_TURBINES);
  }

  function handleSave() {
    const entry: SavedPlacement = {
      id: `placement-${Date.now()}`,
      name: `Placering ${saved.length + 1}`,
      timestamp: Date.now(),
      turbines,
      totalScore: result.totalScore,
    };
    const next = [...saved, entry].slice(-8);
    localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    setSaved(next);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1800);
  }

  function handleLoad(entry: SavedPlacement) {
    setTurbines(entry.turbines);
    setCompareOpen(false);
  }

  function handleDelete(id: string) {
    const next = saved.filter((s) => s.id !== id);
    localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    setSaved(next);
  }

  function handleViewInAr() {
    localStorage.setItem(AR_HANDOFF_KEY, JSON.stringify({ turbines, savedAt: Date.now() }));
    navigate("/");
  }

  return (
    <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-[#090909] text-white">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-[#FFB347]">PLACERA VINDKRAFTVERKEN SJÄLV</p>
          <p className="text-sm text-white/70">Ericsbergs marker · dra verken för att omplacera</p>
        </div>
        <button
          onClick={() => navigate("/")}
          className="shrink-0 rounded-full bg-white/10 px-4 py-1.5 text-sm text-white hover:bg-white/20"
        >
          Stäng
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden p-3">
        <PlacementMap turbines={turbines} onMove={handleMove} outsideBoundaryIds={result.outsideBoundaryIds} />
      </div>

      {result.playfulWarning && (
        <div className="mx-3 mb-2 rounded-xl border border-yellow-400/30 bg-yellow-500/15 px-3 py-2 text-xs text-yellow-100">
          ⚠️ {result.playfulWarning}
        </div>
      )}

      <div className="max-h-[46dvh] overflow-y-auto border-t border-white/10 bg-[#0d0d0d] px-4 py-3">
        <button
          onClick={() => setDetailsOpen((v) => !v)}
          className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left ${colors.border} ${colors.bg}`}
        >
          <span className={`text-sm font-semibold ${colors.text}`}>
            {colors.emoji} {PLACEMENT_LEVEL_LABELS[result.level]} · {Math.round(result.totalScore)}/100
          </span>
          <span className="text-xs text-white/60">{detailsOpen ? "Dölj detaljer ▲" : "Visa mer ▼"}</span>
        </button>

        {detailsOpen && (
          <div className="mt-2 space-y-2">
            <p className="text-xs text-white/70">
              Uppskattningsvis <span className="font-semibold text-white">{result.householdsAffected}</span> hushåll
              kan påverkas.
              {result.nearestHouseholdDistanceM !== null && (
                <>
                  {" "}
                  Närmaste bebyggelse ({result.nearestHouseholdName}) ligger{" "}
                  {Math.round(result.nearestHouseholdDistanceM)} m bort.
                </>
              )}
            </p>
            <ul className="space-y-1.5">
              {result.factors.map((f) => (
                <li key={f.key} className="flex items-center justify-between rounded-lg bg-white/5 px-2.5 py-1.5 text-xs">
                  <span className="text-white/80">{f.label}</span>
                  <span className={f.impactPoints < 0 ? "text-emerald-300" : "text-white/60"}>
                    {f.impactPoints > 0 ? "+" : ""}
                    {f.impactPoints.toFixed(1)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-white/40">{PLACEMENT_DISCLAIMER}</p>
            <p className="text-[11px] text-white/40">{ERICSBERG_AREA_DISCLAIMER}</p>
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            onClick={handleReset}
            className="rounded-full border border-white/20 bg-white/5 py-2.5 text-xs font-medium text-white hover:bg-white/10"
          >
            🔄 Återställ
          </button>
          <button
            onClick={handleSave}
            className="rounded-full border border-white/20 bg-white/5 py-2.5 text-xs font-medium text-white hover:bg-white/10"
          >
            {savedFlash ? "✅ Sparad!" : "💾 Spara placering"}
          </button>
          <button
            onClick={() => setCompareOpen((v) => !v)}
            className="rounded-full border border-white/20 bg-white/5 py-2.5 text-xs font-medium text-white hover:bg-white/10"
          >
            📊 Jämför ({saved.length})
          </button>
          <button
            onClick={handleViewInAr}
            className="rounded-full bg-[#FF8B01] py-2.5 text-xs font-semibold text-[#090909] hover:bg-[#FFB347]"
          >
            👁️ Se denna placering i AR
          </button>
        </div>

        {compareOpen && (
          <div className="mt-3 space-y-2">
            {saved.length === 0 && <p className="text-xs text-white/50">Inga sparade placeringar ännu.</p>}
            {saved
              .slice()
              .sort((a, b) => a.totalScore - b.totalScore)
              .map((s) => {
                const sColors = PLACEMENT_LEVEL_COLORS[scorePlacement(s.turbines).level];
                return (
                  <div
                    key={s.id}
                    className={`flex items-center justify-between rounded-xl border px-3 py-2 ${sColors.border} ${sColors.bg}`}
                  >
                    <div>
                      <p className="text-xs font-semibold text-white">{s.name}</p>
                      <p className={`text-[11px] ${sColors.text}`}>
                        {sColors.emoji} {Math.round(s.totalScore)}/100
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleLoad(s)}
                        className="rounded-full bg-white/10 px-3 py-1 text-[11px] text-white hover:bg-white/20"
                      >
                        Ladda
                      </button>
                      <button
                        onClick={() => handleDelete(s.id)}
                        className="rounded-full bg-white/10 px-3 py-1 text-[11px] text-white hover:bg-white/20"
                      >
                        Ta bort
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}
