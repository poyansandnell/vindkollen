/**
 * Projektval för Vindkollen AR.
 *
 * Logik (i prioritetsordning):
 * 1. localStorage-handoff: turbindata skriven av Sverigekartan eller /placera-verktyget.
 * 2. GPS-automatval: närmaste projekt i BUNDLED_PROJECTS inom MAX_AUTO_RADIUS_KM.
 * 3. Inget projekt hittades → returnera null → AR-vyn visar tomt-läge.
 *
 * KRITISKT: De 29 hårdkodade Länsterberget-verken (TURBINES från turbines.ts)
 * används BARA när det valda projektet är Länsterberget (id = LANSTERBERGET_ID).
 * Inga andra projekt ska någonsin få Katrineholms verk som fallback.
 */

import { TURBINES, type TurbineSweref } from "./turbines";
import { BUNDLED_PROJECTS } from "./bundledProjects";
import { distanceMeters } from "./geo";
import { wgs84ToSweref } from "./sweref";

/** Max-radien (km) för GPS-baserat automatiskt projektval. */
export const MAX_AUTO_RADIUS_KM = 100;

/** Länsterberget/Katrineholms projekt-ID i BUNDLED_PROJECTS. */
const LANSTERBERGET_ID = 10001;

/**
 * Aktivt projekts metadata och turbindata.
 * Skapas från localStorage-handoff, GPS-automatval eller /placera-verktyget.
 */
export interface ActiveProject {
  turbines: TurbineSweref[];
  projectName: string;
  municipality: string;
  projectId: number | string;
  projectCenterLat?: number;
  projectCenterLon?: number;
  /**
   * Varifrån projektet valdes:
   * "handoff"  = från Sverigekartan (DetailPanel → localStorage → AR)
   * "gps"      = GPS-automatvalt ur BUNDLED_PROJECTS
   * "editor"   = från /placera-verktyget
   */
  source: "handoff" | "gps" | "editor";
  /**
   * true = SWEREF99-koordinater från källdata (Länsterberget eller karta-API).
   * false = approximerade/genererade positioner (för projekt utan exakta koordinater).
   */
  hasPreciseTurbines: boolean;
}

/**
 * Hitta närmaste projekt i BUNDLED_PROJECTS inom MAX_AUTO_RADIUS_KM km från
 * användarens GPS-position. Returnerar null om inget projekt hittas inom radien.
 */
export function findNearestProject(userLat: number, userLon: number): ActiveProject | null {
  let nearest = null as (typeof BUNDLED_PROJECTS)[0] | null;
  let nearestDistM = Infinity;

  for (const project of BUNDLED_PROJECTS) {
    if (project.centerLat == null || project.centerLng == null) continue;
    const distM = distanceMeters(userLat, userLon, project.centerLat, project.centerLng);
    if (distM < nearestDistM) {
      nearestDistM = distM;
      nearest = project;
    }
  }

  if (!nearest || nearestDistM > MAX_AUTO_RADIUS_KM * 1000) return null;

  const turbines = getProjectTurbinesById(
    nearest.id,
    nearest.centerLat!,
    nearest.centerLng!,
    nearest.turbineCountPlannedMin ?? nearest.turbineCountPlannedMax ?? 10,
    String(nearest.id),
  );

  return {
    turbines,
    projectName: nearest.name,
    municipality: nearest.kommun ?? "",
    projectId: nearest.id,
    projectCenterLat: nearest.centerLat,
    projectCenterLon: nearest.centerLng,
    source: "gps",
    hasPreciseTurbines: nearest.id === LANSTERBERGET_ID,
  };
}

/**
 * Hämtar turbindata för ett projekt-ID.
 * Länsterberget: exakta SWEREF99-koordinater från turbines.ts.
 * Övriga: genererade ungefärliga positioner i ett rutnät kring projektcentrum.
 */
function getProjectTurbinesById(
  projectId: number,
  centerLat: number,
  centerLon: number,
  count: number,
  idPrefix: string,
): TurbineSweref[] {
  if (projectId === LANSTERBERGET_ID) return [...TURBINES];
  return generateApproximateTurbines(centerLat, centerLon, count, idPrefix);
}

/**
 * Genererar ungefärliga turbinpositioner i ett rutnät kring ett projektcentrum.
 * Används för projekt utan exakta SWEREF99-koordinater (alla utom Länsterberget).
 *
 * Specifikationer matchar ett typiskt modernt vindkraftsprojekt — inte exakt
 * riktiga mått. Märks med hasPreciseTurbines=false i ActiveProject så UI:t
 * kan visa "≈ Ungefärliga positioner"-varning.
 */
export function generateApproximateTurbines(
  centerLat: number,
  centerLon: number,
  count: number,
  idPrefix: string,
): TurbineSweref[] {
  const SPACING_M = 700;
  const cols = Math.ceil(Math.sqrt(count * 1.4));
  const rows = Math.ceil(count / cols);

  const latPerM = 1 / 111_320;
  const lonPerM = 1 / (111_320 * Math.cos((centerLat * Math.PI) / 180));

  const originLat = centerLat - ((rows - 1) / 2) * SPACING_M * latPerM;
  const originLon = centerLon - ((cols - 1) / 2) * SPACING_M * lonPerM;

  const turbines: TurbineSweref[] = [];
  let i = 0;
  outer: for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (i >= count) break outer;
      const lat = originLat + r * SPACING_M * latPerM;
      const lon = originLon + c * SPACING_M * lonPerM;
      const { easting, northing } = wgs84ToSweref(lat, lon);
      turbines.push({
        id: `${idPrefix}-${i + 1}`,
        name: `V${i + 1}`,
        easting,
        northing,
        heightMeters: 200,
        groundHeightMeters: 50,
        hubHeightMeters: 130,
        rotorDiameterMeters: 130,
        totalHeightAboveSeaMeters: 250,
      });
      i++;
    }
  }
  return turbines;
}
