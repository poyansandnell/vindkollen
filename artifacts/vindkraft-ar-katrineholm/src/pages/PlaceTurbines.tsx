import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { apiUrl } from "@/lib/apiUrl";
import { consumeDirectEditorFlag, consumeFreshPlaceraFlag, isNative } from "@/lib/capacitorBridge";
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
import { type ApiProjectArea } from "@/lib/bundledProjects";
import { generateProjectGrid, translateDefaultTurbines } from "@/lib/projectGridLayout";
import { NationalMapView } from "@/components/NationalMapView";

const SAVED_KEY = "vindkraft-ar-katrineholm:savedPlacements";
const AR_HANDOFF_KEY = "vindkraft-ar-katrineholm:customPlacement";
const EDIT_HANDOFF_KEY = "vindkraft:editHandoff";

// ─── API-typer och hjälpfunktioner för nationellt projektläge ─────────────
// ApiProjectArea importeras från @/lib/bundledProjects — delas med bundlade projekt.


/** Konverterar API GeoJSON Polygon/MultiPolygon till LatLon[] för gränseditorn. */
function apiPolygonToLatLon(polygon: ApiProjectArea["polygon"]): LatLon[] | null {
  if (!polygon?.coordinates) return null;
  const { type, coordinates } = polygon;
  let ring: unknown[];
  if (type === "Polygon" && Array.isArray(coordinates)) {
    ring = (coordinates as unknown[][])[0];
  } else if (type === "MultiPolygon" && Array.isArray(coordinates)) {
    ring = ((coordinates as unknown[][][])[0])[0];
  } else {
    return null;
  }
  if (!Array.isArray(ring) || ring.length < 3) return null;
  return (ring as [number, number][]).map(([lon, lat]) => ({ lat, lon }));
}



interface EditHandoff {
  projectId?: string;
  projectName: string;
  municipality?: string;
  turbines: { id: string; lat: number; lon: number }[];
  centerLat?: number | null;
  centerLng?: number | null;
  /** GeoJSON-polygonens ytterring, om känd, som LatLon[]. */
  boundary?: { lat: number; lon: number }[] | null;
  savedAt: number;
}

/** Typ som används som React-state — speglar EditHandoff men med PlacedTurbine[]. */
type ActiveEditHandoff = {
  projectId?: string;
  projectName: string;
  municipality?: string;
  turbines: PlacedTurbine[];
  centerLat?: number | null;
  centerLng?: number | null;
  boundary?: LatLon[] | null;
};

