import type { WindTurbine, WindProjectArea } from "@workspace/api-client-react";
import { statusColor } from "./statusMeta";

export function turbinesToGeoJson(turbines: WindTurbine[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: turbines
      .filter((t) => typeof t.lat === "number" && typeof t.lng === "number")
      .map((t) => ({
        type: "Feature",
        id: t.id,
        geometry: { type: "Point", coordinates: [t.lng as number, t.lat as number] },
        properties: {
          id: t.id,
          kind: "turbine",
          name: t.name,
          status: t.status,
          color: statusColor(t.status),
          distanceKm: t.distanceKm ?? null,
          totalHeightM: t.totalHeightM ?? null,
        },
      })),
  };
}

export function projectAreasToPointGeoJson(areas: WindProjectArea[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: areas
      .filter((a) => typeof a.centerLat === "number" && typeof a.centerLng === "number")
      .map((a) => ({
        type: "Feature",
        id: a.id,
        geometry: { type: "Point", coordinates: [a.centerLng as number, a.centerLat as number] },
        properties: {
          id: a.id,
          kind: "projectArea",
          name: a.name,
          status: a.status,
          category: a.category,
          color: statusColor(a.status),
          distanceKm: a.distanceKm ?? null,
          hasPolygon: !!a.polygon,
        },
      })),
  };
}

export function projectAreasToPolygonGeoJson(areas: WindProjectArea[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: areas
      .filter((a) => !!a.polygon)
      .map((a) => ({
        type: "Feature",
        id: a.id,
        geometry: a.polygon as unknown as GeoJSON.Geometry,
        properties: {
          id: a.id,
          kind: "projectArea",
          name: a.name,
          status: a.status,
          category: a.category,
          color: statusColor(a.status),
          distanceKm: a.distanceKm ?? null,
        },
      })),
  };
}
