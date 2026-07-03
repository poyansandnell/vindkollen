import { distanceKm } from "./distance";

const LAT_CELL_DEG = 0.5;

function lngCellDeg(lat: number): number {
  const cos = Math.cos((lat * Math.PI) / 180);
  return Math.max(0.5, 1 / Math.max(cos, 0.2));
}

function cellKey(latIdx: number, lngIdx: number): string {
  return `${latIdx}:${lngIdx}`;
}

/**
 * A coarse lat/lng grid index for fast "points within radius" queries over
 * large point sets (tens of thousands+), avoiding O(n*m) haversine scans.
 * Cell size is tuned for radius queries up to ~60-100km at Swedish latitudes.
 */
export class SpatialIndex<T> {
  private cells = new Map<string, { lat: number; lng: number; item: T }[]>();

  constructor(items: T[], getLatLng: (item: T) => { lat: number; lng: number }) {
    for (const item of items) {
      const { lat, lng } = getLatLng(item);
      const latIdx = Math.floor(lat / LAT_CELL_DEG);
      const lngIdx = Math.floor(lng / lngCellDeg(lat));
      const key = cellKey(latIdx, lngIdx);
      const bucket = this.cells.get(key);
      if (bucket) bucket.push({ lat, lng, item });
      else this.cells.set(key, [{ lat, lng, item }]);
    }
  }

  /** Returns all items within `radiusKm` of (lat, lng), with their distance. */
  within(lat: number, lng: number, radiusKm: number): { item: T; distanceKm: number }[] {
    const lngCell = lngCellDeg(lat);
    const latSpan = Math.ceil(radiusKm / (LAT_CELL_DEG * 111.32)) + 1;
    const lngSpan = Math.ceil(radiusKm / (lngCell * 111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.2))) + 1;

    const centerLatIdx = Math.floor(lat / LAT_CELL_DEG);
    const centerLngIdx = Math.floor(lng / lngCell);

    const results: { item: T; distanceKm: number }[] = [];
    for (let dLat = -latSpan; dLat <= latSpan; dLat++) {
      for (let dLng = -lngSpan; dLng <= lngSpan; dLng++) {
        const bucket = this.cells.get(cellKey(centerLatIdx + dLat, centerLngIdx + dLng));
        if (!bucket) continue;
        for (const entry of bucket) {
          const d = distanceKm(lat, lng, entry.lat, entry.lng);
          if (d <= radiusKm) results.push({ item: entry.item, distanceKm: d });
        }
      }
    }
    return results;
  }

  /** Returns the single nearest item within `maxRadiusKm`, or null if none found. */
  nearest(lat: number, lng: number, maxRadiusKm: number): { item: T; distanceKm: number } | null {
    const candidates = this.within(lat, lng, maxRadiusKm);
    if (candidates.length === 0) return null;
    let best = candidates[0];
    for (const c of candidates) {
      if (c.distanceKm < best.distanceKm) best = c;
    }
    return best;
  }
}
