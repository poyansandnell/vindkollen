import { SpatialIndex } from "@workspace/geo";
import {
  db,
  countriesTable,
  localitiesTable,
  windProjectAreasTable,
  windTurbinesTable,
  localityImpactScoresTable,
  type Locality,
  type WindProjectArea,
  type WindTurbine,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { swedenAdapter } from "./adapters/sweden";
import type { CountryWindDataAdapter } from "./adapters/types";
import { computeLocalityImpactScore } from "./impactScore";

const ADAPTERS: CountryWindDataAdapter[] = [swedenAdapter];

const NEAREST_LOCALITY_SEARCH_RADIUS_KM = 60;
const IMPACT_SCORE_RADIUS_KM = 60;

async function syncCountry(adapter: CountryWindDataAdapter): Promise<void> {
  const log = (msg: string) => console.log(`[wind-sync:${adapter.countryCode}] ${msg}`);

  log("upserting country row...");
  await db
    .insert(countriesTable)
    .values({ code: adapter.countryCode, name: adapter.countryName })
    .onConflictDoNothing();

  log("fetching localities...");
  const normalizedLocalities = await adapter.fetchLocalities();
  log(`fetched ${normalizedLocalities.length} localities, upserting...`);

  const BATCH = 1000;
  for (let i = 0; i < normalizedLocalities.length; i += BATCH) {
    const batch = normalizedLocalities.slice(i, i + BATCH);
    await db
      .insert(localitiesTable)
      .values(
        batch.map((l) => ({
          countryCode: adapter.countryCode,
          externalId: l.externalId,
          name: l.name,
          kommun: l.kommun,
          region: l.region,
          population: l.population,
          lat: l.lat,
          lng: l.lng,
          source: l.source,
        })),
      )
      .onConflictDoUpdate({
        target: [localitiesTable.countryCode, localitiesTable.externalId],
        set: {
          name: sql`excluded.name`,
          kommun: sql`excluded.kommun`,
          region: sql`excluded.region`,
          population: sql`excluded.population`,
          lat: sql`excluded.lat`,
          lng: sql`excluded.lng`,
        },
      });
    log(`  localities ${Math.min(i + BATCH, normalizedLocalities.length)}/${normalizedLocalities.length}`);
  }
  // Re-read all localities for this country (onConflictDoNothing skips returning existing rows).
  const allLocalities = await db
    .select()
    .from(localitiesTable)
    .where(eq(localitiesTable.countryCode, adapter.countryCode));
  log(`total localities in DB for ${adapter.countryCode}: ${allLocalities.length}`);

  const localityIndex = new SpatialIndex<Locality>(allLocalities, (l) => ({ lat: l.lat, lng: l.lng }));

  log("fetching project areas...");
  const normalizedAreas = await adapter.fetchProjectAreas();
  log(`fetched ${normalizedAreas.length} project areas, upserting...`);

  const projectAreas: WindProjectArea[] = [];
  for (let i = 0; i < normalizedAreas.length; i += BATCH) {
    const batch = normalizedAreas.slice(i, i + BATCH);
    const inserted = await db
      .insert(windProjectAreasTable)
      .values(
        batch.map((a) => {
          const nearest = localityIndex.nearest(a.centerLat, a.centerLng, NEAREST_LOCALITY_SEARCH_RADIUS_KM);
          return {
            countryCode: adapter.countryCode,
            externalId: a.externalId,
            category: a.category,
            name: a.name,
            status: a.status,
            kommun: a.kommun,
            region: a.region,
            turbineCountPlannedMin: a.turbineCountPlannedMin,
            turbineCountPlannedMax: a.turbineCountPlannedMax,
            heightMaxM: a.heightMaxM,
            installedEffectMw: a.installedEffectMw,
            annualProductionGwh: a.annualProductionGwh,
            plannedConstructionStart: a.plannedConstructionStart,
            plannedOperationDate: a.plannedOperationDate,
            organisationName: a.organisationName,
            centerLat: a.centerLat,
            centerLng: a.centerLng,
            polygon: a.polygon,
            nearestLocalityId: nearest?.item.id ?? null,
            nearestLocalityDistanceKm: nearest?.distanceKm ?? null,
            source: a.source,
            sourceLayer: a.sourceLayer,
            lastUpdated: a.lastUpdated ? new Date(a.lastUpdated) : null,
          };
        }),
      )
      .onConflictDoNothing()
      .returning();
    projectAreas.push(...inserted);
    log(`  project areas ${Math.min(i + BATCH, normalizedAreas.length)}/${normalizedAreas.length}`);
  }
  // Re-read all project areas (onConflictDoNothing skips returning existing rows on reruns).
  const allProjectAreas = await db
    .select()
    .from(windProjectAreasTable)
    .where(eq(windProjectAreasTable.countryCode, adapter.countryCode));
  log(`total project areas in DB for ${adapter.countryCode}: ${allProjectAreas.length}`);

  log("fetching turbines...");
  const normalizedTurbines = await adapter.fetchTurbines();
  log(`fetched ${normalizedTurbines.length} turbines, upserting...`);

  const projectAreaByExternalId = new Map(
    allProjectAreas.filter((a) => a.externalId).map((a) => [a.externalId as string, a]),
  );

  const turbines: WindTurbine[] = [];
  for (let i = 0; i < normalizedTurbines.length; i += BATCH) {
    const batch = normalizedTurbines.slice(i, i + BATCH);
    const inserted = await db
      .insert(windTurbinesTable)
      .values(
        batch.map((t) => {
          const nearest = localityIndex.nearest(t.lat, t.lng, NEAREST_LOCALITY_SEARCH_RADIUS_KM);
          const projectArea = t.projectAreaExternalId
            ? projectAreaByExternalId.get(t.projectAreaExternalId)
            : undefined;
          return {
            countryCode: adapter.countryCode,
            externalId: t.externalId,
            projectAreaId: projectArea?.id ?? null,
            name: t.name,
            status: t.status,
            kommun: t.kommun,
            region: t.region,
            totalHeightM: t.totalHeightM,
            hubHeightM: t.hubHeightM,
            rotorDiameterM: t.rotorDiameterM,
            maxEffectMw: t.maxEffectMw,
            manufacturer: t.manufacturer,
            model: t.model,
            organisationName: t.organisationName,
            lat: t.lat,
            lng: t.lng,
            nearestLocalityId: nearest?.item.id ?? null,
            nearestLocalityDistanceKm: nearest?.distanceKm ?? null,
            source: t.source,
            lastUpdated: t.lastUpdated ? new Date(t.lastUpdated) : null,
          };
        }),
      )
      .onConflictDoNothing()
      .returning();
    turbines.push(...inserted);
    log(`  turbines ${Math.min(i + BATCH, normalizedTurbines.length)}/${normalizedTurbines.length}`);
  }
  // Re-read all turbines (onConflictDoNothing skips returning existing rows on reruns).
  const allTurbines = await db
    .select()
    .from(windTurbinesTable)
    .where(eq(windTurbinesTable.countryCode, adapter.countryCode));
  log(`total turbines in DB for ${adapter.countryCode}: ${allTurbines.length}`);

  log("computing locality impact scores...");
  const turbineIndex = new SpatialIndex<WindTurbine>(allTurbines, (t) => ({ lat: t.lat, lng: t.lng }));
  const areaIndex = new SpatialIndex<WindProjectArea>(allProjectAreas, (a) => ({ lat: a.centerLat, lng: a.centerLng }));

  let scored = 0;
  for (let i = 0; i < allLocalities.length; i += BATCH) {
    const batch = allLocalities.slice(i, i + BATCH);
    const rows = batch.map((locality) =>
      computeLocalityImpactScore({
        locality,
        turbines: turbineIndex
          .within(locality.lat, locality.lng, IMPACT_SCORE_RADIUS_KM)
          .map((r) => r.item),
        projectAreas: areaIndex
          .within(locality.lat, locality.lng, IMPACT_SCORE_RADIUS_KM)
          .map((r) => r.item),
      }),
    );
    await db
      .insert(localityImpactScoresTable)
      .values(rows)
      .onConflictDoUpdate({
        target: localityImpactScoresTable.localityId,
        set: {
          impactScore: sql`excluded.impact_score`,
          distanceScore: sql`excluded.distance_score`,
          plannedTurbinesScore: sql`excluded.planned_turbines_score`,
          existingTurbinesScore: sql`excluded.existing_turbines_score`,
          statusScore: sql`excluded.status_score`,
          populationScore: sql`excluded.population_score`,
          visibilityScore: sql`excluded.visibility_score`,
          turbineCountWithin25Km: sql`excluded.turbine_count_within_25km`,
          turbineCountWithin60Km: sql`excluded.turbine_count_within_60km`,
          projectAreaCountWithin25Km: sql`excluded.project_area_count_within_25km`,
          projectAreaCountWithin60Km: sql`excluded.project_area_count_within_60km`,
          dominantStatus: sql`excluded.dominant_status`,
          computedAt: new Date(),
        },
      });
    scored += batch.length;
    log(`  impact scores ${scored}/${allLocalities.length}`);
  }

  log(
    `done: ${allLocalities.length} localities, ${allProjectAreas.length} project areas, ${allTurbines.length} turbines, ${allLocalities.length} impact scores.`,
  );
}

async function main() {
  for (const adapter of ADAPTERS) {
    await syncCountry(adapter);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[wind-sync] fatal error:", err);
  process.exit(1);
});
