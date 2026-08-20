/**
 * Regenerates artifacts/vindkraft-ar-katrineholm/src/lib/bundledProjects.ts
 * from the live database immediately after a successful wind-sync.
 *
 * This is the TypeScript equivalent of scripts/generate-bundled-projects.sh —
 * runs in-process inside the API server so no shell / psql dependency is needed.
 */

import fs from "node:fs";
import path from "node:path";
import { db, windProjectAreasTable } from "@workspace/db";
import { isNotNull } from "drizzle-orm";
import { logger } from "./logger";

const STATUS_MAP: Record<string, string> = {
  aktuellt: "planned",
  inledande_undersokning: "proposed",
  samrad: "consultation",
  ansokan_inlamnad: "consultation",
  andringsansokan: "permitted",
  beviljat: "permitted",
  uppfort: "operational",
  inte_aktuellt: "cancelled",
  avslaget: "cancelled",
  handlaggs: "planned",
  overklagat: "planned",
  nedmonterat: "cancelled",
  uppgift_saknas: "proposed",
};

function normaliseStatus(raw: string | null | undefined): string {
  return STATUS_MAP[raw ?? ""] ?? "planned";
}

function esc(s: string | null | undefined): string {
  if (s == null) return "null";
  return `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Resolves the absolute path to bundledProjects.ts at runtime.
 *
 * The API server is always started from its own package directory
 * (artifacts/api-server/) — pnpm runs scripts from the matched package root,
 * and `node ./dist/index.mjs` keeps that as cwd. So the monorepo root is
 * always one level above process.cwd().
 *
 * We probe two candidates (in case cwd is already the monorepo root in some
 * CI/test environments) and pick whichever parent directory exists. An env var
 * override is also supported for unusual deployment layouts.
 */
function resolveDestPath(): string {
  if (process.env["BUNDLED_PROJECTS_DEST"]) {
    return path.resolve(process.env["BUNDLED_PROJECTS_DEST"]);
  }

  const SIBLING = "../vindkraft-ar-katrineholm/src/lib/bundledProjects.ts";
  const FROM_ROOT = "artifacts/vindkraft-ar-katrineholm/src/lib/bundledProjects.ts";

  // Ordered by likelihood:
  //   primary  — pnpm runs the package script from artifacts/api-server/, so the
  //              AR artifact is a sibling one level up (../vindkraft-ar-katrineholm/…)
  //   fallback — some CI/test runners set cwd to the monorepo root
  const candidates = [
    path.resolve(process.cwd(), SIBLING),    // cwd = artifacts/api-server/  (normal)
    path.resolve(process.cwd(), FROM_ROOT),  // cwd = monorepo root           (fallback)
  ];

  for (const candidate of candidates) {
    const dir = path.dirname(candidate);
    if (fs.existsSync(dir)) {
      return candidate;
    }
  }

  // Should never reach here in a correctly-structured monorepo; log full
  // diagnostics so any misconfiguration is immediately visible in the logs.
  logger.error(
    { candidates, cwd: process.cwd() },
    "[generate-bundled-projects] Cannot locate bundledProjects.ts parent directory — check workspace layout",
  );
  // Return the primary candidate so the caller can surface the fs error.
  return candidates[0]!;
}

/**
 * Queries the database and writes an up-to-date bundledProjects.ts.
 * Returns the number of project rows written.
 */
export async function generateBundledProjects(): Promise<number> {
  logger.info("[generate-bundled-projects] Fetching project areas from DB…");

  const rows = await db
    .select({
      id: windProjectAreasTable.id,
      name: windProjectAreasTable.name,
      status: windProjectAreasTable.status,
      kommun: windProjectAreasTable.kommun,
      region: windProjectAreasTable.region,
      turbineCountPlannedMin: windProjectAreasTable.turbineCountPlannedMin,
      turbineCountPlannedMax: windProjectAreasTable.turbineCountPlannedMax,
      centerLat: windProjectAreasTable.centerLat,
      centerLng: windProjectAreasTable.centerLng,
    })
    .from(windProjectAreasTable)
    .where(isNotNull(windProjectAreasTable.centerLat));

  const today = new Date().toISOString().slice(0, 10);

  const lines: string[] = rows.map((r) => {
    const tmin = r.turbineCountPlannedMin ?? "null";
    const tmax = r.turbineCountPlannedMax ?? "null";
    return (
      `  { id: ${r.id}, name: ${esc(r.name)}, status: "${normaliseStatus(r.status)}", ` +
      `kommun: ${esc(r.kommun)}, region: ${esc(r.region)}, ` +
      `turbineCountPlannedMin: ${tmin}, turbineCountPlannedMax: ${tmax}, ` +
      `centerLat: ${r.centerLat.toFixed(6)}, centerLng: ${r.centerLng.toFixed(6)} },`
    );
  });

  const output = `/**
 * Statisk projektregistret för Vindkollen.
 *
 * Primär datakälla på native (Capacitor/iOS/Android) där relativa API-URL:er
 * ej fungerar (capacitor://localhost/api/... → DOMException). Används även som
 * omedelbar fallback på webben medan ett API-anrop pågår i bakgrunden.
 *
 * GENERERAT AUTOMATISKT — kör scripts/generate-bundled-projects.sh för att uppdatera.
 * Senast genererat: ${today}
 * Källa: Vindbrukskollen via API-serverns databas (${lines.length} projekt).
 */

export interface ApiProjectArea {
  id: number;
  name: string;
  status: string;
  kommun?: string | null;
  region?: string | null;
  turbineCountPlannedMin?: number | null;
  turbineCountPlannedMax?: number | null;
  centerLat?: number;
  centerLng?: number;
  polygon?: { type: string; coordinates: unknown } | null;
  campaign?: {
    enabled: boolean;
    type: "referendum-interest";
    title: string;
    description: string;
    municipality: string;
  } | null;
}

export const BUNDLED_PROJECTS: ApiProjectArea[] = [
  // ── Ericsberg (special — campaign config) ──────────────────────────────
  {
    id: 10001,
    name: "Ericsbergs planer",
    status: "consultation",
    kommun: "Katrineholm",
    region: "Södermanland",
    turbineCountPlannedMin: 29,
    turbineCountPlannedMax: 29,
    centerLat: 58.97,
    centerLng: 16.27,
    polygon: null,
    campaign: {
      enabled: true,
      type: "referendum-interest" as const,
      title: "Folkomröstning om vindkraft 2026",
      description: "Skriv under för att kräva en kommunal folkomröstning om vindkraftsetableringen norr om Katrineholm.",
      municipality: "Katrineholm",
    },
  },
  // ── Live-data från Vindbrukskollen (${lines.length} projekt, ${today}) ───────────────
${lines.join("\n")}
];
`;

  const dest = resolveDestPath();

  // Verify the parent directory is reachable before writing so any path
  // misconfiguration surfaces as a clear error rather than a silent no-op.
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) {
    throw new Error(
      `[generate-bundled-projects] Destination directory does not exist: ${destDir} ` +
      `(cwd=${process.cwd()}, dest=${dest})`,
    );
  }

  fs.writeFileSync(dest, output, "utf-8");

  logger.info(
    { rows: lines.length, dest, sizeKb: Math.round(output.length / 1024) },
    `[generate-bundled-projects] ${lines.length} projekt → bundledProjects.ts`,
  );

  return lines.length;
}
