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
const POSTCODE_JOIN_RADIUS_KM = 15;

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

  if (adapter.fetchPostcodes) {
    log("fetching postcodes...");
    const normalizedPostcodes = await adapter.fetchPostcodes();
    log(`fetched ${normalizedPostcodes.length} postcodes, joining to nearest locality...`);

    const postcodesByLocalityId = new Map<number, Set<string>>();
    for (const p of normalizedPostcodes) {
      const nearest = localityIndex.nearest(p.lat, p.lng, POSTCODE_JOIN_RADIUS_KM);
      if (!nearest) continue;
      const set = postcodesByLocalityId.get(nearest.item.id) ?? new Set<string>();
      set.add(p.postcode);
      postcodesByLocalityId.set(nearest.item.id, set);
    }

    log(`updating postcodes for ${postcodesByLocalityId.size} localities...`);
    const localityIds = [...postcodesByLocalityId.keys()];
    for (let i = 0; i < localityIds.length; i += BATCH) {
      const batchIds = localityIds.slice(i, i + BATCH);
      await Promise.all(
        batchIds.map((localityId) =>
          db
            .update(localitiesTable)
            .set({ postcodes: [...(postcodesByLocalityId.get(localityId) ?? [])].sort() })
            .where(eq(localitiesTable.id, localityId)),
        ),
      );
      log(`  postcodes ${Math.min(i + BATCH, localityIds.length)}/${localityIds.length}`);
    }

    for (const locality of allLocalities) {
      const postcodes = postcodesByLocalityId.get(locality.id);
      if (postcodes) locality.postcodes = [...postcodes].sort();
    }
  }

  log("fetching project areas...");
  const normalizedAreas = await adapter.fetchProjectAreas();
  log(`fetched ${normalizedAreas.length} project areas, upserting...`);

  // Defensive dedup: ArcGIS resultOffset pagination can occasionally return
  // the same feature twice, which would otherwise violate the "ON CONFLICT
  // DO UPDATE cannot affect row a second time" constraint within one batch.
  const dedupedAreas = [...new Map(normalizedAreas.map((a) => [a.externalId, a])).values()];

  const projectAreas: WindProjectArea[] = [];
  for (let i = 0; i < dedupedAreas.length; i += BATCH) {
    const batch = dedupedAreas.slice(i, i + BATCH);
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
      .onConflictDoUpdate({
        target: [windProjectAreasTable.countryCode, windProjectAreasTable.externalId],
        set: {
          category: sql`excluded.category`,
          name: sql`excluded.name`,
          status: sql`excluded.status`,
          kommun: sql`excluded.kommun`,
          region: sql`excluded.region`,
          turbineCountPlannedMin: sql`excluded.turbine_count_planned_min`,
          turbineCountPlannedMax: sql`excluded.turbine_count_planned_max`,
          heightMaxM: sql`excluded.height_max_m`,
          installedEffectMw: sql`excluded.installed_effect_mw`,
          annualProductionGwh: sql`excluded.annual_production_gwh`,
          plannedConstructionStart: sql`excluded.planned_construction_start`,
          plannedOperationDate: sql`excluded.planned_operation_date`,
          organisationName: sql`excluded.organisation_name`,
          centerLat: sql`excluded.center_lat`,
          centerLng: sql`excluded.center_lng`,
          polygon: sql`excluded.polygon`,
          nearestLocalityId: sql`excluded.nearest_locality_id`,
          nearestLocalityDistanceKm: sql`excluded.nearest_locality_distance_km`,
          sourceLayer: sql`excluded.source_layer`,
          lastUpdated: sql`excluded.last_updated`,
          updatedAt: new Date(),
        },
      })
      .returning();
    projectAreas.push(...inserted);
    log(`  project areas ${Math.min(i + BATCH, normalizedAreas.length)}/${normalizedAreas.length}`);
  }
  // Re-read all project areas (batched inserts above don't return a single combined array).
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

  // Defensive dedup: ArcGIS resultOffset pagination can occasionally return
  // the same feature twice, which would otherwise violate the "ON CONFLICT
  // DO UPDATE cannot affect row a second time" constraint within one batch.
  const dedupedTurbines = [...new Map(normalizedTurbines.map((t) => [t.externalId, t])).values()];

  const turbines: WindTurbine[] = [];
  for (let i = 0; i < dedupedTurbines.length; i += BATCH) {
    const batch = dedupedTurbines.slice(i, i + BATCH);
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
      .onConflictDoUpdate({
        target: [windTurbinesTable.countryCode, windTurbinesTable.externalId],
        set: {
          projectAreaId: sql`excluded.project_area_id`,
          name: sql`excluded.name`,
          status: sql`excluded.status`,
          kommun: sql`excluded.kommun`,
          region: sql`excluded.region`,
          totalHeightM: sql`excluded.total_height_m`,
          hubHeightM: sql`excluded.hub_height_m`,
          rotorDiameterM: sql`excluded.rotor_diameter_m`,
          maxEffectMw: sql`excluded.max_effect_mw`,
          manufacturer: sql`excluded.manufacturer`,
          model: sql`excluded.model`,
          organisationName: sql`excluded.organisation_name`,
          lat: sql`excluded.lat`,
          lng: sql`excluded.lng`,
          nearestLocalityId: sql`excluded.nearest_locality_id`,
          nearestLocalityDistanceKm: sql`excluded.nearest_locality_distance_km`,
          lastUpdated: sql`excluded.last_updated`,
          updatedAt: new Date(),
        },
      })
      .returning();
    turbines.push(...inserted);
    log(`  turbines ${Math.min(i + BATCH, normalizedTurbines.length)}/${normalizedTurbines.length}`);
  }
  // Re-read all turbines (batched inserts above don't return a single combined array).
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
