import { Router } from "express";
import type { Request, Response } from "express";

const router = Router();

interface LocationSettlement {
  name: string;
  lat: number;
  lng: number;
  population: number;
  households: number;
}

interface LocationProtectedArea {
  name: string;
  type: "nature" | "cultural" | "water";
  lat: number;
  lng: number;
  radiusM: number;
}

interface LocationContext {
  settlements: LocationSettlement[];
  protectedAreas: LocationProtectedArea[];
}

const PERSONS_PER_HOUSEHOLD = 2.0;

const PLACE_POPULATION: Record<string, number> = {
  city: 50000,
  town: 6000,
  village: 400,
  hamlet: 80,
  suburb: 2000,
};

type CacheEntry = { data: LocationContext; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000;

function cacheKey(lat: number, lng: number, radiusKm: number): string {
  return `${lat.toFixed(1)},${lng.toFixed(1)},${radiusKm}`;
}

async function fetchOverpass(query: string): Promise<unknown> {
  const resp = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "VindkraftSverige/1.0 (https://vindkraft.replit.app; contact@vindkraft.se)",
    },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(25000),
  });
  if (!resp.ok) throw new Error(`Overpass HTTP ${resp.status}`);
  return resp.json();
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

router.get("/location-context", async (req: Request, res: Response) => {
  const lat = parseFloat(req.query.lat as string);
  const lng = parseFloat(req.query.lng as string);
  const radiusKm = Math.min(parseFloat((req.query.radiusKm as string) || "50"), 80);

  if (isNaN(lat) || isNaN(lng)) {
    res.status(400).json({ error: "lat and lng required" });
    return;
  }

  const key = cacheKey(lat, lng, radiusKm);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    res.set("Cache-Control", "public, max-age=3600");
    res.json(cached.data);
    return;
  }

  const radiusM = Math.round(radiusKm * 1000);

  const query = `
[out:json][timeout:28];
(
  node["place"~"^(city|town|village|hamlet|suburb)$"](around:${radiusM},${lat},${lng});
  way["place"~"^(city|town|village|hamlet|suburb)$"](around:${radiusM},${lat},${lng});
  node["leisure"="nature_reserve"](around:${radiusM},${lat},${lng});
  way["leisure"="nature_reserve"](around:${radiusM},${lat},${lng});
  relation["leisure"="nature_reserve"](around:${radiusM},${lat},${lng});
  way["boundary"="protected_area"]["protect_class"~"^(1|2|3|4)$"](around:${radiusM},${lat},${lng});
  relation["boundary"="protected_area"]["protect_class"~"^(1|2|3|4)$"](around:${radiusM},${lat},${lng});
  way["boundary"="national_park"](around:${radiusM},${lat},${lng});
  relation["boundary"="national_park"](around:${radiusM},${lat},${lng});
);
out center tags;
`.trim();

  try {
    const raw = (await fetchOverpass(query)) as OverpassResponse;

    const settlements: LocationSettlement[] = [];
    const protectedAreas: LocationProtectedArea[] = [];
    const seenProtectedNames = new Set<string>();

    for (const el of raw.elements) {
      const tags = el.tags ?? {};
      const elLat = el.lat ?? el.center?.lat;
      const elLng = el.lon ?? el.center?.lon;
      if (!elLat || !elLng) continue;

      const place = tags["place"];
      if (place && Object.prototype.hasOwnProperty.call(PLACE_POPULATION, place)) {
        const name = tags["name:sv"] ?? tags["name"] ?? place;
        const rawPop = parseInt(tags["population"] ?? "", 10);
        const population = isNaN(rawPop) ? (PLACE_POPULATION[place] ?? 200) : rawPop;
        settlements.push({
          name,
          lat: elLat,
          lng: elLng,
          population,
          households: Math.round(population / PERSONS_PER_HOUSEHOLD),
        });
        continue;
      }

      if (
        tags["leisure"] === "nature_reserve" ||
        tags["boundary"] === "protected_area" ||
        tags["boundary"] === "national_park"
      ) {
        const name = tags["name:sv"] ?? tags["name"] ?? "Skyddat område";
        if (seenProtectedNames.has(name)) continue;
        seenProtectedNames.add(name);

        let areaType: "nature" | "cultural" | "water" = "nature";
        const protClass = parseInt(tags["protect_class"] ?? "", 10);
        if (protClass === 5 || tags["historic"]) areaType = "cultural";
        const nameLower = name.toLowerCase();
        if (nameLower.includes("vatten") || nameLower.includes("dricks") || nameLower.includes("vattenskydd")) {
          areaType = "water";
        }

        let radiusEstimate = 1500;
        if (tags["boundary"] === "national_park") radiusEstimate = 10000;
        else if (protClass <= 2) radiusEstimate = 5000;
        else if (protClass <= 4) radiusEstimate = 2000;

        protectedAreas.push({
          name,
          type: areaType,
          lat: elLat,
          lng: elLng,
          radiusM: radiusEstimate,
        });
      }
    }

    const deduped: LocationSettlement[] = [];
    for (const s of settlements) {
      const dup = deduped.find(
        (d) => Math.abs(d.lat - s.lat) < 0.01 && Math.abs(d.lng - s.lng) < 0.01,
      );
      if (!dup) {
        deduped.push(s);
      } else if (s.population > dup.population) {
        Object.assign(dup, s);
      }
    }

    const result: LocationContext = { settlements: deduped, protectedAreas };
    cache.set(key, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });

    res.set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "location-context: Overpass fetch failed");
    res.status(502).json({ error: "Could not fetch location data from Overpass" });
  }
});

export default router;
