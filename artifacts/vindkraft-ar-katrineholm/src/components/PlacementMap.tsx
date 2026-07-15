import { useEffect, useMemo, useRef, useState } from "react";
import {
  ERICSBERG_CENTER,
  ERICSBERG_ESTATE_AREA,
  HOUSEHOLD_CLUSTERS,
  KATRINEHOLM_CENTER,
  POSITIVE_ZONES,
  SENSITIVE_ZONES,
  getActiveBoundary,
  type LatLon,
} from "@/lib/ericsbergArea";
import {
  ESRI_WORLD_IMAGERY_URL,
  METERS_PER_DEGREE_LAT,
  computeTileLayout,
  fitBoundsToAspect,
  makeProjector,
  type LatLonBounds,
} from "@/lib/webMercatorTiles";
import { impactScoreToColor, scorePlacement, type PlacedTurbine } from "@/lib/placementScoring";

interface PlacementMapProps {
  turbines: PlacedTurbine[];
  /**
   * Ett "efterlagt" snapshot av turbines som styr markörfärg/påverkanspoäng
   * (se PlaceTurbines.tsx). Under "Beräknar påverkan…" visar kartan
   * fortfarande de GAMLA färgerna tills föräldern byter till den nya
   * snapshoten — det ger den mjuka, begripliga omräkningen som efterfrågats
   * istället för att allt hoppar direkt.
   */
  colorTurbines: PlacedTurbine[];
  /** Åsidosätter default-vyn (centrerad på Ericsberg/Katrineholm) — används
   *  när ett handoff-projekt från Sverigekartan öppnas. */
  initialView?: { centerLat: number; centerLon: number; latSpan: number };
  onMove: (id: string, lat: number, lon: number) => void;
  onAdd: (lat: number, lon: number) => void;
  onRemove: (id: string) => void;
  outsideBoundaryIds: string[];
  showEstateBoundary: boolean;
  onToggleEstateBoundary?: () => void;
  /** Anropas när kartans latSpan (zoom-nivå) ändras — används av förälder för att visa "← Sverigekartan"-knapp. */
  onLatSpanChange?: (latSpan: number) => void;
  /**
   * Redigeringsläge för markgränserna: visar numrerade hörnpunkter (med
   * lat/lon) för både placeringsgränsen och "Ericsbergs mark"-polygonen, så
   * de kan verifieras visuellt mot referensbilder/PDF:er och redigeras i
   * `ericsbergBoundaryData.ts` — se `PlaceTurbines.tsx`s "🛠️
   * Redigeringsläge (gräns)"-knapp.
   */
  boundaryDebugMode?: boolean;
  /**
   * Interaktivt gränsredigeringsläge: visar `editableBoundary`s hörnpunkter
   * som dragbara markörer, låter användaren klicka på tomt utrymme för att
   * lägga till en ny punkt (infogas vid närmsta kant) och ta bort en punkt
   * via dess ✕-knapp. Se `PlaceTurbines.tsx`s "✏️ Redigera gräns"-knapp.
   */
  boundaryEditMode?: boolean;
  editableBoundary?: LatLon[];
  onVertexDrag?: (index: number, lat: number, lon: number) => void;
  onVertexRemove?: (index: number) => void;
  onVertexAdd?: (lat: number, lon: number) => void;
}

const MAX_TILES = 48;
const MAX_ZOOM = 17;
const RETINA_ZOOM_BIAS = typeof window !== "undefined" && window.devicePixelRatio >= 2 ? 1 : 0;

const ZONE_COLORS: Record<string, string> = {
  nature: "#34d399",
  cultural: "#c084fc",
  water: "#38bdf8",
  riksintresse: "#2dd4bf",
  planering: "#facc15",
};

/** Klick/drag under detta antal pixlar räknas som ett klick, inte en panorering. */
const CLICK_MOVE_THRESHOLD_PX = 6;
const MIN_LAT_SPAN = 0.004;
const MAX_LAT_SPAN = 2.0;
/** Väntetid innan ett enkelklick körs, för att kunna upptäcka ett dubbeltryck (zoom). */
const DOUBLE_TAP_WINDOW_MS = 280;
const DOUBLE_TAP_MAX_DIST_PX = 30;
/** Hur länge flytt-animationen (gammal→ny position) visas innan den försvinner. */
const MOVE_ANIM_DURATION_MS = 900;
const PENDING_COLOR = "#9ca3af";

