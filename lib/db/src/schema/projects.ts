import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const userProjectsTable = pgTable(
  "user_projects",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id"),
    name: varchar("name").notNull().default("Mitt projekt"),
    location: varchar("location"),
    municipality: varchar("municipality"),
    turbines: jsonb("turbines").notNull().default(sql`'[]'::jsonb`),
    analysisResult: jsonb("analysis_result"),
    shareToken: varchar("share_token").unique(),
    centerLat: text("center_lat"),
    centerLng: text("center_lng"),
    turbineCount: text("turbine_count").notNull().default("0"),
    totalScore: text("total_score"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("IDX_user_projects_user_id").on(table.userId),
    index("IDX_user_projects_share_token").on(table.shareToken),
  ],
);

export type UserProject = typeof userProjectsTable.$inferSelect;
export type InsertUserProject = typeof userProjectsTable.$inferInsert;
