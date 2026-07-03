import { Router, type IRouter } from "express";
import { and, eq, gte, lte, inArray, sql, desc } from "drizzle-orm";
import {
  db,
  windProjectAreasTable,
  windTurbinesTable,
  localitiesTable,
  localityImpactScoresTable,
  countriesTable,
} from "@workspace/db";
import { distanceKm, boundingBoxForRadius } from "@workspace/geo";
import {
  ListWindProjectAreasQueryParams,
  ListWindProjectAreasResponse,
  GetWindProjectAreaParams,
  GetWindProjectAreaResponse,
  ListWindTurbinesQueryParams,
  ListWindTurbinesResponse,
  GetWindTurbineParams,
  GetWindTurbineResponse,
  SearchLocalitiesQueryParams,
  SearchLocalitiesResponse,
  GetLocalityParams,
  GetLocalityResponse,
  ListBestLocalitiesToTestQueryParams,
  ListBestLocalitiesToTestResponse,
  GetWindSyncStatusResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function parseStatuses(statuses?: string): string[] | undefined {
  if (!statuses) return undefined;
  const list = statuses
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
}

router.get("/wind/project-areas", async (req, res) => {
  const query = ListWindProjectAreasQueryParams.parse(req.query);
  const statuses = parseStatuses(query.statuses);

  const conditions = [eq(windProjectAreasTable.countryCode, query.countryCode)];
  if (statuses) conditions.push(inArray(windProjectAreasTable.status, statuses));
  if (query.category) conditions.push(eq(windProjectAreasTable.category, query.category));

  const hasPoint = query.lat !== undefined && query.lng !== undefined;
  const hasBbox =
    query.minLat !== undefined &&
    query.minLng !== undefined &&
    query.maxLat !== undefined &&
    query.maxLng !== undefined;

  let bbox = null;
  if (hasPoint) {
    bbox = boundingBoxForRadius(query.lat as number, query.lng as number, query.radiusKm);
  } else if (hasBbox) {
    bbox = { minLat: query.minLat!, maxLat: query.maxLat!, minLng: query.minLng!, maxLng: query.maxLng! };
  }
  if (bbox) {
    conditions.push(gte(windProjectAreasTable.centerLat, bbox.minLat));
    conditions.push(lte(windProjectAreasTable.centerLat, bbox.maxLat));
    conditions.push(gte(windProjectAreasTable.centerLng, bbox.minLng));
    conditions.push(lte(windProjectAreasTable.centerLng, bbox.maxLng));
  }

  const rows = await db
    .select({
      area: windProjectAreasTable,
      nearestLocalityName: localitiesTable.name,
    })
    .from(windProjectAreasTable)
    .leftJoin(localitiesTable, eq(windProjectAreasTable.nearestLocalityId, localitiesTable.id))
    .where(and(...conditions))
    .limit(5000);

  let results = rows.map(({ area, nearestLocalityName }) => ({
    ...area,
    nearestLocalityName: nearestLocalityName ?? null,
    distanceKm: hasPoint
      ? distanceKm(query.lat as number, query.lng as number, area.centerLat, area.centerLng)
      : null,
  }));

  if (hasPoint) {
    results = results.filter((r) => (r.distanceKm ?? Infinity) <= query.radiusKm);
    results.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
  }

  res.json(ListWindProjectAreasResponse.parse(results));
});

router.get("/wind/project-areas/:id", async (req, res) => {
  const params = GetWindProjectAreaParams.parse(req.params);
  const [row] = await db
    .select({ area: windProjectAreasTable, nearestLocalityName: localitiesTable.name })
    .from(windProjectAreasTable)
    .leftJoin(localitiesTable, eq(windProjectAreasTable.nearestLocalityId, localitiesTable.id))
    .where(eq(windProjectAreasTable.id, params.id))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.json(
    GetWindProjectAreaResponse.parse({
      ...row.area,
      nearestLocalityName: row.nearestLocalityName ?? null,
    }),
  );
});

router.get("/wind/turbines", async (req, res) => {
  const query = ListWindTurbinesQueryParams.parse(req.query);
  const statuses = parseStatuses(query.statuses);

  const conditions = [eq(windTurbinesTable.countryCode, query.countryCode)];
  if (statuses) conditions.push(inArray(windTurbinesTable.status, statuses));

  const hasPoint = query.lat !== undefined && query.lng !== undefined;
  const hasBbox =
    query.minLat !== undefined &&
    query.minLng !== undefined &&
    query.maxLat !== undefined &&
    query.maxLng !== undefined;

  let bbox = null;
  if (hasPoint) {
    bbox = boundingBoxForRadius(query.lat as number, query.lng as number, query.radiusKm);
  } else if (hasBbox) {
    bbox = { minLat: query.minLat!, maxLat: query.maxLat!, minLng: query.minLng!, maxLng: query.maxLng! };
  }
  if (bbox) {
    conditions.push(gte(windTurbinesTable.lat, bbox.minLat));
    conditions.push(lte(windTurbinesTable.lat, bbox.maxLat));
    conditions.push(gte(windTurbinesTable.lng, bbox.minLng));
    conditions.push(lte(windTurbinesTable.lng, bbox.maxLng));
  }

  const rows = await db
    .select({ turbine: windTurbinesTable, nearestLocalityName: localitiesTable.name })
    .from(windTurbinesTable)
    .leftJoin(localitiesTable, eq(windTurbinesTable.nearestLocalityId, localitiesTable.id))
    .where(and(...conditions))
    .limit(query.limit);

  let results = rows.map(({ turbine, nearestLocalityName }) => ({
    ...turbine,
    nearestLocalityName: nearestLocalityName ?? null,
    distanceKm: hasPoint
      ? distanceKm(query.lat as number, query.lng as number, turbine.lat, turbine.lng)
      : null,
  }));

  if (hasPoint) {
    results = results.filter((r) => (r.distanceKm ?? Infinity) <= query.radiusKm);
    results.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
  }

  res.json(ListWindTurbinesResponse.parse(results.slice(0, query.limit)));
});

router.get("/wind/turbines/:id", async (req, res) => {
  const params = GetWindTurbineParams.parse(req.params);
  const [row] = await db
    .select({ turbine: windTurbinesTable, nearestLocalityName: localitiesTable.name })
    .from(windTurbinesTable)
    .leftJoin(localitiesTable, eq(windTurbinesTable.nearestLocalityId, localitiesTable.id))
    .where(eq(windTurbinesTable.id, params.id))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.json(
    GetWindTurbineResponse.parse({
      ...row.turbine,
      nearestLocalityName: row.nearestLocalityName ?? null,
    }),
  );
});

router.get("/wind/localities/search", async (req, res) => {
  const query = SearchLocalitiesQueryParams.parse(req.query);
  const q = query.q.toLowerCase();
  const term = `%${q}%`;
  const prefixTerm = `${q}%`;

  const relevanceRank = sql`
    case
      when lower(${localitiesTable.name}) = ${q} then 0
      when lower(${localitiesTable.name}) like ${prefixTerm} then 1
      when lower(${localitiesTable.name}) like ${term} then 2
      when lower(coalesce(${localitiesTable.kommun}, '')) like ${term} then 3
      else 4
    end
  `;

  const rows = await db
    .select()
    .from(localitiesTable)
    .where(
      and(
        eq(localitiesTable.countryCode, query.countryCode),
        sql`(lower(${localitiesTable.name}) like ${term} or lower(coalesce(${localitiesTable.kommun}, '')) like ${term} or lower(coalesce(${localitiesTable.region}, '')) like ${term})`,
      ),
    )
    .orderBy(relevanceRank, sql`${localitiesTable.population} desc nulls last`)
    .limit(query.limit);

  res.json(SearchLocalitiesResponse.parse(rows.map((r) => ({ ...r, distanceKm: null }))));
});

router.get("/wind/localities/best-to-test", async (req, res) => {
  const query = ListBestLocalitiesToTestQueryParams.parse(req.query);

  const rows = await db
    .select({ score: localityImpactScoresTable, locality: localitiesTable })
    .from(localityImpactScoresTable)
    .innerJoin(localitiesTable, eq(localityImpactScoresTable.localityId, localitiesTable.id))
    .where(eq(localityImpactScoresTable.countryCode, query.countryCode))
    .orderBy(desc(localityImpactScoresTable.impactScore))
    .limit(query.limit);

  const bestResults = rows.map(({ score, locality }, index) => ({
    rank: index + 1,
    locality: { ...locality, distanceKm: null },
    impactScore: score.impactScore,
    turbineCountWithin25Km: score.turbineCountWithin25Km,
    turbineCountWithin60Km: score.turbineCountWithin60Km,
    projectAreaCountWithin25Km: score.projectAreaCountWithin25Km,
    projectAreaCountWithin60Km: score.projectAreaCountWithin60Km,
    dominantStatus: score.dominantStatus ?? null,
  }));

  res.json(ListBestLocalitiesToTestResponse.parse(bestResults));
});

router.get("/wind/localities/:id", async (req, res) => {
  const params = GetLocalityParams.parse(req.params);
  const [locality] = await db.select().from(localitiesTable).where(eq(localitiesTable.id, params.id)).limit(1);

  if (!locality) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const [score] = await db
    .select()
    .from(localityImpactScoresTable)
    .where(eq(localityImpactScoresTable.localityId, locality.id))
    .limit(1);

  const RADIUS_60 = 60;

  const bbox = boundingBoxForRadius(locality.lat, locality.lng, RADIUS_60);

  const nearbyAreaRows = await db
    .select()
    .from(windProjectAreasTable)
    .where(
      and(
        eq(windProjectAreasTable.countryCode, locality.countryCode),
        gte(windProjectAreasTable.centerLat, bbox.minLat),
        lte(windProjectAreasTable.centerLat, bbox.maxLat),
        gte(windProjectAreasTable.centerLng, bbox.minLng),
        lte(windProjectAreasTable.centerLng, bbox.maxLng),
      ),
    );
  const nearbyProjectAreas = nearbyAreaRows
    .map((a) => ({
      ...a,
      nearestLocalityName: null,
      distanceKm: distanceKm(locality.lat, locality.lng, a.centerLat, a.centerLng),
    }))
    .filter((a) => (a.distanceKm ?? Infinity) <= RADIUS_60)
    .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0))
    .slice(0, 200);

  const nearbyTurbineRows = await db
    .select()
    .from(windTurbinesTable)
    .where(
      and(
        eq(windTurbinesTable.countryCode, locality.countryCode),
        gte(windTurbinesTable.lat, bbox.minLat),
        lte(windTurbinesTable.lat, bbox.maxLat),
        gte(windTurbinesTable.lng, bbox.minLng),
        lte(windTurbinesTable.lng, bbox.maxLng),
      ),
    );
  const nearbyTurbines = nearbyTurbineRows
    .map((t) => ({
      ...t,
      nearestLocalityName: null,
      distanceKm: distanceKm(locality.lat, locality.lng, t.lat, t.lng),
    }))
    .filter((t) => (t.distanceKm ?? Infinity) <= RADIUS_60)
    .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0))
    .slice(0, 500);

  res.json(
    GetLocalityResponse.parse({
      locality: { ...locality, distanceKm: null },
      impactScore: score?.impactScore ?? 0,
      scoreBreakdown: score
        ? {
            distanceScore: score.distanceScore,
            plannedTurbinesScore: score.plannedTurbinesScore,
            existingTurbinesScore: score.existingTurbinesScore,
            statusScore: score.statusScore,
            populationScore: score.populationScore,
            visibilityScore: score.visibilityScore,
          }
        : undefined,
      turbineCountWithin25Km: score?.turbineCountWithin25Km ?? 0,
      turbineCountWithin60Km: score?.turbineCountWithin60Km ?? 0,
      projectAreaCountWithin25Km: score?.projectAreaCountWithin25Km ?? 0,
      projectAreaCountWithin60Km: score?.projectAreaCountWithin60Km ?? 0,
      nearbyProjectAreas,
      nearbyTurbines,
    }),
  );
});

router.get("/wind/sync-status", async (req, res) => {
  const countryCode = typeof req.query.countryCode === "string" ? req.query.countryCode : "SE";

  const [country] = await db.select().from(countriesTable).where(eq(countriesTable.code, countryCode)).limit(1);

  const [{ count: projectAreaCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(windProjectAreasTable)
    .where(eq(windProjectAreasTable.countryCode, countryCode));
  const [{ count: turbineCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(windTurbinesTable)
    .where(eq(windTurbinesTable.countryCode, countryCode));
  const [{ count: localityCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(localitiesTable)
    .where(eq(localitiesTable.countryCode, countryCode));
  const [latestArea] = await db
    .select({ lastUpdated: windProjectAreasTable.updatedAt })
    .from(windProjectAreasTable)
    .where(eq(windProjectAreasTable.countryCode, countryCode))
    .orderBy(desc(windProjectAreasTable.updatedAt))
    .limit(1);

  res.json(
    GetWindSyncStatusResponse.parse({
      countryCode: country?.code ?? countryCode,
      projectAreaCount,
      turbineCount,
      localityCount,
      lastSyncedAt: latestArea?.lastUpdated ?? null,
    }),
  );
});

export default router;