interface ViewState {
  centerLat: number;
  centerLon: number;
  latSpan: number;
}

interface ContextMenuState {
  id: string;
  xPct: number;
  yPct: number;
}

interface MoveModeState {
  id: string;
  fromLat: number;
  fromLon: number;
}

interface MoveAnimState {
  id: string;
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
  fading: boolean;
}

/**
 * Startvyn ska vara en översiktskarta som visar hela regionen på en gång:
 * Katrineholm, Ericsbergs marker, Forssjö, Björkvik (via HOUSEHOLD_CLUSTERS)
 * och de placerade vindkraftverken (som nu utgår från deras verkliga
 * planerade koordinater, se PlaceTurbines.tsx) — så användaren direkt förstår
 * hur nära varandra allt ligger, istället för att bara zooma in på
 * Ericsbergs egen markgräns.
 */
function computeDefaultView(turbines: PlacedTurbine[]): ViewState {
  const activeBoundary = getActiveBoundary();
  const lats = activeBoundary.map((p) => p.lat);
  const lons = activeBoundary.map((p) => p.lon);
  for (const z of [...SENSITIVE_ZONES, ...POSITIVE_ZONES]) {
    lats.push(z.lat);
    lons.push(z.lon);
  }
  for (const h of HOUSEHOLD_CLUSTERS) {
    lats.push(h.lat);
    lons.push(h.lon);
  }
  lats.push(KATRINEHOLM_CENTER.lat);
  lons.push(KATRINEHOLM_CENTER.lon);
  for (const t of turbines) {
    lats.push(t.lat);
    lons.push(t.lon);
  }
  const minLatRaw = Math.min(...lats);
  const maxLatRaw = Math.max(...lats);
  const minLonRaw = Math.min(...lons);
  const maxLonRaw = Math.max(...lons);
  const padLat = (maxLatRaw - minLatRaw) * 0.15 || 0.003;
  return {
    centerLat: (minLatRaw + maxLatRaw) / 2,
    centerLon: (minLonRaw + maxLonRaw) / 2,
    latSpan: maxLatRaw - minLatRaw + padLat * 2,
  };
}

function boundsFromView(view: ViewState, containerAspect: number): LatLonBounds {
  const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos((view.centerLat * Math.PI) / 180);
  const latSpanMeters = view.latSpan * METERS_PER_DEGREE_LAT;
  const lonSpanMeters = latSpanMeters * containerAspect;
  const lonSpan = lonSpanMeters / metersPerDegreeLon;
  const raw: LatLonBounds = {
    minLat: view.centerLat - view.latSpan / 2,
    maxLat: view.centerLat + view.latSpan / 2,
    minLon: view.centerLon - lonSpan / 2,
    maxLon: view.centerLon + lonSpan / 2,
  };
  return fitBoundsToAspect(raw, containerAspect);
}

