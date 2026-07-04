import { useEffect, useMemo, useRef, useState } from "react";
import {
  ERICSBERG_BOUNDARY,
  ERICSBERG_CENTER,
  ERICSBERG_ESTATE_AREA,
  HOUSEHOLD_CLUSTERS,
  KATRINEHOLM_CENTER,
  POSITIVE_ZONES,
  SENSITIVE_ZONES,
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
import { PLACEMENT_LEVEL_COLORS, scorePlacement, type PlacedTurbine } from "@/lib/placementScoring";

interface PlacementMapProps {
  turbines: PlacedTurbine[];
  onMove: (id: string, lat: number, lon: number) => void;
  onAdd: (lat: number, lon: number) => void;
  onRemove: (id: string) => void;
  outsideBoundaryIds: string[];
  showEstateBoundary: boolean;
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

/** Klick/drag under detta antal pixlar räknas som ett klick (lägg till verk), inte en panorering. */
const CLICK_MOVE_THRESHOLD_PX = 6;
const MIN_LAT_SPAN = 0.004;
const MAX_LAT_SPAN = 0.25;

interface ViewState {
  centerLat: number;
  centerLon: number;
  latSpan: number;
}

function computeDefaultView(): ViewState {
  const lats = ERICSBERG_BOUNDARY.map((p) => p.lat);
  const lons = ERICSBERG_BOUNDARY.map((p) => p.lon);
  for (const z of [...SENSITIVE_ZONES, ...POSITIVE_ZONES]) {
    lats.push(z.lat);
    lons.push(z.lon);
  }
  for (const h of HOUSEHOLD_CLUSTERS) {
    lats.push(h.lat);
    lons.push(h.lon);
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

export function PlacementMap({ turbines, onMove, onAdd, onRemove, outsideBoundaryIds, showEstateBoundary }: PlacementMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 1, height: 1 });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [castleOpen, setCastleOpen] = useState(false);
  const [view, setView] = useState<ViewState>(() => computeDefaultView());

  const panRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startCenterLat: number;
    startCenterLon: number;
    moved: boolean;
  } | null>(null);
  const pinchRef = useRef<{ distance: number; latSpan: number } | null>(null);

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

  const containerAspect = containerSize.width / containerSize.height || 1;
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

  const boundaryPoints = useMemo(
    () => ERICSBERG_BOUNDARY.map((p) => project(p.lat, p.lon)).map((p) => `${p.x},${p.y}`).join(" "),
    [project],
  );

  const estateAreaPoints = useMemo(
    () => ERICSBERG_ESTATE_AREA.map((p) => project(p.lat, p.lon)).map((p) => `${p.x},${p.y}`).join(" "),
    [project],
  );

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

  function handleMarkerPointerDown(e: React.PointerEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDraggingId(id);
    setSelectedId(id);
    setCastleOpen(false);
  }

  function handleBackgroundPointerDown(e: React.PointerEvent) {
    if (draggingId) return;
    setCastleOpen(false);
    setSelectedId(null);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    panRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startCenterLat: view.centerLat,
      startCenterLon: view.centerLon,
      moved: false,
    };
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (draggingId) {
      const point = clientToLatLon(e.clientX, e.clientY);
      if (point) onMove(draggingId, point.lat, point.lon);
      return;
    }
    const pan = panRef.current;
    if (!pan || pan.pointerId !== e.pointerId) return;
    const dxPx = e.clientX - pan.startClientX;
    const dyPx = e.clientY - pan.startClientY;
    if (Math.hypot(dxPx, dyPx) > CLICK_MOVE_THRESHOLD_PX) pan.moved = true;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dLat = (dyPx / rect.height) * view.latSpan;
    const lonSpan = bounds.maxLon - bounds.minLon;
    const dLon = (dxPx / rect.width) * lonSpan;
    setView((v) => ({ ...v, centerLat: pan.startCenterLat + dLat, centerLon: pan.startCenterLon - dLon }));
  }

  function endDrag(e: React.PointerEvent) {
    if (draggingId) {
      setDraggingId(null);
      return;
    }
    const pan = panRef.current;
    if (pan && pan.pointerId === e.pointerId && !pan.moved) {
      const point = clientToLatLon(e.clientX, e.clientY);
      if (point) onAdd(point.lat, point.lon);
    }
    panRef.current = null;
  }

  function zoomByFactor(deltaY: number) {
    const factor = deltaY > 0 ? 1.15 : 1 / 1.15;
    setView((v) => ({ ...v, latSpan: Math.min(Math.max(v.latSpan * factor, MIN_LAT_SPAN), MAX_LAT_SPAN) }));
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
      setView((v) => ({
        ...v,
        latSpan: Math.min(Math.max(pinchRef.current!.latSpan * scale, MIN_LAT_SPAN), MAX_LAT_SPAN),
      }));
    }
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (e.touches.length < 2) pinchRef.current = null;
  }

  const castlePoint = project(ERICSBERG_CENTER.lat, ERICSBERG_CENTER.lon);

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

        {[...SENSITIVE_ZONES, ...POSITIVE_ZONES].map((zone) => {
          const center = project(zone.lat, zone.lon);
          const r = zoneRadiusPercent(zone.radiusM, zone.lat);
          const color = ZONE_COLORS[zone.type] ?? "#ffffff";
          return (
            <circle
              key={zone.id}
              cx={center.x}
              cy={center.y}
              r={r}
              fill={`${color}22`}
              stroke={color}
              strokeWidth="0.35"
              strokeDasharray="0.8,0.6"
            />
          );
        })}

        {HOUSEHOLD_CLUSTERS.map((h) => {
          const p = project(h.lat, h.lon);
          return <circle key={h.id} cx={p.x} cy={p.y} r="1" fill="#ffffff" stroke="#0d0d0d" strokeWidth="0.25" />;
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

        {turbines.map((t) => {
          const p = project(t.lat, t.lon);
          const isOutside = outsideBoundaryIds.includes(t.id);
          const level = scorePlacement([t]).level;
          const color = isOutside ? "#ef4444" : PLACEMENT_LEVEL_COLORS[level].hex;
          return (
            <circle
              key={t.id}
              cx={p.x}
              cy={p.y}
              r={draggingId === t.id || selectedId === t.id ? "2.2" : "1.8"}
              fill={color}
              stroke="#fff"
              strokeWidth="0.3"
              className="pointer-events-auto"
              style={{ cursor: "grab" }}
              onPointerDown={(e) => handleMarkerPointerDown(e, t.id)}
            />
          );
        })}
      </svg>

      <div className="pointer-events-none absolute inset-0">
        {HOUSEHOLD_CLUSTERS.map((h) => {
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
            setSelectedId(null);
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
              Härifrån visas den markerade marken runt området (se "Visa Ericsbergs mark").
            </p>
          </div>
        )}

        {turbines.map((t, i) => {
          const p = project(t.lat, t.lon);
          const isOutside = outsideBoundaryIds.includes(t.id);
          return (
            <div
              key={t.id}
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-[220%] whitespace-nowrap rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white"
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
            >
              🌀 V{i + 1}
              {isOutside && <span className="text-red-400"> · utanför</span>}
            </div>
          );
        })}

        {selectedId && (
          <div
            className="pointer-events-auto absolute z-10 -translate-x-1/2 translate-y-2 rounded-full bg-red-500/90 px-3 py-1 text-[11px] font-medium text-white shadow-lg"
            style={{
              left: `${project(turbines.find((t) => t.id === selectedId)?.lat ?? 0, turbines.find((t) => t.id === selectedId)?.lon ?? 0).x}%`,
              top: `${project(turbines.find((t) => t.id === selectedId)?.lat ?? 0, turbines.find((t) => t.id === selectedId)?.lon ?? 0).y}%`,
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onRemove(selectedId);
              setSelectedId(null);
            }}
          >
            🗑️ Ta bort verk
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/60 px-2 py-1 text-[10px] text-white/60">
        Klicka för att placera · dra för att panorera · scrolla/nyp för att zooma
      </div>
    </div>
  );
}
