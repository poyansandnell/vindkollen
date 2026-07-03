import {
  pgTable,
  serial,
  integer,
  doublePrecision,
  text,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { localitiesTable } from "./localities";

export const localityImpactScoresTable = pgTable(
  "locality_impact_scores",
  {
    id: serial("id").primaryKey(),
    localityId: integer("locality_id")
      .notNull()
      .references(() => localitiesTable.id),
    countryCode: text("country_code").notNull(),
    impactScore: doublePrecision("impact_score").notNull(),
    distanceScore: doublePrecision("distance_score").notNull(),
    plannedTurbinesScore: doublePrecision("planned_turbines_score").notNull(),
    existingTurbinesScore: doublePrecision("existing_turbines_score").notNull(),
    statusScore: doublePrecision("status_score").notNull(),
    populationScore: doublePrecision("population_score").notNull(),
    visibilityScore: doublePrecision("visibility_score").notNull(),
    turbineCountWithin25Km: integer("turbine_count_within_25km").notNull(),
    turbineCountWithin60Km: integer("turbine_count_within_60km").notNull(),
    projectAreaCountWithin25Km: integer("project_area_count_within_25km").notNull(),
    projectAreaCountWithin60Km: integer("project_area_count_within_60km").notNull(),
    dominantStatus: text("dominant_status"),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("locality_impact_scores_locality_id_unique").on(table.localityId),
    index("locality_impact_scores_country_code_idx").on(table.countryCode),
    index("locality_impact_scores_impact_score_idx").on(table.impactScore),
  ],
);

export const insertLocalityImpactScoreSchema = createInsertSchema(localityImpactScoresTable).omit({
  id: true,
  computedAt: true,
});
export type InsertLocalityImpactScore = z.infer<typeof insertLocalityImpactScoreSchema>;
export type LocalityImpactScore = typeof localityImpactScoresTable.$inferSelect;
