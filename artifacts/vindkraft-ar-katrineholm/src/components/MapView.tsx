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

    return { turbinePoints, userPoint, metersPerDegreeLon };
  }, [turbines, userLat, userLon]);

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-[#0a1a16]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h2 className="text-lg font-semibold text-emerald-50">Karta över vindkraftverk</h2>
        <button
          onClick={onClose}
          className="rounded-full bg-white/10 px-4 py-1.5 text-sm text-emerald-50 hover:bg-white/20"
        >
          Stäng
        </button>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <defs>
            <pattern id="grid" width="8" height="8" patternUnits="userSpaceOnUse">
              <path d="M 8 0 L 0 0 0 8" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.3" />
            </pattern>
          </defs>
          <rect width="100" height="100" fill="#0d251f" />
          <rect width="100" height="100" fill="url(#grid)" />

          {points.userPoint && (
            <g>
              <circle cx={points.userPoint.x} cy={points.userPoint.y} r="2.4" fill="rgba(59,180,255,0.25)" />
              <circle cx={points.userPoint.x} cy={points.userPoint.y} r="1.1" fill="#3bb4ff" stroke="#eafff7" strokeWidth="0.3" />
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
              className="absolute -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] text-emerald-50"
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
            >
              {p.turbine.name}
              {p.distance !== null && <span className="text-emerald-300"> · {formatDistance(p.distance)}</span>}
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-white/10 bg-[#0a1a16] px-4 py-3 text-xs text-emerald-200/70">
        {turbines.length} planerade vindkraftverk, Länsterberget norr om Katrineholm.
        {userLat === null && " Aktivera plats för att se var du befinner dig på kartan."}
      </div>
    </div>
  );
}
