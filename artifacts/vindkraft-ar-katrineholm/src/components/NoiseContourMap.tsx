/**
 * C1: NoiseContourMap — visar en ungefärlig 40 dBA-gränszon runt varje
 * vindkraftsverk som en halvgenomskinlig cirkel på en MapLibre GL-karta.
 *
 * Beräkningsmodell (förenklad punkt-källmodell):
 *   ΔL = 20 · log10(r₁ / r₂)
 *   40 dBA-radien r₄₀ ≈ 5 km (typiskt för ett modernt 3–4 MW-verk på ett
 *   flackt, skogsklippt landskap utan terrängdämpning). Verkliga utredningar
 *   varierar; det här är ett pedagogiskt gränsvärde, inte en exakt beräkning.
 *
 * Används för att ge användaren en intuitiv bild av bullerpåverkan —
 * istället för en enskild dBA-siffra ser de VAR det kan bli för högt.
 */

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, Polygon, Point } from "geojson";

/** Radien (meter) inom vilken modellen estimerar ≥ 40 dBA. */
const NOISE_RADIUS_M = 5_000;

/** Antal punkter i den GeoJSON-cirkel-approximationen. */
const CIRCLE_POINTS = 64;

export interface NoiseTurbine {
  id: string;
  lat: number;
  lon: number;
}

interface NoiseContourMapProps {
  turbines: NoiseTurbine[];
  /** Betraktarens position — markeras med en blå punkt om angiven. */
  receiverPoint?: { lat: number; lon: number } | null;
  /** dBA-tröskel att visualisera (standard 40). Påverkar inte cirkelradien
   *  (den är hårdkodad till 5 km) men visas i kartans legend. */
  thresholdDba?: number;
  className?: string;
}

/** Skapar en GeoJSON-cirkel approximerad med `n` punkter. */
function makeCircle(
  lon: number,
  lat: number,
  radiusM: number,
  n: number,
): Feature<Polygon> {
  const earthRadius = 6_371_000;
  const coords: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const angle = (i / n) * 2 * Math.PI;
    const dLat = (radiusM / earthRadius) * (180 / Math.PI) * Math.cos(angle);
    const dLon =
      (radiusM / earthRadius) *
      (180 / Math.PI) *
      (1 / Math.cos((lat * Math.PI) / 180)) *
      Math.sin(angle);
    coords.push([lon + dLon, lat + dLat]);
  }
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [coords] },
  };
}

export function NoiseContourMap({
  turbines,
  receiverPoint,
  thresholdDba = 40,
  className = "",
}: NoiseContourMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const map = new maplibregl.Map({
      container,
      style: {
        version: 8,
        sources: {
          esri: {
            type: "raster",
            tiles: [
              "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            ],
            tileSize: 256,
            attribution: "Esri World Imagery",
          },
        },
        layers: [{ id: "esri-imagery", type: "raster", source: "esri" }],
      },
      center:
        turbines.length > 0
          ? [turbines[0].lon, turbines[0].lat]
          : [16.5, 59.0],
      zoom: 10,
    });
    mapRef.current = map;

    map.on("load", () => {
      // Bygg ett GeoJSON-lager med en cirkel per verk
      const features: Feature[] = turbines.map((t) =>
        makeCircle(t.lon, t.lat, NOISE_RADIUS_M, CIRCLE_POINTS),
      );

      map.addSource("noise-zones", {
        type: "geojson",
        data: { type: "FeatureCollection", features },
      });

      map.addLayer({
        id: "noise-fill",
        type: "fill",
        source: "noise-zones",
        paint: {
          "fill-color": "#FF4444",
          "fill-opacity": 0.15,
        },
      });

      map.addLayer({
        id: "noise-outline",
        type: "line",
        source: "noise-zones",
        paint: {
          "line-color": "#FF4444",
          "line-width": 1.5,
          "line-opacity": 0.6,
        },
      });

      // Turbinpunkter
      const turbinePoints: Feature<Point>[] = turbines.map((t) => ({
        type: "Feature",
        properties: { id: t.id },
        geometry: { type: "Point", coordinates: [t.lon, t.lat] },
      }));

      map.addSource("turbines", {
        type: "geojson",
        data: { type: "FeatureCollection", features: turbinePoints },
      });

      map.addLayer({
        id: "turbine-points",
        type: "circle",
        source: "turbines",
        paint: {
          "circle-radius": 5,
          "circle-color": "#FF8B01",
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 1.5,
        },
      });

      // Betraktarposition
      if (receiverPoint) {
        map.addSource("receiver", {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Point",
              coordinates: [receiverPoint.lon, receiverPoint.lat],
            },
          },
        });
        map.addLayer({
          id: "receiver-point",
          type: "circle",
          source: "receiver",
          paint: {
            "circle-radius": 7,
            "circle-color": "#4488FF",
            "circle-stroke-color": "#fff",
            "circle-stroke-width": 2,
          },
        });
      }

      // Passa kartan till alla zoner + turbiner
      if (turbines.length > 0) {
        let minLon = Infinity,
          maxLon = -Infinity,
          minLat = Infinity,
          maxLat = -Infinity;
        for (const t of turbines) {
          const dDeg = (NOISE_RADIUS_M / 6_371_000) * (180 / Math.PI);
          minLon = Math.min(minLon, t.lon - dDeg * 1.5);
          maxLon = Math.max(maxLon, t.lon + dDeg * 1.5);
          minLat = Math.min(minLat, t.lat - dDeg);
          maxLat = Math.max(maxLat, t.lat + dDeg);
        }
        map.fitBounds(
          [
            [minLon, minLat],
            [maxLon, maxLat],
          ],
          { padding: 20, duration: 0 },
        );
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`relative ${className}`}>
      <div ref={containerRef} className="h-full w-full" />
      {/* Legend */}
      <div className="pointer-events-none absolute left-2 top-2 rounded-lg bg-black/70 px-2.5 py-1.5 text-[11px] text-white/90 backdrop-blur">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full border border-[#FF4444] bg-[#FF4444]/30" />
          <span>≥ {thresholdDba} dBA-zon (~5 km)</span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full border-2 border-white bg-[#FF8B01]" />
          <span>Planerat verk</span>
        </div>
        {receiverPoint && (
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-full border-2 border-white bg-[#4488FF]" />
            <span>Din position</span>
          </div>
        )}
        <p className="mt-1 text-[9px] text-white/40">
          Pedagogisk uppskattning — ej juridisk beräkning
        </p>
      </div>
    </div>
  );
}
