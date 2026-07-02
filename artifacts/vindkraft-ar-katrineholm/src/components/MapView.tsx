import { useEffect, useMemo, useRef, useState } from "react";
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

// Katrineholms centrum — visas som en distinkt "stad"-etikett på kartan,
// separat från vindkraftverkens markörer.
const KATRINEHOLM = { lat: 58.9959, lon: 16.2072 };

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 1, height: 1 });

  // Håller reda på den faktiska pixelstorleken (och därmed bildförhållandet)
  // på kartcontainern, så att projektionen kan anpassas vid rotation/resize
  // istället för att sträckas ut med en fast fyrkantig vy.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setContainerSize({ width: rect.width, height: rect.height });
      }
    };

    update();

    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(el);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  const points = useMemo(() => {
    const wgs = turbines.map((t) => ({ turbine: t, ...swerefToWgs84(t.easting, t.northing) }));

    const lats = wgs.map((p) => p.lat);
    const lons = wgs.map((p) => p.lon);
    if (userLat !== null) lats.push(userLat);
    if (userLon !== null) lons.push(userLon);
    lats.push(KATRINEHOLM.lat);
    lons.push(KATRINEHOLM.lon);

    const minLatRaw = Math.min(...lats);
    const maxLatRaw = Math.max(...lats);
    const minLonRaw = Math.min(...lons);
    const maxLonRaw = Math.max(...lons);

    const padLat = (maxLatRaw - minLatRaw) * 0.18 || 0.003;
    const padLon = (maxLonRaw - minLonRaw) * 0.18 || 0.003;

    const minLat = minLatRaw - padLat;
    const maxLat = maxLatRaw + padLat;
    const minLon = minLonRaw - padLon;
    const maxLon = maxLonRaw + padLon;

    const centerLat = (minLat + maxLat) / 2;
    const centerLon = (minLon + maxLon) / 2;
    const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos((centerLat * Math.PI) / 180);

    // Bredda den kortare geografiska dimensionen (i grader) så att kartans
    // bildförhållande i meter matchar containerns faktiska bildförhållande
    // i pixlar. Då kan projektionen sedan skalas 1:1 utan att sträckas ut
    // olika mycket i x- och y-led (dvs. utan distorsion vid rotation).
    const latMeters = (maxLat - minLat) * METERS_PER_DEGREE_LAT;
    const lonMeters = (maxLon - minLon) * metersPerDegreeLon;
    const containerAspect = containerSize.width / containerSize.height || 1;
    const boundsAspect = lonMeters / latMeters || 1;

    let bounds = { minLat, maxLat, minLon, maxLon };
    if (boundsAspect > containerAspect) {
      // Geografiska boxen är "bredare" än containern — öka höjden (latitud).
      const targetLatMeters = lonMeters / containerAspect;
      const extraLatDeg = (targetLatMeters - latMeters) / METERS_PER_DEGREE_LAT / 2;
      bounds = { minLat: minLat - extraLatDeg, maxLat: maxLat + extraLatDeg, minLon, maxLon };
    } else if (boundsAspect < containerAspect) {
      // Geografiska boxen är "smalare" än containern — öka bredden (longitud).
      const targetLonMeters = latMeters * containerAspect;
      const extraLonDeg = (targetLonMeters - lonMeters) / metersPerDegreeLon / 2;
      bounds = { minLat, maxLat, minLon: minLon - extraLonDeg, maxLon: maxLon + extraLonDeg };
    }

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

    const cityPoint = project(KATRINEHOLM.lat, KATRINEHOLM.lon);

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

    return { turbinePoints, userPoint, cityPoint, metersPerDegreeLon, tiles };
  }, [turbines, userLat, userLon, containerSize]);

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
      <div ref={containerRef} className="relative flex-1 overflow-hidden bg-[#0a0a0a]">
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

          {/* Katrineholm stadsmarkör — visuellt skild från vindkraftverkens
              röda punkter för att tydliggöra att det är en ort, inte ett verk. */}
          <g>
            <rect
              x={points.cityPoint.x - 1.1}
              y={points.cityPoint.y - 1.1}
              width="2.2"
              height="2.2"
              fill="#ffffff"
              stroke="#0d0d0d"
              strokeWidth="0.3"
              transform={`rotate(45 ${points.cityPoint.x} ${points.cityPoint.y})`}
            />
          </g>
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

          <div
            className="absolute -translate-x-1/2 translate-y-2 whitespace-nowrap rounded-md border border-white/40 bg-black/80 px-2 py-1 text-[13px] font-bold tracking-wide text-white shadow-[0_0_6px_rgba(0,0,0,0.8)]"
            style={{ left: `${points.cityPoint.x}%`, top: `${points.cityPoint.y}%` }}
          >
            Katrineholm
          </div>
        </div>
      </div>
      <div className="border-t border-white/10 bg-[#0d0d0d] px-4 py-3 text-xs text-white/70">
        {turbines.length} planerade vindkraftverk norr om Katrineholm.
        {userLat === null && " Aktivera plats för att se var du befinner dig på kartan."}
      </div>
    </div>
  );
}