export function PlacementMap({
  turbines,
  colorTurbines,
  initialView,
  onMove,
  onAdd,
  onRemove,
  outsideBoundaryIds,
  showEstateBoundary,
  onToggleEstateBoundary,
  onLatSpanChange,
  boundaryDebugMode = false,
  boundaryEditMode = false,
  editableBoundary,
  onVertexDrag,
  onVertexRemove,
  onVertexAdd,
}: PlacementMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 1, height: 1 });
  const [castleOpen, setCastleOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [view, setView] = useState<ViewState>(() => initialView ?? computeDefaultView(turbines));

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [moveMode, setMoveMode] = useState<MoveModeState | null>(null);
  const [moveAnim, setMoveAnim] = useState<MoveAnimState | null>(null);
  const [infoId, setInfoId] = useState<string | null>(null);

  const panRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startCenterLat: number;
    startCenterLon: number;
    moved: boolean;
    suppressClick: boolean;
  } | null>(null);
  const pinchRef = useRef<{ distance: number; latSpan: number } | null>(null);
  const pendingTapRef = useRef<{ clientX: number; clientY: number; timer: number } | null>(null);
  const lastTapRef = useRef<{ time: number; clientX: number; clientY: number } | null>(null);
  const moveAnimTimerRef = useRef<number | null>(null);
  const vertexDragRef = useRef<{ pointerId: number; index: number } | null>(null);
  const pendingViewUpdateRef = useRef<((v: ViewState) => ViewState) | null>(null);
  const viewUpdateRafRef = useRef<number | null>(null);

  // Kartan "hänger sig" (mest märkbart vid tvåfingers pinch-zoom, men även
  // vid snabb panorering) berodde på att VARJE rå touchmove/pointermove-
  // händelse (ofta betydligt fler än 60/s på riktiga enheter) körde en synkron
  // `setView` -> omräkning av `bounds`/`project`/`tiles` -> upp till
  // `MAX_TILES` nya <img>-src-byten. Genom att bara spara den SENASTE
  // beräknade view-uppdateringen och applicera den en gång per
  // animationsframe (requestAnimationFrame) begränsas kartans omräkningar
  // till skärmens uppdateringsfrekvens istället för till pekhändelsernas —
  // pekningen känns fortfarande direkt eftersom det alltid är den senaste
  // positionen som vinner, bara redundanta mellansteg hoppas över.
  function scheduleViewUpdate(updater: (v: ViewState) => ViewState) {
    pendingViewUpdateRef.current = updater;
    if (viewUpdateRafRef.current !== null) return;
    viewUpdateRafRef.current = window.requestAnimationFrame(() => {
      viewUpdateRafRef.current = null;
      const pending = pendingViewUpdateRef.current;
      pendingViewUpdateRef.current = null;
      if (pending) setView(pending);
    });
  }

  useEffect(
    () => () => {
      if (viewUpdateRafRef.current !== null) window.cancelAnimationFrame(viewUpdateRafRef.current);
    },
    [],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setContainerSize({ width: rect.width, height: rect.height });
    };
    update();
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(el);
    window.addEventListener("resize", update);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(
    () => () => {
      if (pendingTapRef.current) window.clearTimeout(pendingTapRef.current.timer);
      if (moveAnimTimerRef.current) window.clearTimeout(moveAnimTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    onLatSpanChange?.(view.latSpan);
  }, [view.latSpan, onLatSpanChange]);

  const containerAspect = containerSize.width / containerSize.height || 1;
  const aspectX = containerSize.height / (containerSize.width || 1);
  const bounds = useMemo(() => boundsFromView(view, containerAspect), [view, containerAspect]);
  const project = useMemo(() => makeProjector(bounds), [bounds]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const listener = (e: WheelEvent) => {
      e.preventDefault();
      zoomByFactor(e.deltaY);
    };
    el.addEventListener("wheel", listener, { passive: false });
    return () => el.removeEventListener("wheel", listener);
  }, []);

  function unproject(x: number, y: number): LatLon {
    const lon = bounds.minLon + (x / 100) * (bounds.maxLon - bounds.minLon);
    const lat = bounds.minLat + ((100 - y) / 100) * (bounds.maxLat - bounds.minLat);
    return { lat, lon };
  }

  const { tiles } = useMemo(
    () =>
      computeTileLayout(bounds, project, {
        maxTiles: MAX_TILES,
        maxZoom: MAX_ZOOM,
        retinaZoomBias: RETINA_ZOOM_BIAS,
        tileUrlTemplate: ESRI_WORLD_IMAGERY_URL,
      }),
    [bounds, project],
  );

  const resolvedBoundary = boundaryEditMode && editableBoundary ? editableBoundary : getActiveBoundary();

  const boundaryPoints = useMemo(
    () => resolvedBoundary.map((p) => project(p.lat, p.lon)).map((p) => `${p.x},${p.y}`).join(" "),
    [project, resolvedBoundary],
  );

  const estateAreaPoints = useMemo(
    () => ERICSBERG_ESTATE_AREA.map((p) => project(p.lat, p.lon)).map((p) => `${p.x},${p.y}`).join(" "),
    [project],
  );

  // Krascher vid zoom/pan berodde delvis på att varje verks påverkanspoäng
  // räknades om synkront i varje render (inkl. varje panoreringssteg), även
  // när verkens positioner inte hade ändrats. Genom att bara härleda det här
  // en gång per `colorTurbines`-ändring (den efterlagda snapshoten, se
  // PlaceTurbines.tsx) hålls pan/zoom-renderingar lätta oavsett hur många
  // verk som finns.
  const colorById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of colorTurbines) {
      const isOutside = outsideBoundaryIds.includes(t.id);
      const soloScore = scorePlacement([t]).totalScore;
      map.set(t.id, isOutside ? "#ef4444" : impactScoreToColor(soloScore));
    }
    return map;
  }, [colorTurbines, outsideBoundaryIds]);

  const turbineRadius = Math.max(0.5, Math.min(2.8, 1.2 / (view.latSpan * 8)));
  const showHouseholdLabels = view.latSpan < 0.18;
  const showTurbineLabels = view.latSpan < 0.14;

  function zoneRadiusPercent(radiusM: number, lat: number) {
    const metersPerDegreeLat = METERS_PER_DEGREE_LAT;
    const degLat = radiusM / metersPerDegreeLat;
    const p1 = project(lat, 0);
    const p2 = project(lat + degLat, 0);
    return Math.abs(p2.y - p1.y);
  }

  function clientToPercent(clientX: number, clientY: number): { x: number; y: number } | null {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: Math.min(Math.max(((clientX - rect.left) / rect.width) * 100, 0), 100),
      y: Math.min(Math.max(((clientY - rect.top) / rect.height) * 100, 0), 100),
    };
  }

  function clientToLatLon(clientX: number, clientY: number): LatLon | null {
    const p = clientToPercent(clientX, clientY);
    return p ? unproject(p.x, p.y) : null;
  }

  function closeMenusAndModes(): boolean {
    let hadSomethingOpen = false;
    if (menu) {
      setMenu(null);
      hadSomethingOpen = true;
    }
    if (castleOpen) {
      setCastleOpen(false);
      hadSomethingOpen = true;
    }
    if (infoId) {
      setInfoId(null);
      hadSomethingOpen = true;
    }
    return hadSomethingOpen;
  }

  function handleMarkerPointerDown(e: React.PointerEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    if (moveMode) return; // väntar redan på ett tryck för att flytta ett annat verk
    const p = project(turbines.find((t) => t.id === id)?.lat ?? 0, turbines.find((t) => t.id === id)?.lon ?? 0);
    setCastleOpen(false);
    setInfoId(null);
    setMenu({ id, xPct: p.x, yPct: p.y });
  }

  function commitMove(id: string, lat: number, lon: number) {
    const current = turbines.find((t) => t.id === id);
    onMove(id, lat, lon);
    if (current) {
      setMoveAnim({ id, fromLat: current.lat, fromLon: current.lon, toLat: lat, toLon: lon, fading: false });
      window.requestAnimationFrame(() => setMoveAnim((m) => (m ? { ...m, fading: true } : m)));
      if (moveAnimTimerRef.current) window.clearTimeout(moveAnimTimerRef.current);
      moveAnimTimerRef.current = window.setTimeout(() => setMoveAnim(null), MOVE_ANIM_DURATION_MS);
    }
    setMoveMode(null);
  }

  function handleBackgroundPointerDown(e: React.PointerEvent) {
    const hadSomethingOpen = closeMenusAndModes();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    panRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startCenterLat: view.centerLat,
      startCenterLon: view.centerLon,
      moved: false,
      suppressClick: hadSomethingOpen,
    };
  }

  function handleVertexPointerDown(e: React.PointerEvent, index: number) {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    vertexDragRef.current = { pointerId: e.pointerId, index };
  }

  function handlePointerMove(e: React.PointerEvent) {
    const vertexDrag = vertexDragRef.current;
    if (vertexDrag && vertexDrag.pointerId === e.pointerId) {
      const point = clientToLatLon(e.clientX, e.clientY);
      if (point) onVertexDrag?.(vertexDrag.index, point.lat, point.lon);
      return;
    }
    const pan = panRef.current;
    if (!pan || pan.pointerId !== e.pointerId) return;
    const dxPx = e.clientX - pan.startClientX;
    const dyPx = e.clientY - pan.startClientY;
    if (Math.hypot(dxPx, dyPx) > CLICK_MOVE_THRESHOLD_PX) pan.moved = true;
    // I flyttläge (eller om ett menyval nyss stängdes) ska ett tryck aldrig
    // tolkas som panorering — nästa tryck är antingen "ny plats" eller en
    // stängning av menyn, inte kartrörelse à la Google Maps.
    if (moveMode || pan.suppressClick) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dLat = (dyPx / rect.height) * view.latSpan;
    const lonSpan = bounds.maxLon - bounds.minLon;
    const dLon = (dxPx / rect.width) * lonSpan;
    scheduleViewUpdate((v) => ({ ...v, centerLat: pan.startCenterLat + dLat, centerLon: pan.startCenterLon - dLon }));
  }

  function endDrag(e: React.PointerEvent) {
    const vertexDrag = vertexDragRef.current;
    if (vertexDrag && vertexDrag.pointerId === e.pointerId) {
      vertexDragRef.current = null;
      return;
    }
    const pan = panRef.current;
    panRef.current = null;
    if (!pan || pan.pointerId !== e.pointerId) return;

    if (moveMode) {
      if (!pan.moved) {
        const point = clientToLatLon(e.clientX, e.clientY);
        if (point) commitMove(moveMode.id, point.lat, point.lon);
      }
      return;
    }

    if (pan.moved || pan.suppressClick) return;

    // Dubbeltryck (à la Google Maps) zoomar in istället för att placera ett
    // nytt verk. Ett enkelklick väntar därför kort innan det faktiskt
    // placerar ett verk, så att ett snabbt andra tryck kan avbryta det och
    // zooma in på samma plats.
    const now = performance.now();
    const last = lastTapRef.current;
    const isDoubleTap =
      !!last &&
      now - last.time < DOUBLE_TAP_WINDOW_MS &&
      Math.hypot(e.clientX - last.clientX, e.clientY - last.clientY) < DOUBLE_TAP_MAX_DIST_PX;

    if (isDoubleTap) {
      if (pendingTapRef.current) {
        window.clearTimeout(pendingTapRef.current.timer);
        pendingTapRef.current = null;
      }
      lastTapRef.current = null;
      setView((v) => ({ ...v, latSpan: Math.max(v.latSpan / 1.8, MIN_LAT_SPAN) }));
      return;
    }

    lastTapRef.current = { time: now, clientX: e.clientX, clientY: e.clientY };
    if (pendingTapRef.current) window.clearTimeout(pendingTapRef.current.timer);
    const clientX = e.clientX;
    const clientY = e.clientY;
    const timer = window.setTimeout(() => {
      pendingTapRef.current = null;
      const point = clientToLatLon(clientX, clientY);
      if (!point) return;
      if (boundaryEditMode) {
        onVertexAdd?.(point.lat, point.lon);
      } else {
        onAdd(point.lat, point.lon);
      }
    }, DOUBLE_TAP_WINDOW_MS);
    pendingTapRef.current = { clientX, clientY, timer };
  }

  function zoomByFactor(deltaY: number) {
    const factor = deltaY > 0 ? 1.15 : 1 / 1.15;
    setView((v) => ({ ...v, latSpan: Math.min(Math.max(v.latSpan * factor, MIN_LAT_SPAN), MAX_LAT_SPAN) }));
  }

  function zoomIn() { zoomByFactor(-1); }
  function zoomOut() { zoomByFactor(1); }
  function resetView() { setView(computeDefaultView(turbines)); }
  function toggleFullscreen() {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  }

  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pinchRef.current = { distance, latSpan: view.latSpan };
      panRef.current = null;
    }
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2 && pinchRef.current) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const scale = pinchRef.current.distance / Math.max(distance, 1);
      scheduleViewUpdate((v) => ({
        ...v,
        latSpan: Math.min(Math.max(pinchRef.current!.latSpan * scale, MIN_LAT_SPAN), MAX_LAT_SPAN),
      }));
    }
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (e.touches.length < 2) pinchRef.current = null;
  }

  const castlePoint = project(ERICSBERG_CENTER.lat, ERICSBERG_CENTER.lon);
  const menuTurbine = menu ? turbines.find((t) => t.id === menu.id) : null;
  const infoTurbine = infoId ? turbines.find((t) => t.id === infoId) : null;
  const infoIndex = infoTurbine ? turbines.indexOf(infoTurbine) : -1;

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full touch-none overflow-hidden rounded-2xl bg-[#0a0a0a]"
      onPointerDown={handleBackgroundPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={endDrag}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="pointer-events-none absolute inset-0">
        {tiles.map((tile) => (
          <img
            key={tile.key}
            src={tile.url}
            alt=""
            draggable={false}
            className="absolute select-none bg-[#111]"
            style={{ left: `${tile.left}%`, top: `${tile.top}%`, width: `${tile.width}%`, height: `${tile.height}%` }}
          />
        ))}
        <div className="absolute inset-0 bg-black/20" />
      </div>

      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
        {showEstateBoundary && (
          <polygon points={estateAreaPoints} fill="rgba(0,0,0,0.45)" stroke="#000000" strokeWidth="0.6" />
        )}

        <polygon points={boundaryPoints} fill="rgba(255,139,1,0.08)" stroke="#FF8B01" strokeWidth="0.4" strokeDasharray="1.2,0.8" />

        {boundaryEditMode &&
          resolvedBoundary.map((v, i) => {
            const p = project(v.lat, v.lon);
            return (
              <g key={`edit-v-${i}`} className="pointer-events-auto">
                <ellipse
                  cx={p.x}
                  cy={p.y}
                  rx={1.6 * aspectX}
                  ry={1.6}
                  fill="#FF8B01"
                  stroke="#ffffff"
                  strokeWidth="0.3"
                  style={{ cursor: "grab", touchAction: "none" }}
                  onPointerDown={(e) => handleVertexPointerDown(e, i)}
                />
                {resolvedBoundary.length > 3 && (
                  <text
                    x={p.x + 2.2}
                    y={p.y - 2.2}
                    fontSize="2.6"
                    fill="#ffffff"
                    style={{ cursor: "pointer", paintOrder: "stroke", stroke: "#000", strokeWidth: 0.4 }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onVertexRemove?.(i);
                    }}
                  >
                    ✕
                  </text>
                )}
              </g>
            );
          })}

        {boundaryDebugMode &&
          !boundaryEditMode &&
          resolvedBoundary.map((v, i) => {
            const p = project(v.lat, v.lon);
            return (
              <g key={`boundary-v-${i}`}>
                <ellipse cx={p.x} cy={p.y} rx={0.9 * aspectX} ry={0.9} fill="#FF8B01" stroke="#000000" strokeWidth="0.25" />
                <text x={p.x + 1.2} y={p.y - 1} fontSize="2" fill="#FF8B01" style={{ paintOrder: "stroke", stroke: "#000", strokeWidth: 0.3 }}>
                  {i}: {v.lat.toFixed(4)},{v.lon.toFixed(4)}
                </text>
              </g>
            );
          })}
        {boundaryDebugMode &&
          ERICSBERG_ESTATE_AREA.map((v, i) => {
            const p = project(v.lat, v.lon);
            return (
              <g key={`estate-v-${i}`}>
                <ellipse cx={p.x} cy={p.y} rx={0.9 * aspectX} ry={0.9} fill="#38bdf8" stroke="#000000" strokeWidth="0.25" />
                <text x={p.x + 1.2} y={p.y - 1} fontSize="2" fill="#38bdf8" style={{ paintOrder: "stroke", stroke: "#000", strokeWidth: 0.3 }}>
                  {i}: {v.lat.toFixed(4)},{v.lon.toFixed(4)}
                </text>
              </g>
            );
          })}

        {[...SENSITIVE_ZONES, ...POSITIVE_ZONES].map((zone) => {
          const center = project(zone.lat, zone.lon);
          const r = zoneRadiusPercent(zone.radiusM, zone.lat);
          const color = ZONE_COLORS[zone.type] ?? "#ffffff";
          return (
            <ellipse
              key={zone.id}
              cx={center.x}
              cy={center.y}
              rx={r * aspectX}
              ry={r}
              fill={`${color}22`}
              stroke={color}
              strokeWidth="0.35"
              strokeDasharray="0.8,0.6"
            />
          );
        })}

        {HOUSEHOLD_CLUSTERS.map((h) => {
          const p = project(h.lat, h.lon);
          return <ellipse key={h.id} cx={p.x} cy={p.y} rx={aspectX} ry={1} fill="#ffffff" stroke="#0d0d0d" strokeWidth="0.25" />;
        })}

        {(() => {
          const p = project(KATRINEHOLM_CENTER.lat, KATRINEHOLM_CENTER.lon);
          return (
            <rect
              x={p.x - 1}
              y={p.y - 1}
              width="2"
              height="2"
              fill="#ffffff"
              stroke="#0d0d0d"
              strokeWidth="0.3"
              transform={`rotate(45 ${p.x} ${p.y})`}
            />
          );
        })()}

        <rect x={castlePoint.x - 1.3} y={castlePoint.y - 1.3} width="2.6" height="2.6" fill="#FFB347" stroke="#000" strokeWidth="0.3" />

        {moveAnim &&
          (() => {
            const from = project(moveAnim.fromLat, moveAnim.fromLon);
            const to = project(moveAnim.toLat, moveAnim.toLon);
            return (
              <g style={{ opacity: moveAnim.fading ? 0 : 1, transition: `opacity ${MOVE_ANIM_DURATION_MS - 150}ms ease` }}>
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke="#FFB347"
                  strokeWidth="0.4"
                  strokeDasharray="1.4,1"
                  markerEnd="url(#move-arrow)"
                />
                <ellipse cx={from.x} cy={from.y} rx={1.6 * aspectX} ry={1.6} fill="none" stroke="#FFB347" strokeWidth="0.4" strokeDasharray="0.8,0.6" />
              </g>
            );
          })()}
        <defs>
          <marker id="move-arrow" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto-start-reverse">
            <path d="M0,0 L4,2 L0,4 Z" fill="#FFB347" />
          </marker>
        </defs>

        {turbines.map((t) => {
          const isMoving = moveMode?.id === t.id;
          const color = colorById.get(t.id) ?? PENDING_COLOR;
          const p = project(t.lat, t.lon);
          return (
            <ellipse
              key={t.id}
              cx={p.x}
              cy={p.y}
              rx={(menu?.id === t.id || isMoving ? turbineRadius + 0.5 : turbineRadius) * aspectX}
              ry={menu?.id === t.id || isMoving ? turbineRadius + 0.5 : turbineRadius}
              style={{ fill: color, transition: "fill 400ms ease, cx 300ms ease, cy 300ms ease" }}
              stroke={isMoving ? "#FFB347" : "#fff"}
              strokeWidth={isMoving ? "0.6" : "0.3"}
              className={moveMode ? "" : "pointer-events-auto"}
              onPointerDown={(e) => handleMarkerPointerDown(e, t.id)}
            />
          );
        })}
      </svg>

      <div className="pointer-events-none absolute inset-0">
        {showHouseholdLabels && HOUSEHOLD_CLUSTERS.map((h) => {
          const p = project(h.lat, h.lon);
          return (
            <div
              key={h.id}
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] text-white"
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
            >
              🏠 {h.name}
            </div>
          );
        })}

        {(() => {
          const p = project(KATRINEHOLM_CENTER.lat, KATRINEHOLM_CENTER.lon);
          return (
            <div
              className="pointer-events-none absolute -translate-x-1/2 translate-y-2 whitespace-nowrap rounded-md border border-white/40 bg-black/80 px-2 py-1 text-[11px] font-bold text-white"
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
            >
              Katrineholm
            </div>
          );
        })()}

        <div
          className="pointer-events-auto absolute -translate-x-1/2 -translate-y-full cursor-pointer whitespace-nowrap rounded-md border border-[#FFB347]/60 bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white"
          style={{ left: `${castlePoint.x}%`, top: `${castlePoint.y}%` }}
          onPointerDown={(e) => {
            e.stopPropagation();
            setCastleOpen((v) => !v);
            setMenu(null);
            setInfoId(null);
          }}
        >
          🏰 Ericsbergs slott
        </div>

        {castleOpen && (
          <div
            className="pointer-events-auto absolute z-10 w-56 -translate-x-1/2 translate-y-2 rounded-xl border border-white/15 bg-[#111] p-3 text-xs text-white shadow-xl"
            style={{ left: `${castlePoint.x}%`, top: `${castlePoint.y}%` }}
          >
            <p className="text-sm font-semibold text-[#FFB347]">Ericsbergs slott</p>
            <p className="mt-1 text-white/80">Markägare: Caroline Bonde</p>
            <p className="mt-1 text-white/50">
              Runt egendomen löper den markerade placeringsgränsen för vindkraftprojektet.
            </p>
            {onToggleEstateBoundary && (
              <button
                className={`mt-2 w-full rounded-full px-3 py-1.5 text-center text-[11px] font-medium transition ${
                  showEstateBoundary
                    ? "bg-[#FFB347] text-[#090909] hover:bg-[#FF8B01]"
                    : "border border-white/20 bg-white/5 hover:bg-white/10"
                }`}
                onClick={(e) => { e.stopPropagation(); onToggleEstateBoundary(); }}
              >
                {showEstateBoundary ? "Dölj Ericsbergs mark" : "Visa Ericsbergs mark"}
              </button>
            )}
          </div>
        )}

        {showTurbineLabels && turbines.map((t, i) => {
          const p = project(t.lat, t.lon);
          const isOutside = outsideBoundaryIds.includes(t.id);
          return (
            <div
              key={t.id}
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-[220%] whitespace-nowrap rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white transition-all duration-300"
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
            >
              🌀 V{i + 1}
              {isOutside && <span className="text-red-400"> · utanför</span>}
            </div>
          );
        })}

        {moveMode && (
          <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-3">
            <div className="rounded-full bg-[#FF8B01] px-4 py-2 text-center text-xs font-semibold text-[#090909] shadow-lg">
              📍 Tryck på den nya platsen där vindkraftverket ska stå
            </div>
          </div>
        )}

        {menu && menuTurbine && (
          <div
            className="pointer-events-auto absolute z-20 w-44 -translate-x-1/2 translate-y-3 overflow-hidden rounded-xl border border-white/15 bg-[#111] text-xs text-white shadow-xl"
            style={{ left: `${menu.xPct}%`, top: `${menu.yPct}%` }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <p className="border-b border-white/10 px-3 py-2 text-[11px] font-semibold text-[#FFB347]">
              Vindkraftverk V{turbines.indexOf(menuTurbine) + 1}
            </p>
            <button
              className="block w-full px-3 py-2 text-left hover:bg-white/10"
              onClick={() => {
                setMoveMode({ id: menuTurbine.id, fromLat: menuTurbine.lat, fromLon: menuTurbine.lon });
                setMenu(null);
              }}
            >
              📍 Flytta
            </button>
            <button
              className="block w-full px-3 py-2 text-left text-red-300 hover:bg-white/10"
              onClick={() => {
                onRemove(menuTurbine.id);
                setMenu(null);
              }}
            >
              🗑️ Ta bort
            </button>
            <button
              className="block w-full px-3 py-2 text-left hover:bg-white/10"
              onClick={() => {
                setInfoId(menuTurbine.id);
                setMenu(null);
              }}
            >
              ℹ️ Information
            </button>
            <button
              className="block w-full px-3 py-2 text-left text-white/60 hover:bg-white/10"
              onClick={() => setMenu(null)}
            >
              ✕ Avbryt
            </button>
          </div>
        )}

        {infoId && infoTurbine && (
          <div
            className="pointer-events-auto absolute z-20 w-56 -translate-x-1/2 translate-y-3 rounded-xl border border-white/15 bg-[#111] p-3 text-xs text-white shadow-xl"
            style={{
              left: `${project(infoTurbine.lat, infoTurbine.lon).x}%`,
              top: `${project(infoTurbine.lat, infoTurbine.lon).y}%`,
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-[#FFB347]">Vindkraftverk V{infoIndex + 1}</p>
            <p className="mt-1 text-white/70">
              Position: {infoTurbine.lat.toFixed(5)}, {infoTurbine.lon.toFixed(5)}
            </p>
            {outsideBoundaryIds.includes(infoTurbine.id) && (
              <p className="mt-1 text-red-300">Ligger utanför Ericsbergs placeringsområde.</p>
            )}
            <button
              className="mt-2 w-full rounded-full bg-white/10 py-1.5 text-center hover:bg-white/20"
              onClick={() => setInfoId(null)}
            >
              Stäng
            </button>
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 max-w-[55%] rounded-md bg-black/60 px-2 py-1 text-[10px] leading-relaxed text-white/60">
        {moveMode
          ? "Tryck på kartan för att välja ny plats · tryck igen på menyn för att avbryta"
          : "Tryck på ett verk · dra för att panorera · nyp/dubbeltryck för att zooma"}
      </div>

      <div className="pointer-events-auto absolute bottom-3 right-3 z-10 flex flex-col items-center gap-1.5">
        <button
          onClick={toggleFullscreen}
          title={isFullscreen ? "Stäng helskärm" : "Helskärm"}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/70 text-sm text-white shadow hover:bg-black/90"
        >
          {isFullscreen ? "⊡" : "⛶"}
        </button>
        <button
          onClick={resetView}
          title="Återställ vy"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/70 text-sm text-white shadow hover:bg-black/90"
        >
          ⌂
        </button>
        <button
          onClick={zoomIn}
          title="Zooma in"
          className="flex h-9 w-8 items-center justify-center rounded-t-lg bg-black/70 text-lg font-bold text-white shadow hover:bg-black/90"
        >
          +
        </button>
        <button
          onClick={zoomOut}
          title="Zooma ut"
          className="flex h-9 w-8 items-center justify-center rounded-b-lg bg-black/70 text-lg font-bold text-white shadow hover:bg-black/90 -mt-1"
        >
          −
        </button>
      </div>
    </div>
  );
}
