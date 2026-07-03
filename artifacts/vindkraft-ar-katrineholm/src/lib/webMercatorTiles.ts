// Delad Web Mercator-plattmatematik (samma projektion som "slippy map"-
// plattor, t.ex. OSM/Esri World Imagery) — används av både `MapView.tsx`
// (nationell/lokal AR-karta) och `PlacementMap.tsx` (Ericsberg-placeringsläget)
// så att flygfotologiken bara behöver underhållas på ett ställe.

export const METERS_PER_DEGREE_LAT = 111320;

export interface LatLonBounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface MapTile {
  key: string;
  url: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export function lon2tileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z;
}

export function lat2tileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
}

export function tileX2lon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

export function tileY2lat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * Breddar den kortare geografiska dimensionen (i grader) i en bounding box så
 * att dess bildförhållande i meter matchar containerns faktiska
 * bildförhållande i pixlar — annars sträcks kartan ut olika mycket i x- och
 * y-led när containern roterar/ändrar storlek.
 */
export function fitBoundsToAspect(raw: LatLonBounds, containerAspect: number): LatLonBounds {
  const centerLat = (raw.minLat + raw.maxLat) / 2;
  const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos((centerLat * Math.PI) / 180);
  const latMeters = (raw.maxLat - raw.minLat) * METERS_PER_DEGREE_LAT;
  const lonMeters = (raw.maxLon - raw.minLon) * metersPerDegreeLon;
  const boundsAspect = lonMeters / latMeters || 1;

  if (boundsAspect > containerAspect) {
    const targetLatMeters = lonMeters / containerAspect;
    const extraLatDeg = (targetLatMeters - latMeters) / METERS_PER_DEGREE_LAT / 2;
    return { ...raw, minLat: raw.minLat - extraLatDeg, maxLat: raw.maxLat + extraLatDeg };
  }
  if (boundsAspect < containerAspect) {
    const targetLonMeters = latMeters * containerAspect;
    const extraLonDeg = (targetLonMeters - lonMeters) / metersPerDegreeLon / 2;
    return { ...raw, minLon: raw.minLon - extraLonDeg, maxLon: raw.maxLon + extraLonDeg };
  }
  return raw;
}

/** Skapar en projektionsfunktion WGS84 -> 0-100% SVG-koordinater för en given bounding box. */
export function makeProjector(bounds: LatLonBounds) {
  return function project(lat: number, lon: number): { x: number; y: number } {
    const x = ((lon - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * 100;
    const y = 100 - ((lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * 100;
    return { x, y };
  };
}

export interface TileLayoutOptions {
  maxTiles: number;
  maxZoom: number;
  retinaZoomBias: number;
  tileUrlTemplate: (zoom: number, x: number, y: number) => string;
}

/**
 * Hittar högsta zoomnivå (mest detaljerad flygfoto) där antalet plattor som
 * täcker bounding-boxen fortfarande är rimligt, och bygger listan av
 * plattor som procentuella rektanglar inom den redan projicerade vyn.
 */
export function computeTileLayout(
  bounds: LatLonBounds,
  project: (lat: number, lon: number) => { x: number; y: number },
  options: TileLayoutOptions,
): { zoom: number; tiles: MapTile[] } {
  const { maxTiles, maxZoom, retinaZoomBias, tileUrlTemplate } = options;

  let zoom = maxZoom + retinaZoomBias;
  let tileRange: { zoom: number; x1: number; x2: number; y1: number; y2: number } | null = null;
  for (; zoom >= 9; zoom--) {
    const x1 = Math.floor(lon2tileX(bounds.minLon, zoom));
    const x2 = Math.floor(lon2tileX(bounds.maxLon, zoom));
    const y1 = Math.floor(lat2tileY(bounds.maxLat, zoom));
    const y2 = Math.floor(lat2tileY(bounds.minLat, zoom));
    const count = (x2 - x1 + 1) * (y2 - y1 + 1);
    if (count <= maxTiles) {
      tileRange = { zoom, x1, x2, y1, y2 };
      break;
    }
  }

  const tiles: MapTile[] = [];
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
          url: tileUrlTemplate(tileRange.zoom, tx, ty),
          left: topLeft.x,
          top: topLeft.y,
          width: bottomRight.x - topLeft.x,
          height: bottomRight.y - topLeft.y,
        });
      }
    }
  }

  return { zoom: tileRange?.zoom ?? zoom, tiles };
}

export const ESRI_WORLD_IMAGERY_URL = (zoom: number, x: number, y: number): string =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${x}`;
