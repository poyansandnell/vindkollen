import { useEffect, useMemo, useRef, useState } from "react";
import {
  ERICSBERG_BOUNDARY,
  HOUSEHOLD_CLUSTERS,
  KATRINEHOLM_CENTER,
  POSITIVE_ZONES,
  SENSITIVE_ZONES,
  isInsideBoundary,
  type LatLon,
} from "@/lib/ericsbergArea";
import {
  ESRI_WORLD_IMAGERY_URL,
  computeTileLayout,
  fitBoundsToAspect,
  makeProjector,
  type LatLonBounds,
} from "@/lib/webMercatorTiles";
import type { PlacedTurbine } from "@/lib/placementScoring";

interface PlacementMapProps {
  turbines: PlacedTurbine[];
  onMove: (id: string, lat: number, lon: number) => void;
  outsideBoundaryIds: string[];
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

export function PlacementMap({ turbines, onMove, outsideBoundaryIds }: PlacementMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 1, height: 1 });
  const [draggingId, setDraggingId] = useState<string | null>(null);

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

  // Fasta gränser (oberoende av var verken dragits) — beräknas en gång utifrån
  // markgränsen, zonerna och bebyggelseklustren + en marginal, så kartan
  // aldrig panorerar/zoomar medan man drar ett verk.
  const bounds: LatLonBounds = useMemo(() => {
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
    const padLon = (maxLonRaw - minLonRaw) * 0.15 || 0.003;
    const raw: LatLonBounds = {
      minLat: minLatRaw - padLat,
      maxLat: maxLatRaw + padLat,
      minLon: minLonRaw - padLon,
      maxLon: maxLonRaw + padLon,
    };
    const containerAspect = containerSize.width / containerSize.height || 1;
    return fitBoundsToAspect(raw, containerAspect);
  }, [containerSize]);

  const project = useMemo(() => makeProjector(bounds), [bounds]);

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

  function zoneRadiusPercent(radiusM: number, lat: number) {
    // Ungefärlig grov omvandling meter -> % baserat på nuvarande breddgrad,
    // tillräckligt bra för en visuell zonmarkör (inte för exakta mätningar).
    const metersPerDegreeLat = 111320;
    const degLat = radiusM / metersPerDegreeLat;
    const p1 = project(lat, 0);
    const p2 = project(lat + degLat, 0);
    return Math.abs(p2.y - p1.y);
  }

  function clientToLatLon(clientX: number, clientY: number): LatLon | null {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;
    return unproject(Math.min(Math.max(x, 0), 100), Math.min(Math.max(y, 0), 100));
  }

  function handlePointerDown(e: React.PointerEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDraggingId(id);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!draggingId) return;
    const point = clientToLatLon(e.clientX, e.clientY);
    if (point) onMove(draggingId, point.lat, point.lon);
  }

  function endDrag() {
    setDraggingId(null);
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full touch-none overflow-hidden rounded-2xl bg-[#0a0a0a]"
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={endDrag}
    >
      <div className="absolute inset-0">
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
        <div className="pointer-events-none absolute inset-0 bg-black/20" />
      </div>

      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
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
          return (
            <g key={h.id}>
              <circle cx={p.x} cy={p.y} r="1" fill="#ffffff" stroke="#0d0d0d" strokeWidth="0.25" />
            </g>
          );
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

        {turbines.map((t) => {
          const p = project(t.lat, t.lon);
          const isOutside = outsideBoundaryIds.includes(t.id);
          return (
            <circle
              key={t.id}
              cx={p.x}
              cy={p.y}
              r={draggingId === t.id ? "2.2" : "1.8"}
              fill={isOutside ? "#ef4444" : "#FF8B01"}
              stroke="#fff"
              strokeWidth="0.3"
              style={{ cursor: "grab" }}
              onPointerDown={(e) => handlePointerDown(e, t.id)}
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
      </div>
    </div>
  );
}
