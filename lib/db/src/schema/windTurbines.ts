import {
  pgTable,
  serial,
  text,
  integer,
  doublePrecision,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { localitiesTable } from "./localities";
import { windProjectAreasTable } from "./windProjectAreas";

export const windTurbinesTable = pgTable(
  "wind_turbines",
  {
    id: serial("id").primaryKey(),
    countryCode: text("country_code").notNull(),
    externalId: text("external_id"),
    projectAreaId: integer("project_area_id").references(() => windProjectAreasTable.id),
    name: text("name").notNull(),
    status: text("status").notNull(),
    kommun: text("kommun"),
    region: text("region"),
    totalHeightM: doublePrecision("total_height_m"),
    hubHeightM: doublePrecision("hub_height_m"),
    rotorDiameterM: doublePrecision("rotor_diameter_m"),
    maxEffectMw: doublePrecision("max_effect_mw"),
    manufacturer: text("manufacturer"),
    model: text("model"),
    organisationName: text("organisation_name"),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    nearestLocalityId: integer("nearest_locality_id").references(() => localitiesTable.id),
    nearestLocalityDistanceKm: doublePrecision("nearest_locality_distance_km"),
    source: text("source").notNull(),
    lastUpdated: timestamp("last_updated", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("wind_turbines_country_code_idx").on(table.countryCode),
    index("wind_turbines_status_idx").on(table.status),
    index("wind_turbines_lat_lng_idx").on(table.lat, table.lng),
    index("wind_turbines_project_area_idx").on(table.projectAreaId),
    index("wind_turbines_nearest_locality_idx").on(table.nearestLocalityId),
    unique("wind_turbines_country_code_external_id_unique").on(table.countryCode, table.externalId),
  ],
);

export const insertWindTurbineSchema = createInsertSchema(windTurbinesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertWindTurbine = z.infer<typeof insertWindTurbineSchema>;
export type WindTurbine = typeof windTurbinesTable.$inferSelect;
