import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

// De 8 verkliga planerade vindkraftverk (från src/lib/turbines.ts, SWEREF99 TM
// konverterat till WGS84) som ligger NÄRMAST Katrineholms centrum. Kartverktyget
// utgår alltså från den verkliga planen — användaren experimenterar därifrån,
// inte från en godtycklig startposition. Se replit.md / turbines.ts för källan.
const DEFAULT_TURBINES: PlacedTurbine[] = [
  { id: "t25", lat: 58.99268, lon: 16.26596 }, // V5-2, ~3.4 km från Katrineholm
  { id: "t24", lat: 58.99401, lon: 16.28032 }, // V5-1, ~4.2 km
  { id: "t29", lat: 58.97705, lon: 16.28416 }, // V5-6, ~4.9 km
  { id: "t26", lat: 58.99142, lon: 16.29339 }, // V5-3, ~5.0 km
  { id: "t27", lat: 58.98694, lon: 16.30302 }, // V5-4, ~5.6 km
  { id: "t28", lat: 58.97971, lon: 16.30244 }, // V5-5, ~5.8 km
  { id: "t14", lat: 58.93001, lon: 16.23653 }, // V3-1, ~7.5 km
  { id: "t15", lat: 58.92455, lon: 16.21137 }, // V3-2, ~7.9 km
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

let nextTurbineSeq = 1;

/**
 * Hur länge "Beräknar påverkan…" visas innan hushåll/buller/skuggor/poäng
 * och kartans färger uppdateras (0,5–1s enligt spec). Den tunga
 * `scorePlacement()`-omräkningen (hushåll, avstånd, spacing — O(n²)-ish för
 * många verk) körs alltså inte synkront på varje flytt/tillägg/borttagning
 * längre; den skjuts till efter denna fördröjning, vilket också var en del
 * av krascharna vid många objekt (se PlacementMap.tsx för motsvarande fix
 * av per-render `scorePlacement([t])`-anrop).
 */
const RECOMPUTE_DELAY_MS = 700;

export default function PlaceTurbines() {
  const [, navigate] = useLocation();
  const [turbines, setTurbines] = useState<PlacedTurbine[]>(DEFAULT_TURBINES);
  const [committedTurbines, setCommittedTurbines] = useState<PlacedTurbine[]>(DEFAULT_TURBINES);
  const [calculating, setCalculating] = useState(false);
  const [saved, setSaved] = useState<SavedPlacement[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [showEstateBoundary, setShowEstateBoundary] = useState(false);

  const turbinesRef = useRef(turbines);
  turbinesRef.current = turbines;
  const commitTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setSaved(loadSaved());
  }, []);

  useEffect(() => () => {
    if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
  }, []);

  const scheduleRecompute = useCallback(() => {
    setCalculating(true);
    if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = window.setTimeout(() => {
      setCommittedTurbines(turbinesRef.current);
      setCalculating(false);
    }, RECOMPUTE_DELAY_MS);
  }, []);

  // De tunga/synliga effekterna (hushållsantal, buller/skuggor, totalpoäng,
  // kartfärger) drivs av `committedTurbines`, som bara hoppar fram efter
  // `scheduleRecompute`s fördröjning — detta ger den efterfrågade "Beräknar
  // påverkan…"-känslan istället för att allt smäller om direkt vid varje
  // flytt. Verkens faktiska position på kartan (`turbines`) uppdateras dock
  // omedelbart så flytt-animationen känns direkt och responsiv.
  const result = useMemo(() => scorePlacement(committedTurbines), [committedTurbines]);
  const colors = PLACEMENT_LEVEL_COLORS[result.level];

  const handleMove = useCallback(
    (id: string, lat: number, lon: number) => {
      setTurbines((prev) => prev.map((t) => (t.id === id ? { ...t, lat, lon } : t)));
      scheduleRecompute();
    },
    [scheduleRecompute],
  );

  const handleAdd = useCallback(
    (lat: number, lon: number) => {
      setTurbines((prev) => [...prev, { id: `custom-${Date.now()}-${nextTurbineSeq++}`, lat, lon }]);
      scheduleRecompute();
    },
    [scheduleRecompute],
  );

  const handleRemove = useCallback(
    (id: string) => {
      setTurbines((prev) => prev.filter((t) => t.id !== id));
      scheduleRecompute();
    },
    [scheduleRecompute],
  );

  function handleReset() {
    setTurbines(DEFAULT_TURBINES);
    setCommittedTurbines(DEFAULT_TURBINES);
    setCalculating(false);
    if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
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
          <p className="text-sm text-white/70">
            Ericsbergs marker · klicka för att placera · tryck på ett verk för att flytta/ta bort
          </p>
        </div>
        <button
          onClick={() => navigate("/")}
          className="shrink-0 rounded-full bg-white/10 px-4 py-1.5 text-sm text-white hover:bg-white/20"
        >
          Stäng
        </button>
      </div>

      <div className="flex items-center gap-2 border-b border-white/10 bg-[#0d0d0d] px-4 py-2">
        <button
          onClick={() => setShowEstateBoundary((v) => !v)}
          className={`rounded-full px-3 py-1.5 text-xs font-medium ${
            showEstateBoundary ? "bg-[#FFB347] text-[#090909]" : "border border-white/20 bg-white/5 text-white hover:bg-white/10"
          }`}
        >
          🗺️ Visa Ericsbergs mark
        </button>
        <p className="text-[11px] text-white/40">{turbines.length} verk placerade</p>
      </div>

      <div className="relative flex-1 overflow-hidden p-3">
        <PlacementMap
          turbines={turbines}
          colorTurbines={committedTurbines}
          onMove={handleMove}
          onAdd={handleAdd}
          onRemove={handleRemove}
          outsideBoundaryIds={result.outsideBoundaryIds}
          showEstateBoundary={showEstateBoundary}
        />

        {calculating && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
            <div className="flex items-center gap-2 rounded-full bg-black/80 px-4 py-2 text-xs font-medium text-white shadow-lg">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Beräknar påverkan…
            </div>
          </div>
        )}
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
