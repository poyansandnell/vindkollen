import { distanceKm } from "@workspace/geo";
import type { InsertLocalityImpactScore, Locality, WindProjectArea, WindTurbine } from "@workspace/db";

/**
 * Dominant statuses ranked by how "certain"/impactful they are for a nearby
 * resident: an operating turbine matters more than a rejected application.
 */
const STATUS_WEIGHT: Record<string, number> = {
  uppfort: 1,
  handlaggs: 0.6,
  beviljat: 0.8,
  aktuellt: 0.55,
  samrad: 0.35,
  ansokan_inlamnad: 0.4,
  inledande_undersokning: 0.25,
  andringsansokan: 0.5,
  overklagat: 0.45,
  uppgift_saknas: 0.2,
  nedmonterat: 0.05,
  avslaget: 0.05,
  inte_aktuellt: 0.05,
};

const NEAR_RADIUS_KM = 25;
const FAR_RADIUS_KM = 60;

export interface ImpactScoreInput {
  locality: Locality;
  turbines: WindTurbine[];
  projectAreas: WindProjectArea[];
}

function statusWeight(status: string): number {
  return STATUS_WEIGHT[status] ?? 0.3;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function computeLocalityImpactScore({
  locality,
  turbines,
  projectAreas,
}: ImpactScoreInput): InsertLocalityImpactScore {
  const nearTurbines: { turbine: WindTurbine; distanceKm: number }[] = [];
  const farTurbines: { turbine: WindTurbine; distanceKm: number }[] = [];

  for (const turbine of turbines) {
    const d = distanceKm(locality.lat, locality.lng, turbine.lat, turbine.lng);
    if (d <= NEAR_RADIUS_KM) nearTurbines.push({ turbine, distanceKm: d });
    else if (d <= FAR_RADIUS_KM) farTurbines.push({ turbine, distanceKm: d });
  }

  const nearAreas: { area: WindProjectArea; distanceKm: number }[] = [];
  const farAreas: { area: WindProjectArea; distanceKm: number }[] = [];

  for (const area of projectAreas) {
    const d = distanceKm(locality.lat, locality.lng, area.centerLat, area.centerLng);
    if (d <= NEAR_RADIUS_KM) nearAreas.push({ area, distanceKm: d });
    else if (d <= FAR_RADIUS_KM) farAreas.push({ area, distanceKm: d });
  }

  // Distance score: how close the single nearest turbine/area is (closer = higher).
  const allDistances = [
    ...nearTurbines.map((t) => t.distanceKm),
    ...farTurbines.map((t) => t.distanceKm),
    ...nearAreas.map((a) => a.distanceKm),
    ...farAreas.map((a) => a.distanceKm),
  ];
  const closestDistanceKm = allDistances.length > 0 ? Math.min(...allDistances) : null;
  const distanceScore =
    closestDistanceKm === null ? 0 : clamp01(1 - closestDistanceKm / FAR_RADIUS_KM);

  // Existing turbines score: built/operating turbines nearby, weighted by proximity.
  const existingTurbinesScore = clamp01(
    nearTurbines.reduce((sum, t) => {
      if (t.turbine.status !== "uppfort") return sum;
      return sum + clamp01(1 - t.distanceKm / NEAR_RADIUS_KM);
    }, 0) / 3,
  );

  // Planned turbines score: pipeline (beviljat/handläggs/aktuellt) turbines + project areas.
  const plannedTurbinesScore = clamp01(
    (nearTurbines.reduce((sum, t) => {
      if (t.turbine.status === "uppfort") return sum;
      return sum + statusWeight(t.turbine.status) * clamp01(1 - t.distanceKm / NEAR_RADIUS_KM);
    }, 0) +
      nearAreas.reduce(
        (sum, a) => sum + statusWeight(a.area.status) * clamp01(1 - a.distanceKm / NEAR_RADIUS_KM),
        0,
      )) /
      5,
  );

  // Status score: highest-weighted status among everything within range.
  const statuses = [
    ...nearTurbines.map((t) => t.turbine.status),
    ...farTurbines.map((t) => t.turbine.status),
    ...nearAreas.map((a) => a.area.status),
    ...farAreas.map((a) => a.area.status),
  ];
  let dominantStatus: string | null = null;
  let statusScore = 0;
  for (const status of statuses) {
    const w = statusWeight(status);
    if (w > statusScore) {
      statusScore = w;
      dominantStatus = status;
    }
  }

  // Population score: smaller localities feel a bigger relative impact (inverse log scale).
  const population = locality.population ?? 200;
  const populationScore = clamp01(1 - Math.log10(Math.max(population, 50)) / 6);

  // Visibility score: combines turbine height + count within near radius (taller/more = more visible).
  const tallestNearby = nearTurbines.reduce(
    (max, t) => Math.max(max, t.turbine.totalHeightM ?? 0),
    0,
  );
  const visibilityScore = clamp01(
    (tallestNearby / 250) * 0.6 + clamp01(nearTurbines.length / 10) * 0.4,
  );

  const impactScore = clamp01(
    distanceScore * 0.25 +
      existingTurbinesScore * 0.25 +
      plannedTurbinesScore * 0.2 +
      statusScore * 0.1 +
      populationScore * 0.1 +
      visibilityScore * 0.1,
  );

  return {
    localityId: locality.id,
    countryCode: locality.countryCode,
    impactScore,
    distanceScore,
    plannedTurbinesScore,
    existingTurbinesScore,
    statusScore,
    populationScore,
    visibilityScore,
    turbineCountWithin25Km: nearTurbines.length,
    turbineCountWithin60Km: nearTurbines.length + farTurbines.length,
    projectAreaCountWithin25Km: nearAreas.length,
    projectAreaCountWithin60Km: nearAreas.length + farAreas.length,
    dominantStatus,
  };
}
