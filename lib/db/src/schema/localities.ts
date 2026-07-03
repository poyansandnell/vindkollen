import { pgTable, serial, text, integer, doublePrecision, timestamp, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const localitiesTable = pgTable(
  "localities",
  {
    id: serial("id").primaryKey(),
    countryCode: text("country_code").notNull(),
    externalId: text("external_id"),
    name: text("name").notNull(),
    kommun: text("kommun"),
    region: text("region"),
    population: integer("population"),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    source: text("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("localities_country_code_idx").on(table.countryCode),
    index("localities_name_idx").on(table.name),
    index("localities_lat_lng_idx").on(table.lat, table.lng),
    unique("localities_country_code_external_id_unique").on(table.countryCode, table.externalId),
  ],
);

export const insertLocalitySchema = createInsertSchema(localitiesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertLocality = z.infer<typeof insertLocalitySchema>;
export type Locality = typeof localitiesTable.$inferSelect;
