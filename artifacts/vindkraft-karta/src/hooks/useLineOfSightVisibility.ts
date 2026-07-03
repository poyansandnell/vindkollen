import { useEffect, useRef, useState } from "react";
import type mapboxgl from "mapbox-gl";
import {
  evaluateLineOfSight,
  haversineDistanceKm,
  interpolateLngLat,
  sampleCountForDistance,
  FALLBACK_TARGET_HEIGHT_M,
  type VisibilityStatus,
} from "@/lib/lineOfSight";

export interface SightTarget {
  key: string;
  lat: number;
  lng: number;
  heightM: number | null;
}

export interface SightVisibilityResult {
  status: VisibilityStatus;
  distanceKm: number;
}

// Bounds how many targets get a full line-of-sight pass, keeping the check responsive even when
// hundreds of turbines/areas are loaded around the observer. Closest targets are prioritized.
const MAX_TARGETS = 150;
// Elevation tiles may still be loading right after the observer point is placed, so we retry a
// couple of times as tiles arrive rather than requiring the caller to track tile-load events.
const RETRY_DELAYS_MS = [0, 700, 2000];

function queryElevation(map: mapboxgl.Map, lat: number, lng: number): number | null {
  try {
    const elevation = map.queryTerrainElevation({ lng, lat } as mapboxgl.LngLatLike);
    return typeof elevation === "number" && Number.isFinite(elevation) ? elevation : null;
  } catch {
    return null;
  }
}

export function useLineOfSightVisibility(
  map: mapboxgl.Map | null,
  observer: { lat: number; lng: number } | null,
  targets: SightTarget[],
): { results: Map<string, SightVisibilityResult>; computing: boolean } {
  const [results, setResults] = useState<Map<string, SightVisibilityResult>>(new Map());
  const [computing, setComputing] = useState(false);
  const generationRef = useRef(0);

  useEffect(() => {
    if (!map || !observer || targets.length === 0) {
      setResults((prev) => (prev.size === 0 ? prev : new Map()));
      setComputing((prev) => (prev ? false : prev));
      return;
    }

    const generation = ++generationRef.current;
    const nearestTargets = targets
      .map((t) => ({ ...t, distanceKm: haversineDistanceKm(observer.lat, observer.lng, t.lat, t.lng) }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, MAX_TARGETS);

    let cancelled = false;
    setComputing(true);

    const runPass = () => {
      if (cancelled || generationRef.current !== generation) return;
      const next = new Map<string, SightVisibilityResult>();

      for (const target of nearestTargets) {
        const observerElevationM = queryElevation(map, observer.lat, observer.lng);
        const targetElevationM = queryElevation(map, target.lat, target.lng);
        const sampleCount = sampleCountForDistance(target.distanceKm);
        const samples = [];
        for (let i = 1; i < sampleCount; i++) {
          const fraction = i / sampleCount;
          const point = interpolateLngLat(observer.lat, observer.lng, target.lat, target.lng, fraction);
          samples.push({
            distanceKm: target.distanceKm * fraction,
            elevationM: queryElevation(map, point.lat, point.lng),
          });
        }

        const status = evaluateLineOfSight({
          observerElevationM,
          targetElevationM,
          targetHeightM: target.heightM ?? FALLBACK_TARGET_HEIGHT_M,
          totalDistanceKm: target.distanceKm,
          samples,
        });

        next.set(target.key, { status, distanceKm: target.distanceKm });
      }

      if (!cancelled && generationRef.current === generation) {
        setResults(next);
      }
    };

    const timers = RETRY_DELAYS_MS.map((delay) => setTimeout(runPass, delay));
    const stopTimer = setTimeout(
      () => {
        if (!cancelled && generationRef.current === generation) setComputing(false);
      },
      RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] + 300,
    );

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      clearTimeout(stopTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, observer?.lat, observer?.lng, targets]);

  return { results, computing };
}
