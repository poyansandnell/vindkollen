/**
 * Lokal cache för projektregistret (ApiProjectArea[]).
 *
 * Sparar i localStorage med ett tidsstämpel-nyckel.
 * Klientens kontext läser denna vid uppstart för omedelbar data,
 * hämtar sedan live från /api/project-areas och skriver tillbaka vid succé.
 *
 * Nyckelversion "v1" — öka om schemat ändras på ett inkompatibelt sätt.
 */

import type { ApiProjectArea } from "./bundledProjects";

const DATA_KEY = "vindkollen:project-areas-v1";
const TS_KEY = "vindkollen:project-areas-v1-ts";

/** 24 timmar — projektlistan ändras sällan, men ska hålla sig färsk. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface CachedAreas {
  areas: ApiProjectArea[];
  /** Unix-ms när cachen skrevs. */
  savedAt: number;
  /** Hur gammal cachen är i ms just nu. */
  ageMs: number;
  /** true om cachen är äldre än MAX_AGE_MS. */
  stale: boolean;
}

/** Läser cachad data. Returnerar null om ingen cache finns. */
export function readProjectAreaCache(): CachedAreas | null {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    const tsRaw = localStorage.getItem(TS_KEY);
    if (!raw || !tsRaw) return null;

    const savedAt = parseInt(tsRaw, 10);
    if (isNaN(savedAt)) return null;

    const areas = JSON.parse(raw) as ApiProjectArea[];
    if (!Array.isArray(areas) || areas.length === 0) return null;

    const ageMs = Date.now() - savedAt;
    return { areas, savedAt, ageMs, stale: ageMs > MAX_AGE_MS };
  } catch {
    return null;
  }
}

/** Skriver projektdata till cachen. */
export function writeProjectAreaCache(areas: ApiProjectArea[]): void {
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify(areas));
    localStorage.setItem(TS_KEY, String(Date.now()));
  } catch (err) {
    // localStorage kan vara full (quota) — ignorera tyst.
    console.warn("[ProjectAreaCache] Kunde inte spara cache:", err);
  }
}

/** Tar bort cachen (tvingar ny hämtning nästa uppstart). */
export function clearProjectAreaCache(): void {
  try {
    localStorage.removeItem(DATA_KEY);
    localStorage.removeItem(TS_KEY);
  } catch {
    // ignore
  }
}
