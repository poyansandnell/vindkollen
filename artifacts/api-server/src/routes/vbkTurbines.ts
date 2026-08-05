/**
 * GET /api/vbk-turbines?lat=X&lon=Y&radiusKm=8
 *
 * Hämtar enskilda vindkraftverk från Vindbrukskollen (Länsstyrelsen /
 * Energimyndigheten) via det publika ArcGIS Online FeatureServer.
 *
 * Returnerar turbinerna för det dominerande projektet (OMRID) inom bbox,
 * eller null om inga verk hittas. Koordinater i WGS84 (lat/lon).
 * Klienten konverterar själv till SWEREF99 via wgs84ToSweref().
 *
 * Cache: 1 timme per bbox-nyckel (lat/lon avrundade till 3 decimaler).
 *
 * VBK FeatureServer:
 *   https://services-eu1.arcgis.com/tvzS3dCZm1Mj9sOz/ArcGIS/rest/services/
 *   Vindkraftverk/FeatureServer/0
 *
 * Statuses som inkluderas (ej "Uppfört" — befintliga/gamla verk):
 *   Handläggs, Beviljade, Överklagade
 */

import { Router, type IRouter } from "express";

const router: IRouter = Router();

const VBK_FEATURE_URL =
  "https://services-eu1.arcgis.com/tvzS3dCZm1Mj9sOz/ArcGIS/rest/services/Vindkraftverk/FeatureServer/0/query";

/** Inkludera bara planerade/pågående verk — inte redan byggda. */
const VBK_STATUS_FILTER = `STATUS IN ('Handläggs','Beviljade','Överklagade')`;

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 timme

interface VbkTurbine {
  verkid: string;
  lat: number;
  lon: number;
  totalhojd: number | null;
  navhojd: number | null;
  rotdiamete: number | null;
}

export interface VbkResult {
  omrid: string;
  projnamn: string;
  status: string;
  turbines: VbkTurbine[];
}

type CacheEntry = { data: VbkResult | null; expiresAt: number };
const cache = new Map<string, CacheEntry>();

async function queryVbk(
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number,
): Promise<VbkResult | null> {
  const params = new URLSearchParams({
    geometry: `${minLon},${minLat},${maxLon},${maxLat}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    outSR: "4326",
    outFields: "VERKID,OMRID,PROJNAMN,STATUS,TOTALHOJD,NAVHOJD,ROTDIAMETE",
    where: VBK_STATUS_FILTER,
    resultRecordCount: "200",
    f: "json",
  });

  const res = await fetch(`${VBK_FEATURE_URL}?${params}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    features?: { attributes: Record<string, unknown>; geometry: { x: number; y: number } }[];
    error?: unknown;
  };
  if (data.error || !Array.isArray(data.features) || data.features.length === 0) return null;

  // Gruppera per OMRID och välj den grupp med flest verk.
  const groups = new Map<string, { attrs: Record<string, unknown>; turbines: VbkTurbine[] }>();

  for (const f of data.features) {
    const a = f.attributes;
    const g = f.geometry;
    const omrid = (a["OMRID"] as string | null) ?? "unknown";
    if (!groups.has(omrid)) {
      groups.set(omrid, { attrs: a, turbines: [] });
    }
    groups.get(omrid)!.turbines.push({
      verkid: (a["VERKID"] as string | null) ?? omrid,
      lat: g.y,
      lon: g.x,
      totalhojd: typeof a["TOTALHOJD"] === "number" && a["TOTALHOJD"] > 0 ? (a["TOTALHOJD"] as number) : null,
      navhojd: typeof a["NAVHOJD"] === "number" && a["NAVHOJD"] > 0 ? (a["NAVHOJD"] as number) : null,
      rotdiamete: typeof a["ROTDIAMETE"] === "number" && a["ROTDIAMETE"] > 0 ? (a["ROTDIAMETE"] as number) : null,
    });
  }

  // Välj den OMRID-grupp med flest turbiner.
  let best: VbkResult | null = null;
  let bestCount = 0;
  for (const [omrid, group] of groups) {
    if (group.turbines.length > bestCount) {
      bestCount = group.turbines.length;
      best = {
        omrid,
        projnamn: (group.attrs["PROJNAMN"] as string | null) ?? "",
        status: (group.attrs["STATUS"] as string | null) ?? "",
        turbines: group.turbines,
      };
    }
  }

  return best;
}

router.get("/vbk-turbines", async (req, res) => {
  const lat = parseFloat(req.query["lat"] as string);
  const lon = parseFloat(req.query["lon"] as string);
  const radiusKm = Math.min(parseFloat((req.query["radiusKm"] as string) || "8") || 8, 30);

  if (isNaN(lat) || isNaN(lon)) {
    res.status(400).json({ error: "lat och lon krävs" });
    return;
  }

  // Cachekey: avrunda till 3 decimaler (~111 m precision) + radiusKm.
  const cacheKey = `${lat.toFixed(3)}_${lon.toFixed(3)}_${radiusKm}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=7200");
    res.json(cached.data);
    return;
  }

  try {
    const latDelta = radiusKm / 111.32;
    const lonDelta = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
    const result = await queryVbk(lon - lonDelta, lat - latDelta, lon + lonDelta, lat + latDelta);

    cache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });

    res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=7200");
    res.json(result);
  } catch (err) {
    req.log.warn({ err }, "VBK FeatureServer fetch misslyckades");
    // Returnera null (tomt svar) — klienten faller tillbaka på rutnät-generering.
    res.json(null);
  }
});

export default router;