function consumeEditHandoff(): ActiveEditHandoff | null {
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
      projectId: data.projectId,
      projectName: data.projectName,
      municipality: data.municipality,
      turbines: data.turbines.map((t) => ({ id: t.id, lat: t.lat, lon: t.lon })),
      centerLat: data.centerLat ?? null,
      centerLng: data.centerLng ?? null,
      boundary: data.boundary ?? null,
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
  const [editHandoff, setEditHandoff] = useState<ActiveEditHandoff | null>(consumeEditHandoff);
  // Välkomstläge: sant när användaren navigerade hit "fresh" från hemvyn via
  // openSverigekartan() på native — inte via AR-handoff. Flaggan konsumeras
  // engångs ur sessionStorage. Om välkomstläge: tom karta som startläge.
  const [showWelcome, setShowWelcome] = useState<boolean>(() => {
    const fresh = consumeFreshPlaceraFlag();
    // consumeDirectEditorFlag() konsumeras EFTER consumeFreshPlaceraFlag() —
    // den sätts av "Visa karta" i AR-vyn och hoppar direkt till editor-läge.
    const direct = consumeDirectEditorFlag();
    const hasHandoff = editHandoff !== null;
    // "Visa karta"-flödet: hoppa alltid direkt till editor, oavsett plattform.
    if (direct) return false;
    // På native: visa alltid Sverigekartan när det inte finns en sparad
    // projektreferens i localStorage. Förhindrar tyst fallback till
    // Katrineholms standardprojekt när sessionStorage-flaggan inte läses
    // (t.ex. om komponenten redan är monterad vid navigering).
    if (isNative() && !hasHandoff) return true;
    return fresh && !hasHandoff;
  });
  const initialTurbines = (editHandoff?.turbines?.length ? editHandoff.turbines : null) ?? (showWelcome ? [] : DEFAULT_TURBINES);
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
  const [nationalTurbinesLoading, setNationalTurbinesLoading] = useState(false);
  // Betraktarposition — sätts manuellt av användaren för att simulera AR-vy
  // från en viss plats utan att behöva befinna sig där fysiskt.
  const [viewerPos, setViewerPos] = useState<{ lat: number; lon: number } | null>(null);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lon: number }>({
    lat: editHandoff?.centerLat ?? 59.0,
    lon: editHandoff?.centerLng ?? 16.3,
  });
  const [showingViewerPosMode, setShowingViewerPosMode] = useState(false);
  // Onboarding-modal: visas första gången redigeringsläget öppnas.
  const ONBOARDING_KEY = "vindkraft-ar-katrineholm:editmode-onboarding-seen";
  const [showOnboarding, setShowOnboarding] = useState<boolean>(
    () => !localStorage.getItem(ONBOARDING_KEY),
  );

  // Global runtime-diagnostik — fångar JavaScript-krascher och oupphantade
  // promise-avvisanden som annars bara syns som vit skärm.
  useEffect(() => {
    const onError = (ev: ErrorEvent) => {
      console.error("[PlaceTurbines] GLOBAL ERROR", ev.error ?? ev.message, ev.filename, ev.lineno);
    };
    const onUnhandled = (ev: PromiseRejectionEvent) => {
      console.error("[PlaceTurbines] UNHANDLED REJECTION", ev.reason);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandled);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandled);
    };
  }, []);

  // Initialisera/uppdatera editableBoundary från projektets polygon när
  // editHandoff sätts — antingen vid mount (från localStorage) eller direkt
  // från NationalMapViews "Öppna projektet". Kör inte om editHandoff saknar polygon.
  useEffect(() => {
    if (editHandoff?.boundary && editHandoff.boundary.length >= 3) {
      setEditableBoundary(editHandoff.boundary);
      setBoundaryVersion((v) => v + 1);
    }
  }, [editHandoff]);

  // Hämta verk från API för att förbättra/förfina rutnätet.
  // Körs ALLTID när vi har editHandoff med centerLat/Lng.
  useEffect(() => {
    const projectId = editHandoff?.projectId;
    if (!projectId) return;
    const centerLat = editHandoff?.centerLat;
    const centerLng = editHandoff?.centerLng;
    if (!centerLat || !centerLng) return;

    let cancelled = false;
    setNationalTurbinesLoading(true);

    const turbineCount = editHandoff?.turbines?.length ?? 8;
    const delta = Math.max(0.15, Math.min(0.5, Math.sqrt(turbineCount) * 0.06));
    const minLat = (centerLat - delta).toFixed(5);
    const maxLat = (centerLat + delta).toFixed(5);
    const minLng = (centerLng - delta * 2.0).toFixed(5);
    const maxLng = (centerLng + delta * 2.0).toFixed(5);
    const url = apiUrl(
      `/api/wind/turbines?minLat=${minLat}&maxLat=${maxLat}&minLng=${minLng}&maxLng=${maxLng}&limit=200`,
    );

    console.log("[PlaceTurbines] Hämtar nationella verk", {
      projectId, centerLat, centerLng, delta, preloadedCount: editHandoff?.turbines?.length ?? 0,
    });

    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ id: number; lat?: number; lng?: number; projectAreaId?: number | null }[]>;
      })
      .then((data) => {
        if (cancelled) return;
        const numId = parseInt(projectId, 10);

        // V15: BARA projectAreaId-specifika verk får ersätta preloaded.
        // Om API:et inte har exakt det projektets verk (byId.length < 3),
        // BEHÅLL preloaded rutnät/DEFAULT_TURBINES — annars förstör vi
        // Ericsbergs exakta 8 verk med 33 slumpmässiga från bbox.
        const byId = data.filter(
          (t) => typeof t.lat === "number" && typeof t.lng === "number" && t.projectAreaId === numId,
        );

        console.log("[PlaceTurbines] Verk hämtade", {
          projectId,
          allFromApi: data.length,
          byProjectAreaId: byId.length,
          willOverride: byId.length >= 3,
        });

        if (byId.length < 3) {
          // Inte tillräckligt många projectAreaId-träffar — behåll preloaded
          setNationalTurbinesLoading(false);
          return;
        }

        const placed: PlacedTurbine[] = byId.map((t) => ({
          id: `nt-${t.id}`,
          lat: t.lat as number,
          lon: t.lng as number,
        }));

        setTurbines(placed);
        setCommittedTurbines(placed);
        setNationalTurbinesLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn("[PlaceTurbines] API fail, behåller rutnät:", err);
          setNationalTurbinesLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [editHandoff?.projectId, editHandoff?.centerLat, editHandoff?.centerLng]);
  const [boundarySavedFlash, setBoundarySavedFlash] = useState(false);
  const [currentLatSpan, setCurrentLatSpan] = useState<number>(0.25);
  const [locationContext, setLocationContext] = useState<LocationContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [geoJsonModalText, setGeoJsonModalText] = useState<string | null>(null);
  const [geoJsonCopied, setGeoJsonCopied] = useState(false);

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
  // `ctx`-parametern styr bl.a. om "Utanför Ericsbergs marker"-kontrollen
  // körs. I editHandoff-läge (nationellt/Sverigeläge) är gränsen inte
  // relevant — vi skickar alltid en (tom) sentinel så att kontrollen
  // hoppas över oavsett om `locationContext` ännu laddats klart.
  const result = useMemo(
    () => scorePlacement(
      committedTurbines,
      editHandoff ? (locationContext ?? { settlements: [], protectedAreas: [] }) : undefined,
    ),
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
    // I redigeringsläge (nationellt projekt): återställ till tomt — verk laddas
    // om via API-effekten om editHandoff fortfarande är satt.
    const resetTo = editHandoff ? [] : DEFAULT_TURBINES;
    setTurbines(resetTo);
    setCommittedTurbines(resetTo);
    setViewerPos(null);
    setShowingViewerPosMode(false);
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
    localStorage.setItem(
      AR_HANDOFF_KEY,
      JSON.stringify({
        turbines,
        savedAt: Date.now(),
        ...(viewerPos ? { viewerLat: viewerPos.lat, viewerLon: viewerPos.lon } : {}),
      }),
    );
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

  // Öppna editor direkt från Sverigekartan. Definieras som useCallback eftersom
  // den skickas som prop till NationalMapView (stabila referensen minskar re-renders).
  // MÅSTE definieras före if(showWelcome)-returnstatementen (React hooks-regeln).
  const handleEnterEditorDirect = useCallback((project: ApiProjectArea) => {
    const boundary = apiPolygonToLatLon(project.polygon ?? null);
    const isBundledKatrineholm = project.id === 10001;
    const turbineCount = project.turbineCountPlannedMin ?? project.turbineCountPlannedMax ?? 8;
    const hasCoords = typeof project.centerLat === 'number' && typeof project.centerLng === 'number';

    const preloadedTurbines = (() => {
      if (isBundledKatrineholm) return DEFAULT_TURBINES;
      if (!hasCoords) return [];
      if (boundary && boundary.length >= 3) {
        return generateProjectGrid(project.centerLat!, project.centerLng!, turbineCount, boundary);
      }
      if (turbineCount <= 10) {
        return translateDefaultTurbines(project.centerLat!, project.centerLng!, turbineCount);
      }
      return generateProjectGrid(project.centerLat!, project.centerLng!, turbineCount, null);
    })();

    setEditHandoff({
      projectId: String(project.id),
      projectName: project.name,
      municipality: project.kommun ?? undefined,
      turbines: preloadedTurbines,
      centerLat: project.centerLat ?? null,
      centerLng: project.centerLng ?? null,
      boundary,
    });
    setTurbines(preloadedTurbines);
    setCommittedTurbines(preloadedTurbines);
    setShowWelcome(false);
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
    const text = JSON.stringify(geoJson, null, 2);
    if (isNative()) {
      // Capacitor WKWebView blockerar window.open med _blank för Blob-URL:er —
      // visa GeoJSON-texten i en modal med kopieringsknapp istället.
      setGeoJsonModalText(text);
      setGeoJsonCopied(false);
    } else {
      // Webb/PWA: öppna i ny flik — <a download> nollställs tyst i iOS Safari/PWA
      // (se .agents/memory/pdf-download-attribute-ios-pwa.md), ny-flik-metoden
      // låter OS:ets dela/spara-blad ta över på alla plattformar.
      const blob = new Blob([text], { type: "application/geo+json" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
  }

  // Nationell landningssida: visas när användaren öppnar Sverigekartan
  // "fresh" från hemvyn (sessionStorage-flagga). PlacementMap monteras INTE
  // — den monteras alltid färsk vid övergången till editorn, vilket garanterar
  // att den börjar på rätt Ericsberg-zoomnivå och att inga tiles laddas i
  // onödan bakom overlayen.
  if (showWelcome) {
    return (
      <NationalMapView
        onEnterEditorDirect={handleEnterEditorDirect}
        onBack={() => navigate("/")}
      />
    );
  }

  return (
    <div className="relative flex h-[100svh] w-full flex-col overflow-hidden bg-[#090909] text-white">

      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-[#FFB347]">
            {editHandoff ? "REDIGERA PLACERING" : "PLACERA VINDKRAFTVERKEN SJÄLV"}
          </p>
          <p className="text-sm text-white/70">
            {editHandoff
              ? `${editHandoff.projectName}${editHandoff.municipality ? ` · ${editHandoff.municipality}` : ""} · klicka på ett verk för att flytta/ta bort`
              : "Klicka på kartan för att placera vindkraftverken · tryck på ett verk för att flytta/ta bort"}
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
            onClick={() => {
              // Vi är redan på #/placera — setShowWelcome(true) visar NationalMapView
              // direkt utan att navigera bort (tillförlitligt på native).
              setShowWelcome(true);
            }}
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
          <button
            onClick={() => {
              localStorage.setItem(ONBOARDING_KEY, "");
              localStorage.removeItem(ONBOARDING_KEY);
              setShowOnboarding(true);
            }}
            className="rounded-full bg-white/10 px-3 py-1.5 text-sm text-white/60 hover:bg-white/20"
            aria-label="Visa hjälp"
          >
            ?
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
        <p className="text-[11px] text-white/40">
          {nationalTurbinesLoading ? "Hämtar verk…" : `${turbines.length} verk placerade`}
        </p>
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
          isGenericMode={!!editHandoff}
          initialView={
            editHandoff ? (() => {
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
            })()
            : undefined
          }
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
          onCenterChange={(lat, lon) => setMapCenter({ lat, lon })}
          viewerPos={viewerPos}
          showViewerCrosshair={showingViewerPosMode}
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
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 bg-black/85 px-4 py-3 shadow-xl backdrop-blur-sm">
            <p className="text-sm font-medium text-white/90">
              🗺️ Vill du gå tillbaka till Sverigekartan?
            </p>
            <button
              onClick={() => setShowWelcome(true)}
              className="pointer-events-auto shrink-0 rounded-full bg-[#FF8B01] px-4 py-1.5 text-xs font-semibold text-[#090909] hover:bg-[#FFB347]"
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

      <div className="border-t border-white/10 bg-[#0d0d0d] px-4 pt-3 pb-[max(env(safe-area-inset-bottom),12px)]">

        {/* "Se härifrån"-banner: visas när betraktarpositionsläget är aktivt */}
        {showingViewerPosMode && (
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-blue-400/30 bg-blue-900/40 px-3 py-2 text-xs text-blue-200">
            <span className="flex-1">🎯 Panorera kartan till platsen du vill stå på, tryck ✓ för att bekräfta</span>
            <button
              onClick={() => { setViewerPos(mapCenter); setShowingViewerPosMode(false); }}
              className="shrink-0 rounded-full bg-blue-500 px-3 py-1 text-xs font-bold text-white hover:bg-blue-400"
            >
              ✓
            </button>
            <button
              onClick={() => setShowingViewerPosMode(false)}
              className="shrink-0 text-blue-300 hover:text-white"
            >
              ✕
            </button>
          </div>
        )}

        {/* Betraktarpositions-banner: visas när en position är satt */}
        {viewerPos && !showingViewerPosMode && (
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-blue-400/30 bg-blue-900/40 px-3 py-2 text-xs text-blue-200">
            <span className="flex-1">
              👤 Visningsposition satt · AR-vyn visar utsikten härifrån
            </span>
            <button
              onClick={() => setShowingViewerPosMode(true)}
              className="shrink-0 text-blue-300 hover:text-white"
              title="Ändra position"
            >
              ✎
            </button>
            <button
              onClick={() => setViewerPos(null)}
              className="shrink-0 text-blue-300 hover:text-white"
              title="Rensa position"
            >
              ✕
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={handleReset}
            className="rounded-full border border-white/20 bg-white/5 py-2.5 text-xs font-medium text-white hover:bg-white/10"
          >
            🔄 Återställ allt
          </button>
          <button
            onClick={handleSave}
            disabled={savingToCloud}
            className="rounded-full border border-white/20 bg-white/5 py-2.5 text-xs font-medium text-white hover:bg-white/10 disabled:opacity-50"
          >
            {savingToCloud ? "☁️ Sparar…" : savedFlash ? (isAuthenticated ? "✅ Sparad i molnet!" : "✅ Sparad lokalt!") : "💾 Spara placering"}
          </button>
          <button
            onClick={() => setShowingViewerPosMode((v) => !v)}
            className={`rounded-full border py-2.5 text-xs font-medium hover:opacity-80 ${
              viewerPos
                ? "border-blue-400/40 bg-blue-500/15 text-blue-200"
                : showingViewerPosMode
                  ? "border-blue-400/40 bg-blue-500/25 text-blue-100"
                  : "border-white/20 bg-white/5 text-white"
            }`}
          >
            {viewerPos ? "👤 Ändra position" : "👤 Se härifrån"}
          </button>
          <button
            onClick={handleViewInAr}
            className="rounded-full bg-[#FF8B01] py-2.5 text-xs font-semibold text-[#090909] hover:bg-[#FFB347]"
          >
            👁️ Se i AR
          </button>
        </div>
        {editHandoff && (
          <button
            onClick={() => {
              localStorage.removeItem(AR_HANDOFF_KEY);
              navigate("/");
            }}
            className="mt-2 w-full rounded-full border border-white/10 bg-white/[0.03] py-2 text-[11px] font-medium text-white/50 hover:bg-white/10 hover:text-white/70"
          >
            📍 Närmaste verk (mitt GPS-läge) → AR
          </button>
        )}

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

      {/* GeoJSON-export modal — visas enbart på native (Capacitor WKWebView
          blockerar window.open+Blob-URL:er); på webben används ny-flik-export
          direkt i handleExportBoundaryGeoJson ovan. */}
      {geoJsonModalText !== null && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:items-center sm:pb-0">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#141414] px-5 py-5 text-white shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold">Exportera gräns (GeoJSON)</p>
              <button
                onClick={() => setGeoJsonModalText(null)}
                aria-label="Stäng GeoJSON-export"
                className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/70 hover:bg-white/20"
              >
                ✕ Stäng
              </button>
            </div>
            <textarea
              readOnly
              value={geoJsonModalText}
              className="mb-3 h-44 w-full resize-none rounded-xl bg-black/50 p-3 font-mono text-[11px] leading-relaxed text-white/80 ring-1 ring-white/10"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(geoJsonModalText);
                  setGeoJsonCopied(true);
                  window.setTimeout(() => setGeoJsonCopied(false), 2500);
                } catch {
                  // Clipboard API misslyckades — textytan är readonly och
                  // autofokusas på focus-event, användaren kan markera manuellt.
                }
              }}
              className="w-full rounded-full bg-[#FF8B01] py-3 text-sm font-semibold text-[#090909] transition hover:bg-[#FFB347]"
            >
              {geoJsonCopied ? "✓ Kopierat!" : "📋 Kopiera GeoJSON"}
            </button>
            <p className="mt-2 text-center text-[11px] text-white/40">
              Klistra in i en GeoJSON-visare, t.ex. geojson.io
            </p>
          </div>
        </div>
      )}

      {/* Onboarding-modal — visas första gången redigeringsläget öppnas */}
      {showOnboarding && !showWelcome && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 px-4 pb-10 sm:items-center sm:pb-0">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#141414] px-6 py-7 text-white shadow-2xl">
            <p className="mb-1 text-lg font-semibold">🌬️ Placera vindkraftverken</p>
            <p className="mb-4 text-sm text-white/60">
              Flytta, lägg till och ta bort vindkraftverk direkt på kartan. Se hur placeringen påverkar
              naturen, byborna och ljudmiljön — i realtid.
            </p>
            <ul className="mb-5 space-y-2 text-sm text-white/80">
              <li>✚ <span className="text-white/60">Tryck på tom yta</span> för att lägga till ett verk</li>
              <li>✋ <span className="text-white/60">Tryck på ett verk</span> för att flytta eller ta bort det</li>
              <li>👤 <span className="text-white/60">"Se härifrån"</span> väljer betraktarposition för AR-vyn</li>
              <li>👁️ <span className="text-white/60">"Se i AR"</span> skickar placeringen till kameravyn</li>
            </ul>
            <button
              onClick={() => {
                localStorage.setItem(ONBOARDING_KEY, "1");
                setShowOnboarding(false);
              }}
              className="w-full rounded-full bg-[#FF8B01] py-3 text-sm font-semibold text-[#090909] hover:bg-[#FFB347]"
            >
              Kom igång
            </button>
          </div>
        </div>
      )}

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
