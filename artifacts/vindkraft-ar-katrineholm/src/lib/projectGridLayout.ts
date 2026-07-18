/**
 * Genererar ett automatiskt rutnät av vindkraftverk inom ett projektområde.
 *
 * Används som default när redigeraren öppnas för ett projekt som saknar
 * fördefinierade turbinkoordinater (alla projekt utom Katrineholm/Ericsberg).
 */

import type { PlacedTurbine } from "./placementScoring";

export interface LatLon {
  lat: number;
  lon: number;
}

const METERS_PER_DEG_LAT = 111_320;
const TURBINE_SPACING_M = 500;

function pointInPolygon(lat: number, lon: number, polygon: LatLon[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lon, yi = polygon[i].lat;
    const xj = polygon[j].lon, yj = polygon[j].lat;
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}

export function generateProjectGrid(
  centerLat: number,
  centerLng: number,
  turbineCount: number,
  polygon?: LatLon[] | null,
  seed?: number,
): PlacedTurbine[] {
  if (turbineCount <= 0) return [];
  const rand = seededRandom(seed ?? Math.round(centerLat * 1e6));
  const cols = Math.max(1, Math.round(Math.sqrt(turbineCount * 1.2)));
  const rows = Math.max(1, Math.ceil(turbineCount / cols));
  const spacingLat = TURBINE_SPACING_M / METERS_PER_DEG_LAT;
  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  const spacingLng = TURBINE_SPACING_M / (METERS_PER_DEG_LAT * cosLat);
  const startLat = centerLat - ((rows - 1) / 2) * spacingLat;
  const startLng = centerLng - ((cols - 1) / 2) * spacingLng;
  const candidates: { lat: number; lon: number; dist: number }[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lat = startLat + r * spacingLat + (rand() - 0.5) * spacingLat * 0.3;
      const lng = startLng + c * spacingLng + (rand() - 0.5) * spacingLng * 0.3;
      if (polygon && polygon.length >= 3 && !pointInPolygon(lat, lng, polygon)) continue;
      const dLat = (lat - centerLat) * METERS_PER_DEG_LAT;
      const dLng = (lng - centerLng) * METERS_PER_DEG_LAT * cosLat;
      candidates.push({ lat, lon: lng, dist: Math.sqrt(dLat * dLat + dLng * dLng) });
    }
  }

  candidates.sort((a, b) => a.dist - b.dist);
  return candidates.slice(0, turbineCount).map((t, i) => ({
    id: `auto-${i + 1}`,
    lat: t.lat,
    lon: t.lon,
  }));
}

export function translateDefaultTurbines(
  centerLat: number,
  centerLng: number,
  count: number,
): PlacedTurbine[] {
  const template: { dLat: number; dLng: number }[] = [
    { dLat: 0.0044, dLng: 0.0038 },
    { dLat: 0.0057, dLng: 0.0181 },
    { dLat: -0.0112, dLng: 0.0220 },
    { dLat: 0.0031, dLng: 0.0312 },
    { dLat: -0.0014, dLng: 0.0408 },
    { dLat: -0.0086, dLng: 0.0402 },
    { dLat: -0.0583, dLng: -0.0257 },
    { dLat: -0.0637, dLng: -0.0508 },
  ];
  return template.slice(0, Math.min(count, template.length)).map((t, i) => ({
    id: `tpl-${i + 1}`,
    lat: centerLat + t.dLat,
    lon: centerLng + t.dLng,
  }));
}
