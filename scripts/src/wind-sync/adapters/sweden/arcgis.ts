const BASE_URL =
  "https://ext-geodata-applikationer.lansstyrelsen.se/arcgis/rest/services/VBK/lst_vbk_wms_vindbrukskollen/MapServer";
const PAGE_SIZE = 2000;

interface ArcGisFeature<TAttrs> {
  attributes: TAttrs;
  geometry?: {
    x?: number;
    y?: number;
    rings?: number[][][];
  };
}

interface ArcGisQueryResponse<TAttrs> {
  features: ArcGisFeature<TAttrs>[];
  exceededTransferLimit?: boolean;
  error?: { code: number; message: string };
}

export async function queryArcGisLayer<TAttrs>(
  layerId: number,
  outFields = "*",
): Promise<ArcGisFeature<TAttrs>[]> {
  const results: ArcGisFeature<TAttrs>[] = [];
  let offset = 0;

  for (;;) {
    const url = new URL(`${BASE_URL}/${layerId}/query`);
    url.searchParams.set("where", "1=1");
    url.searchParams.set("outFields", outFields);
    url.searchParams.set("returnGeometry", "true");
    url.searchParams.set("outSR", "4326");
    url.searchParams.set("f", "json");
    url.searchParams.set("resultOffset", String(offset));
    url.searchParams.set("resultRecordCount", String(PAGE_SIZE));

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`ArcGIS layer ${layerId} query failed: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as ArcGisQueryResponse<TAttrs>;
    if (body.error) {
      throw new Error(`ArcGIS layer ${layerId} query error ${body.error.code}: ${body.error.message}`);
    }

    results.push(...body.features);

    if (!body.exceededTransferLimit || body.features.length === 0) break;
    offset += body.features.length;
  }

  return results;
}

export function ringsToGeoJsonPolygon(
  rings: number[][][] | undefined,
): { type: "Polygon"; coordinates: number[][][] } | null {
  if (!rings || rings.length === 0) return null;
  return { type: "Polygon", coordinates: rings };
}

export function polygonCentroid(rings: number[][][] | undefined): { lat: number; lng: number } | null {
  if (!rings || rings.length === 0) return null;
  const outer = rings[0];
  if (!outer || outer.length === 0) return null;
  let sumLng = 0;
  let sumLat = 0;
  for (const [lng, lat] of outer) {
    sumLng += lng;
    sumLat += lat;
  }
  return { lat: sumLat / outer.length, lng: sumLng / outer.length };
}

export function esriDateToIso(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export type { ArcGisFeature };
