import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { apiUrl } from "@/lib/apiUrl";
import { PlacementMap } from "@/components/PlacementMap";
import { PlacementScorePanel } from "@/components/PlacementScorePanel";
import {
  PLACEMENT_LEVEL_COLORS,
  scorePlacement,
  type LocationContext,
  type PlacedTurbine,
} from "@/lib/placementScoring";
import {
  boundaryToGeoJson,
  getActiveBoundary,
  hasCustomBoundary,
  resetCustomBoundary,
  setCustomBoundary,
  type LatLon,
} from "@/lib/ericsbergArea";

const SAVED_KEY = "vindkraft-ar-katrineholm:savedPlacements";
const AR_HANDOFF_KEY = "vindkraft-ar-katrineholm:customPlacement";
const EDIT_HANDOFF_KEY = "vindkraft:editHandoff";

interface EditHandoff {
  projectName: string;
  turbines: { id: string; lat: number; lon: number }[];
  centerLat?: number | null;
  centerLng?: number | null;
  savedAt: number;
}

function consumeEditHandoff(): { projectName: string; turbines: PlacedTurbine[]; centerLat?: number | null; centerLng?: number | null } | null {
  try {
    const raw = localStorage.getItem(EDIT_HANDOFF_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as EditHandoff;
    if (Date.now() - data.savedAt > 10 * 60 * 1000) {
      localStorage.removeItem(EDIT_HANDOFF_KEY);
      return null;
    }
    localStorage.removeItem(EDIT_HANDOFF_KEY);
    return {
      projectName: data.projectName,
      turbines: data.turbines.map((t) => ({ id: t.id, lat: t.lat, lon: t.lon })),
      centerLat: data.centerLat ?? null,
      centerLng: data.centerLng ?? null,
    };
  } catch {
    return null;
  }
}

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
  const [editHandoff] = useState<{ projectName: string; turbines: PlacedTurbine[]; centerLat?: number | null; centerLng?: number | null } | null>(consumeEditHandoff);
  const initialTurbines = editHandoff?.turbines ?? DEFAULT_TURBINES;
  const [turbines, setTurbines] = useState<PlacedTurbine[]>(initialTurbines);
  const [committedTurbines, setCommittedTurbines] = useState<PlacedTurbine[]>(initialTurbines);
  const { isAuthenticated, login } = useAuth();
  const [showLoginGate, setShowLoginGate] = useState(false);
  const [savingToCloud, setSavingToCloud] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [saved, setSaved] = useState<SavedPlacement[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [showEstateBoundary, setShowEstateBoundary] = useState(false);
  const [boundaryDebugMode, setBoundaryDebugMode] = useState(false);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [scoreMinimized, setScoreMinimized] = useState(false);
  const [boundaryEditMode, setBoundaryEditMode] = useState(false);
  const [editableBoundary, setEditableBoundary] = useState<LatLon[]>(() => getActiveBoundary());
  const [boundaryVersion, setBoundaryVersion] = useState(0);
  const [boundarySavedFlash, setBoundarySavedFlash] = useState(false);
  const [currentLatSpan, setCurrentLatSpan] = useState<number>(0.25);
  const [locationContext, setLocationContext] = useState<LocationContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);

  const turbinesRef = useRef(turbines);
  turbinesRef.current = turbines;
  const commitTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setSaved(loadSaved());
  }, []);

  // Hämta nationell platskontext (orter + naturskydd) när vi är i
  // national/editHandoff-läge. Debounced 1 s efter att turbiner ändras.
  useEffect(() => {
    if (!editHandoff) return;
    if (committedTurbines.length === 0) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const lats = committedTurbines.map((t) => t.lat);
      const lons = committedTurbines.map((t) => t.lon);
      const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
      const centerLng = (Math.min(...lons) + Math.max(...lons)) / 2;

      setContextLoading(true);
      try {
        const resp = await fetch(
          apiUrl(`/api/location-context?lat=${centerLat.toFixed(5)}&lng=${centerLng.toFixed(5)}&radiusKm=50`),
          { signal: controller.signal },
        );
        if (resp.ok) {
          const data = (await resp.json()) as LocationContext;
          setLocationContext(data);
        }
      } catch {
        // AbortError eller nätverksfel — tyst
      } finally {
        setContextLoading(false);
      }
    }, 1000);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [editHandoff, committedTurbines]);

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
  // `boundaryVersion` bärs bara med som ett extra beroende: `scorePlacement()`
  // läser den aktiva gränsen via `getActiveBoundary()` (modulnivå-state, inte
  // ett argument), så en sparad/återställd gräns måste explicit trigga om den
  // annars memoiserade omräkningen.
  const result = useMemo(
    () => scorePlacement(committedTurbines, editHandoff && locationContext ? locationContext : undefined),
    [committedTurbines, boundaryVersion, editHandoff, locationContext],
  );

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

  async function handleSave() {
    const name = editHandoff?.projectName ?? `Placering ${saved.length + 1}`;
    const entry: SavedPlacement = {
      id: `placement-${Date.now()}`,
      name,
      timestamp: Date.now(),
      turbines,
      totalScore: result.totalScore,
    };

    // Spara alltid lokalt
    const next = [...saved, entry].slice(-8);
    localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    setSaved(next);

    if (isAuthenticated) {
      // Spara även i molnet
      setSavingToCloud(true);
      const lats = turbines.map((t) => t.lat);
      const lons = turbines.map((t) => t.lon);
      const centerLat = lats.length ? String(((Math.min(...lats) + Math.max(...lats)) / 2).toFixed(6)) : null;
      const centerLng = lons.length ? String(((Math.min(...lons) + Math.max(...lons)) / 2).toFixed(6)) : null;
      try {
        await fetch(apiUrl("/api/projects"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            name,
            turbines,
            turbineCount: String(turbines.length),
            totalScore: String(Math.round(result.totalScore)),
            centerLat,
            centerLng,
          }),
        });
      } catch {
        // tyst fel — lokal kopia är sparad
      } finally {
        setSavingToCloud(false);
      }
    } else {
      // Visa inloggningsgaten om ej inloggad
      setShowLoginGate(true);
    }

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

  function handleToggleBoundaryEdit() {
    setBoundaryEditMode((v) => {
      const next = !v;
      if (next) setEditableBoundary(getActiveBoundary());
      return next;
    });
  }

  const handleVertexDrag = useCallback((index: number, lat: number, lon: number) => {
    setEditableBoundary((prev) => prev.map((p, i) => (i === index ? { lat, lon } : p)));
  }, []);

  const handleVertexRemove = useCallback((index: number) => {
    setEditableBoundary((prev) => (prev.length > 3 ? prev.filter((_, i) => i !== index) : prev));
  }, []);

  const handleVertexAdd = useCallback((lat: number, lon: number) => {
    setEditableBoundary((prev) => {
      if (prev.length < 3) return [...prev, { lat, lon }];
      // Sätt in den nya punkten på den kant (segment) den ligger närmast,
      // så polygonen inte blir självkorsande av ett godtyckligt tillägg.
      let bestIndex = prev.length;
      let bestDist = Infinity;
      for (let i = 0; i < prev.length; i++) {
        const a = prev[i];
        const b = prev[(i + 1) % prev.length];
        const dx = b.lon - a.lon;
        const dy = b.lat - a.lat;
        const lenSq = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((lon - a.lon) * dx + (lat - a.lat) * dy) / lenSq));
        const projLon = a.lon + t * dx;
        const projLat = a.lat + t * dy;
        const dist = Math.hypot(lon - projLon, lat - projLat);
        if (dist < bestDist) {
          bestDist = dist;
          bestIndex = i + 1;
        }
      }
      const next = [...prev];
      next.splice(bestIndex, 0, { lat, lon });
      return next;
    });
  }, []);

  function handleSaveBoundary() {
    setCustomBoundary(editableBoundary);
    setBoundaryVersion((v) => v + 1);
    setBoundarySavedFlash(true);
    window.setTimeout(() => setBoundarySavedFlash(false), 1800);
  }

  function handleResetBoundary() {
    resetCustomBoundary();
    setEditableBoundary(getActiveBoundary());
    setBoundaryVersion((v) => v + 1);
  }

  function handleExportBoundaryGeoJson() {
    const geoJson = boundaryToGeoJson(boundaryEditMode ? editableBoundary : getActiveBoundary());
    const blob = new Blob([JSON.stringify(geoJson, null, 2)], { type: "application/geo+json" });
    const url = URL.createObjectURL(blob);
    // <a download> nollställs tyst i iOS Safari/installerad PWA-standalone-läge
    // (se .agents/memory/pdf-download-attribute-ios-pwa.md) — öppna i en ny
    // flik istället så OS:ets dela/spara-blad tar över på alla plattformar.
    window.open(url, "_blank");
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  return (
    <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-[#090909] text-white">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-[#FFB347]">
            {editHandoff ? "REDIGERA VINDKRAFTSPROJEKTET" : "PLACERA VINDKRAFTVERKEN SJÄLV"}
          </p>
          <p className="text-sm text-white/70">
            {editHandoff
              ? `${editHandoff.projectName} · klicka på ett verk för att flytta/ta bort`
              : "Ericsbergs marker · klicka på kartan för att placera · tryck på ett verk för att flytta/ta bort"}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => navigate("/mina-projekt")}
            className="rounded-full bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20"
          >
            {isAuthenticated ? "☁️ Mina projekt" : "📁 Lokala projekt"}
          </button>
          <button
            onClick={() => { window.location.href = "/vindkraft-karta/"; }}
            className="rounded-full bg-white/10 px-4 py-1.5 text-sm text-white hover:bg-white/20"
          >
            🗺️ Kartan
          </button>
          <button
            onClick={() => navigate("/")}
            className="rounded-full bg-white/10 px-4 py-1.5 text-sm text-white hover:bg-white/20"
          >
            📷 AR
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-white/10 bg-[#0d0d0d] px-4 py-2">
        {!editHandoff && (
          <>
            <button
              onClick={() => setBoundaryDebugMode((v) => !v)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                boundaryDebugMode ? "bg-sky-400 text-[#090909]" : "border border-white/20 bg-white/5 text-white hover:bg-white/10"
              }`}
            >
              🔢 Visa gränspunkter
            </button>
            <button
              onClick={handleToggleBoundaryEdit}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                boundaryEditMode ? "bg-purple-400 text-[#090909]" : "border border-white/20 bg-white/5 text-white hover:bg-white/10"
              }`}
            >
              ✏️ Redigera gräns
            </button>
          </>
        )}
        <button
          onClick={() => setDebugPanelOpen((v) => !v)}
          className={`rounded-full px-3 py-1.5 text-xs font-medium ${
            debugPanelOpen ? "bg-emerald-400 text-[#090909]" : "border border-white/20 bg-white/5 text-white hover:bg-white/10"
          }`}
        >
          🐞 Felsökning (poäng)
        </button>
        <p className="text-[11px] text-white/40">{turbines.length} verk placerade</p>
      </div>

      {boundaryEditMode && (
        <div className="flex flex-wrap items-center gap-2 border-b border-purple-400/30 bg-purple-950/30 px-4 py-2">
          <p className="text-[11px] text-purple-200">
            Dra en punkt för att flytta den · klicka ✕ för att ta bort · klicka på kartan för att lägga till en ny punkt
            {hasCustomBoundary() ? " · anpassad gräns aktiv" : ""}
          </p>
          <div className="ml-auto flex gap-2">
            <button
              onClick={handleResetBoundary}
              className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[11px] font-medium text-white hover:bg-white/10"
            >
              🔄 Återställ gräns
            </button>
            <button
              onClick={handleExportBoundaryGeoJson}
              className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[11px] font-medium text-white hover:bg-white/10"
            >
              📤 Exportera GeoJSON
            </button>
            <button
              onClick={handleSaveBoundary}
              className="rounded-full bg-purple-400 px-3 py-1 text-[11px] font-semibold text-[#090909] hover:bg-purple-300"
            >
              {boundarySavedFlash ? "✅ Sparad!" : "💾 Spara gräns"}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="relative flex-1 min-h-[35dvh] p-3">
        <PlacementMap
          turbines={turbines}
          colorTurbines={committedTurbines}
          initialView={editHandoff ? (() => {
            if (editHandoff.turbines.length === 0) {
              const lat = editHandoff.centerLat ?? 62.5;
              const lon = editHandoff.centerLng ?? 15.5;
              return { centerLat: lat, centerLon: lon, latSpan: 0.3 };
            }
            const lats = editHandoff.turbines.map((t) => t.lat);
            const lons = editHandoff.turbines.map((t) => t.lon);
            const minLat = Math.min(...lats);
            const maxLat = Math.max(...lats);
            const pad = Math.max((maxLat - minLat) * 0.25, 0.06);
            return {
              centerLat: (minLat + maxLat) / 2,
              centerLon: (Math.min(...lons) + Math.max(...lons)) / 2,
              latSpan: Math.min(maxLat - minLat + pad * 2, 2.0),
            };
          })() : undefined}
          onMove={handleMove}
          onAdd={handleAdd}
          onRemove={handleRemove}
          outsideBoundaryIds={result.outsideBoundaryIds}
          showEstateBoundary={showEstateBoundary}
          onLatSpanChange={setCurrentLatSpan}
          boundaryDebugMode={boundaryDebugMode}
          boundaryEditMode={boundaryEditMode}
          editableBoundary={editableBoundary}
          onVertexDrag={handleVertexDrag}
          onVertexRemove={handleVertexRemove}
          onVertexAdd={handleVertexAdd}
          onToggleEstateBoundary={() => setShowEstateBoundary((v) => !v)}
        />

        {debugPanelOpen && (
          <div className="pointer-events-auto absolute right-3 top-3 max-h-[80%] w-80 overflow-y-auto rounded-xl border border-emerald-400/30 bg-black/85 p-3 text-xs text-white shadow-xl">
            <p className="mb-2 font-semibold text-emerald-300">🐞 Felsökning — poängbidrag</p>
            <p className="mb-1 text-white/70">
              Total poäng: <span className="font-semibold text-white">{Math.round(result.totalScore)}</span>/100
            </p>
            <p className="mb-1 text-white/70">
              Närmaste hushåll:{" "}
              <span className="font-semibold text-white">
                {result.nearestHouseholdName ?? "—"}
                {result.nearestHouseholdDistanceM !== null ? ` (${Math.round(result.nearestHouseholdDistanceM)} m)` : ""}
              </span>
            </p>
            <p className="mb-2 text-white/70">
              Avstånd till tätort:{" "}
              <span className="font-semibold text-white">
                {result.nearestUrbanDistanceM !== null ? `${Math.round(result.nearestUrbanDistanceM)} m` : "—"}
              </span>
            </p>

            <p className="mb-1 font-medium text-white/80">Laddade datalager:</p>
            <ul className="mb-2 grid grid-cols-2 gap-x-2 gap-y-0.5 text-white/70">
              <li>
                Hushållskluster: <span className="text-white/90">{result.layerCounts.householdClusters}</span>
              </li>
              <li>
                Naturzoner: <span className="text-white/90">{result.layerCounts.natureZones}</span>
              </li>
              <li>
                Kulturzoner: <span className="text-white/90">{result.layerCounts.culturalZones}</span>
              </li>
              <li>
                Vattenzoner: <span className="text-white/90">{result.layerCounts.waterZones}</span>
              </li>
            </ul>

            <p className="mb-2 text-[10px] text-white/40">Baserat på senast beräknade placering (committedTurbines).</p>

            <p className="mb-1 font-medium text-white/80">Faktorer (bidrag till total poäng):</p>
            <ul className="mb-2 space-y-0.5">
              {result.factors.map((f) => (
                <li key={f.key} className="flex items-center justify-between">
                  <span className="text-white/70">{f.label}</span>
                  <span className={f.impactPoints < 0 ? "text-emerald-300" : "text-white/90"}>
                    {f.impactPoints > 0 ? "+" : ""}
                    {f.impactPoints.toFixed(1)}
                  </span>
                </li>
              ))}
            </ul>

            <p className="mb-1 font-medium text-white/80">Per verk — full felsökningsdata:</p>
            <ul className="space-y-2">
              {result.turbineDebug
                .slice()
                .sort((a, b) => b.totalScore - a.totalScore)
                .map((td) => (
                  <li key={td.id} className="rounded-md border border-white/10 bg-white/5 p-1.5">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-semibold text-white/90">{td.id}</span>
                      <span className="text-white/90">{Math.round(td.totalScore)} p</span>
                    </div>
                    {!td.insideBoundary && (
                      <p className="mb-1 text-[10px] font-medium text-red-300">⚠ Utanför markerat markområde</p>
                    )}
                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-white/60">
                      <span>
                        Hushåll: {td.nearestHouseholdName ?? "—"}
                        {td.nearestHouseholdDistanceM !== null ? ` (${Math.round(td.nearestHouseholdDistanceM)} m)` : ""}
                      </span>
                      
                      <span>Hushåll &lt;1 km: {td.householdsWithin1kmCount}</span>
                      <span>Hushåll &lt;2 km: {td.householdsWithin2kmCount}</span>
                      <span>Hushåll &lt;3 km: {td.householdsWithin3kmCount}</span>
                      <span>Buller: {td.noiseDba !== null ? `${td.noiseDba.toFixed(1)} dBA` : "—"}</span>
                      <span>
                        Natur: {td.nearestNatureName ?? "—"}
                        {td.nearestNatureDistanceM !== null ? ` (${Math.round(td.nearestNatureDistanceM)} m)` : ""}
                      </span>
                      <span>
                        Kultur: {td.nearestCulturalName ?? "—"}
                        {td.nearestCulturalDistanceM !== null ? ` (${Math.round(td.nearestCulturalDistanceM)} m)` : ""}
                      </span>
                      <span>
                        Vatten: {td.nearestWaterName ?? "—"}
                        {td.nearestWaterDistanceM !== null ? ` (${Math.round(td.nearestWaterDistanceM)} m)` : ""}
                      </span>
                      <span>Skuggflimmer: {td.shadowFlickerScore.toFixed(1)}</span>
                      <span>Visuellt: {td.visualScore.toFixed(1)}</span>
                    </div>
                  </li>
                ))}
            </ul>
          </div>
        )}

        {calculating && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
            <div className="flex items-center gap-2 rounded-full bg-black/80 px-4 py-2 text-xs font-medium text-white shadow-lg">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Beräknar påverkan…
            </div>
          </div>
        )}

        {currentLatSpan > 1.2 && (
          <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 bg-black/85 px-4 py-3 shadow-xl backdrop-blur-sm">
            <p className="text-sm font-medium text-white/90">
              🗺️ Vill du gå tillbaka till Sverigekartan?
            </p>
            <button
              onClick={() => { window.location.href = "/vindkraft-karta/"; }}
              className="shrink-0 rounded-full bg-[#FF8B01] px-4 py-1.5 text-xs font-semibold text-[#090909] hover:bg-[#FFB347]"
            >
              Ja, gå tillbaka
            </button>
          </div>
        )}
      </div>

      {result.playfulWarning && !editHandoff && (
        <div className="mx-3 mb-2 rounded-xl border border-yellow-400/30 bg-yellow-500/15 px-3 py-2 text-xs text-yellow-100">
          ⚠️ {result.playfulWarning}
        </div>
      )}

      {editHandoff && contextLoading && (
        <div className="mx-3 mb-1 flex items-center gap-2 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-white/60">
          <span className="animate-spin">⏳</span> Hämtar lokaldata (orter, naturskydd)…
        </div>
      )}
      {editHandoff && !contextLoading && locationContext && (
        <div className="mx-3 mb-1 rounded-lg bg-emerald-900/30 px-3 py-1.5 text-xs text-emerald-300/80">
          📍 {locationContext.settlements.length} orter · {locationContext.protectedAreas.length} skyddade områden hittade
        </div>
      )}

      <PlacementScorePanel
        result={result}
        minimized={scoreMinimized}
        onToggleMinimized={() => setScoreMinimized((v) => !v)}
        showEricsbergFeatures={!editHandoff}
      />
      </div>

      <div className="border-t border-white/10 bg-[#0d0d0d] px-4 py-3">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={handleReset}
            className="rounded-full border border-white/20 bg-white/5 py-2.5 text-xs font-medium text-white hover:bg-white/10"
          >
            🔄 Återställ
          </button>
          <button
            onClick={handleSave}
            disabled={savingToCloud}
            className="rounded-full border border-white/20 bg-white/5 py-2.5 text-xs font-medium text-white hover:bg-white/10 disabled:opacity-50"
          >
            {savingToCloud ? "☁️ Sparar…" : savedFlash ? (isAuthenticated ? "✅ Sparad i molnet!" : "✅ Sparad lokalt!") : "💾 Spara placering"}
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

      {/* Login-gate modal */}
      {showLoginGate && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 pb-10 sm:items-center sm:pb-0">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#141414] px-6 py-7 text-white shadow-2xl">
            <button
              onClick={() => setShowLoginGate(false)}
              className="absolute right-4 top-4 text-white/40 hover:text-white"
              aria-label="Stäng"
            >
              ✕
            </button>
            <p className="mb-1 text-lg font-semibold">Logga in för att spara i molnet</p>
            <p className="mb-5 text-sm text-white/60">
              Placeringen är sparad lokalt på din enhet. Logga in för att synkronisera till molnet
              och nå den från alla enheter.
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => { setShowLoginGate(false); login(); }}
                className="w-full rounded-full bg-[#FF8B01] py-3 text-sm font-semibold text-[#090909]"
              >
                Logga in
              </button>
              <button
                onClick={() => setShowLoginGate(false)}
                className="w-full rounded-full border border-white/20 py-3 text-sm text-white/70 hover:bg-white/5"
              >
                Behåll lokalt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
