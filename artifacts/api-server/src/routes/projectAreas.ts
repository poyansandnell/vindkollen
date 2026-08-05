/**
 * GET /api/project-areas
 *
 * Returnerar hela listan av vindkraftsprojekt som ApiProjectArea[].
 * Används av AR-appen för att cacha projektregistret lokalt och slippa
 * baka in det i JS-bunten vid varje native-bygge.
 *
 * - Polygon exkluderas som standard (för tung payload); lägg till
 *   ?polygon=true om du behöver geometri.
 * - Svarets form matchar ApiProjectArea i klienten.
 * - Servercache 1 timme (hämtar ur DB en gång per timme).
 * - Kampanjkonfiguration för Katrineholm (intern id=32) injiceras här.
 */

import { Router, type IRouter } from "express";
import { eq, getTableColumns } from "drizzle-orm";
import { db, windProjectAreasTable } from "@workspace/db";

const router: IRouter = Router();

// ── Kampanjkonfiguration (server-side, uppdateringsbar utan ny appversion) ──
const CAMPAIGN_PROJECT_ID = 32; // Katrineholm Vind by Ericsberg (intern DB-id)
const CAMPAIGN_CONFIG = {
  enabled: true,
  type: "referendum-interest" as const,
  title: "Folkomröstning om vindkraft 2026",
  description:
    "Skriv under för att kräva en kommunal folkomröstning om vindkraftsetableringen norr om Katrineholm.",
  municipality: "Katrineholm",
};

// ── Server-side cache (undviker att hammra DB vid varje app-start) ───────────
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 timme
let cachedRows: ReturnType<typeof mapRow>[] | null = null;
let cacheExpiresAt = 0;

type MappedArea = {
  id: number;
  name: string;
  status: string;
  kommun: string | null;
  region: string | null;
  turbineCountPlannedMin: number | null;
  turbineCountPlannedMax: number | null;
  centerLat: number;
  centerLng: number;
  polygon: { type: string; coordinates: unknown } | null;
  campaign: typeof CAMPAIGN_CONFIG | null;
};

function mapRow(
  area: typeof windProjectAreasTable.$inferSelect,
  includePolygon: boolean,
): MappedArea {
  return {
    id: area.id,
    name: area.name,
    status: area.status,
    kommun: area.kommun,
    region: area.region,
    turbineCountPlannedMin: area.turbineCountPlannedMin,
    turbineCountPlannedMax: area.turbineCountPlannedMax,
    centerLat: area.centerLat,
    centerLng: area.centerLng,
    polygon: includePolygon ? (area.polygon as MappedArea["polygon"]) : null,
    campaign: area.id === CAMPAIGN_PROJECT_ID ? CAMPAIGN_CONFIG : null,
  };
}

async function getProjects(includePolygon: boolean): Promise<MappedArea[]> {
  // Servercache gäller bara för default-requester (utan polygon).
  // Med polygon hoppas cachen över (sällan anropat).
  if (!includePolygon && cachedRows && Date.now() < cacheExpiresAt) {
    return cachedRows;
  }

  const { polygon: polygonCol, ...baseColumns } = getTableColumns(windProjectAreasTable);
  const select = includePolygon
    ? { ...baseColumns, polygon: polygonCol }
    : baseColumns;

  const rows = await db
    .select(select)
    .from(windProjectAreasTable)
    .where(eq(windProjectAreasTable.countryCode, "SE"))
    .orderBy(windProjectAreasTable.id);

  const mapped = rows.map((r) =>
    mapRow(r as typeof windProjectAreasTable.$inferSelect, includePolygon),
  );

  if (!includePolygon) {
    cachedRows = mapped;
    cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  }

  return mapped;
}

router.get("/project-areas", async (req, res) => {
  try {
    const includePolygon = req.query.polygon === "true";
    const projects = await getProjects(includePolygon);

    // Klienten kan använda ETag för att hoppa över re-parsning om data inte ändrats.
    res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=7200");
    res.json(projects);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch project areas");
    res.status(500).json({ error: "Serverfel" });
  }
});

export default router;
