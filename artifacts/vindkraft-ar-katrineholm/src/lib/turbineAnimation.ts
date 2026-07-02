import { hashSeed } from "@/lib/prng";

/**
 * Delade, deterministiska animationsparametrar per vindkraftverk (baserat på
 * verkets namn) — används av både 3D-scenen (ARScene) och ljudlogiken
 * (vindljud/svischljud ska variera i takt med samma rotorhastighet som
 * bladen faktiskt snurrar med).
 */

// Rotorns hastighet — 6–14 varv/minut, olika för varje verk.
export const BLADE_RPM_MIN = 6;
export const BLADE_RPM_MAX = 14;

// Flyghinderbelysningen blinkar ungefär var 1:a sekund, men INTE synkront.
export const BLINK_PERIOD_MIN_MS = 900;
export const BLINK_PERIOD_MAX_MS = 1150;
export const BLINK_ON_MS = 150;

export function getBladeRpm(turbineName: string): number {
  return BLADE_RPM_MIN + hashSeed(`${turbineName}:rpm`) * (BLADE_RPM_MAX - BLADE_RPM_MIN);
}

export function getBladeStartAngleRad(turbineName: string): number {
  return hashSeed(`${turbineName}:startAngle`) * Math.PI * 2;
}

export function getBlinkPeriodMs(turbineName: string): number {
  return BLINK_PERIOD_MIN_MS + hashSeed(`${turbineName}:period`) * (BLINK_PERIOD_MAX_MS - BLINK_PERIOD_MIN_MS);
}

export function getBlinkOffsetMs(turbineName: string, periodMs: number): number {
  return hashSeed(`${turbineName}:phase`) * periodMs;
}
