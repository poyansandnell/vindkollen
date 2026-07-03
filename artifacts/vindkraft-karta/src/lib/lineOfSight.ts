export type VisibilityStatus = "visible" | "obstructed" | "unknown";

const EARTH_RADIUS_KM = 6371;
// Combined earth-curvature + standard-atmospheric-refraction coefficient (meters per km^2),
// the widely used approximation h(m) = k * d1(km) * d2(km) for a path profile bulge.
const CURVATURE_REFRACTION_COEFFICIENT = 0.0673;
const OBSERVER_EYE_HEIGHT_M = 1.7;
// Used when a target's real structure height is unknown (e.g. a planned project area without
// a confirmed turbine spec yet) - a representative modern onshore turbine height.
export const FALLBACK_TARGET_HEIGHT_M = 200;

export function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function interpolateLngLat(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  fraction: number,
): { lat: number; lng: number } {
  return {
    lat: lat1 + (lat2 - lat1) * fraction,
    lng: lng1 + (lng2 - lng1) * fraction,
  };
}

/** Earth-curvature + refraction bulge (meters) at a point d1 km / d2 km from either end of a path. */
export function curvatureBulgeM(d1Km: number, d2Km: number): number {
  return CURVATURE_REFRACTION_COEFFICIENT * d1Km * d2Km;
}

/** Number of terrain samples to take along a path, scaled with distance but bounded for performance. */
export function sampleCountForDistance(distanceKm: number): number {
  return Math.min(16, Math.max(4, Math.ceil(distanceKm / 3)));
}

export interface SampleElevation {
  distanceKm: number;
  elevationM: number | null;
}

export interface LineOfSightInput {
  observerElevationM: number | null;
  targetElevationM: number | null;
  targetHeightM: number | null;
  totalDistanceKm: number;
  samples: SampleElevation[];
}

/**
 * Estimates whether a target (turbine top) is visible from an observer point, given terrain
 * elevation samples along the path between them. This is a heuristic: it uses bare-earth terrain
 * elevation (from Mapbox's DEM), earth curvature + standard refraction, and the target's known
 * structure height. It does NOT account for forests, buildings, or other above-ground obstacles,
 * since no such data source is wired up - see the UI disclaimer.
 */
export function evaluateLineOfSight({
  observerElevationM,
  targetElevationM,
  targetHeightM,
  totalDistanceKm,
  samples,
}: LineOfSightInput): VisibilityStatus {
  if (observerElevationM === null || targetElevationM === null) return "unknown";

  const hObs = observerElevationM + OBSERVER_EYE_HEIGHT_M;
  const hTarget = targetElevationM + (targetHeightM ?? FALLBACK_TARGET_HEIGHT_M);

  let sawMissingSample = false;

  for (const sample of samples) {
    if (sample.elevationM === null) {
      sawMissingSample = true;
      continue;
    }
    const fraction = totalDistanceKm > 0 ? sample.distanceKm / totalDistanceKm : 0;
    const losHeight = hObs + (hTarget - hObs) * fraction;
    const bulge = curvatureBulgeM(sample.distanceKm, totalDistanceKm - sample.distanceKm);
    const effectiveTerrainHeight = sample.elevationM - bulge;

    if (effectiveTerrainHeight > losHeight) {
      return "obstructed";
    }
  }

  return sawMissingSample ? "unknown" : "visible";
}
