import {
  pgTable,
  serial,
  text,
  integer,
  doublePrecision,
  timestamp,
  jsonb,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { localitiesTable } from "./localities";

export const windProjectAreasTable = pgTable(
  "wind_project_areas",
  {
    id: serial("id").primaryKey(),
    countryCode: text("country_code").notNull(),
    externalId: text("external_id"),
    category: text("category").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull(),
    kommun: text("kommun"),
    region: text("region"),
    turbineCountPlannedMin: integer("turbine_count_planned_min"),
    turbineCountPlannedMax: integer("turbine_count_planned_max"),
    heightMaxM: doublePrecision("height_max_m"),
    installedEffectMw: doublePrecision("installed_effect_mw"),
    annualProductionGwh: doublePrecision("annual_production_gwh"),
    plannedConstructionStart: text("planned_construction_start"),
    plannedOperationDate: text("planned_operation_date"),
    organisationName: text("organisation_name"),
    centerLat: doublePrecision("center_lat").notNull(),
    centerLng: doublePrecision("center_lng").notNull(),
    polygon: jsonb("polygon"),
    nearestLocalityId: integer("nearest_locality_id").references(() => localitiesTable.id),
    nearestLocalityDistanceKm: doublePrecision("nearest_locality_distance_km"),
    source: text("source").notNull(),
    sourceLayer: text("source_layer").notNull(),
    lastUpdated: timestamp("last_updated", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("wind_project_areas_country_code_idx").on(table.countryCode),
    index("wind_project_areas_status_idx").on(table.status),
    index("wind_project_areas_category_idx").on(table.category),
    index("wind_project_areas_center_idx").on(table.centerLat, table.centerLng),
    index("wind_project_areas_nearest_locality_idx").on(table.nearestLocalityId),
    unique("wind_project_areas_country_code_external_id_unique").on(table.countryCode, table.externalId),
  ],
);

export const insertWindProjectAreaSchema = createInsertSchema(windProjectAreasTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertWindProjectArea = z.infer<typeof insertWindProjectAreaSchema>;
export type WindProjectArea = typeof windProjectAreasTable.$inferSelect;
