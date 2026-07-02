import { useMemo } from "react";
import type { TurbineSweref } from "@/lib/turbines";
import { swerefToWgs84 } from "@/lib/sweref";
import { distanceMeters, formatDistance } from "@/lib/geo";

interface MapViewProps {
  turbines: TurbineSweref[];
  userLat: number | null;
  userLon: number | null;
  onClose: () => void;
}

const METERS_PER_DEGREE_LAT = 111320;
const MAX_TILES = 20;

// Web Mercator (samma projektion som "slippy map"-plattor, t.ex. OSM/Esri).
function lon2tileX(lon: number, z: number) {
  return ((lon + 180) / 360) * 2 ** z;
}
function lat2tileY(lat: number, z: number) {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
}
function tileX2lon(x: number, z: number) {
  return (x / 2 ** z) * 360 - 180;
}
function tileY2lat(y: number, z: number) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export function MapView({ turbines, userLat, userLon, onClose }: MapViewProps) {
  const points = useMemo(() => {
    const wgs = turbines.map((t) => ({ turbine: t, ...swerefToWgs84(t.easting, t.northing) }));

    const lats = wgs.map((p) => p.lat);
    const lons = wgs.map((p) => p.lon);
    if (userLat !== null) lats.push(userLat);
    if (userLon !== null) lons.push(userLon);

    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);

    const padLat = (maxLat - minLat) * 0.18 || 0.003;
    const padLon = (maxLon - minLon) * 0.18 || 0.003;

    const bounds = {
      minLat: minLat - padLat,
      maxLat: maxLat + padLat,
      minLon: minLon - padLon,
      maxLon: maxLon + padLon,
    };

    const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);

    function project(lat: number, lon: number) {
      const x = ((lon - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * 100;
      const y = 100 - ((lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * 100;
      return { x, y };
    }

    const turbinePoints = wgs.map((p) => {
      const { x, y } = project(p.lat, p.lon);
      const distance =
        userLat !== null && userLon !== null ? distanceMeters(userLat, userLon, p.lat, p.lon) : null;
      return { ...p, x, y, distance };
    });

    const userPoint =
      userLat !== null && userLon !== null ? project(userLat, userLon) : null;

    // Hitta högsta zoomnivå (mest detaljerad flygfoto) där antalet plattor
    // som täcker vår bounding box fortfarande är rimligt (prestanda/nätverk).
    let zoom = 16;
    let tileRange: { zoom: number; x1: number; x2: number; y1: number; y2: number } | null = null;
    for (; zoom >= 9; zoom--) {
      const x1 = Math.floor(lon2tileX(bounds.minLon, zoom));
      const x2 = Math.floor(lon2tileX(bounds.maxLon, zoom));
      const y1 = Math.floor(lat2tileY(bounds.maxLat, zoom));
      const y2 = Math.floor(lat2tileY(bounds.minLat, zoom));
      const count = (x2 - x1 + 1) * (y2 - y1 + 1);
      if (count <= MAX_TILES) {
        tileRange = { zoom, x1, x2, y1, y2 };
        break;
      }
    }

    const tiles: { key: string; url: string; left: number; top: number; width: number; height: number }[] = [];
    if (tileRange) {
      for (let tx = tileRange.x1; tx <= tileRange.x2; tx++) {
        for (let ty = tileRange.y1; ty <= tileRange.y2; ty++) {
          const lonW = tileX2lon(tx, tileRange.zoom);
          const lonE = tileX2lon(tx + 1, tileRange.zoom);
          const latN = tileY2lat(ty, tileRange.zoom);
          const latS = tileY2lat(ty + 1, tileRange.zoom);
          const topLeft = project(latN, lonW);
          const bottomRight = project(latS, lonE);
          tiles.push({
            key: `${tileRange.zoom}-${tx}-${ty}`,
            url: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${tileRange.zoom}/${ty}/${tx}`,
            left: topLeft.x,
            top: topLeft.y,
            width: bottomRight.x - topLeft.x,
            height: bottomRight.y - topLeft.y,
          });
        }
      }
    }

    return { turbinePoints, userPoint, metersPerDegreeLon, tiles };
  }, [turbines, userLat, userLon]);

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-[#0d0d0d]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h2 className="text-lg font-semibold text-white">Karta över vindkraftverk</h2>
        <button
          onClick={onClose}
          className="rounded-full bg-white/10 px-4 py-1.5 text-sm text-white hover:bg-white/20"
        >
          Stäng
        </button>
      </div>
      <div className="relative flex-1 overflow-hidden bg-[#0a0a0a]">
        {/* Flygfoto/satellitbakgrund (Esri World Imagery, kräver ingen API-nyckel). */}
        <div className="absolute inset-0">
          {points.tiles.map((tile) => (
            <img
              key={tile.key}
              src={tile.url}
              alt=""
              draggable={false}
              className="absolute select-none bg-[#111]"
              style={{
                left: `${tile.left}%`,
                top: `${tile.top}%`,
                width: `${tile.width}%`,
                height: `${tile.height}%`,
              }}
            />
          ))}
          <div className="pointer-events-none absolute inset-0 bg-black/25" />
        </div>

        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {points.userPoint && (
            <g>
              <circle cx={points.userPoint.x} cy={points.userPoint.y} r="2.4" fill="rgba(59,180,255,0.25)" />
              <circle cx={points.userPoint.x} cy={points.userPoint.y} r="1.1" fill="#3bb4ff" stroke="#fff5eb" strokeWidth="0.3" />
            </g>
          )}

          {points.turbinePoints.map((p) => (
            <g key={p.turbine.id}>
              <circle cx={p.x} cy={p.y} r="1.3" fill="#ff5b5b" stroke="#fff" strokeWidth="0.25" />
            </g>
          ))}
        </svg>

        <div className="absolute inset-0">
          {points.turbinePoints.map((p) => (
            <div
              key={p.turbine.id}
              className="absolute -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] text-white"
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
            >
              {p.turbine.name}
              {p.distance !== null && <span className="text-[#FFB347]"> · {formatDistance(p.distance)}</span>}
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-white/10 bg-[#0d0d0d] px-4 py-3 text-xs text-white/70">
        {turbines.length} planerade vindkraftverk norr om Katrineholm.
        {userLat === null && " Aktivera plats för att se var du befinner dig på kartan."}
      </div>
    </div>
  );
}
