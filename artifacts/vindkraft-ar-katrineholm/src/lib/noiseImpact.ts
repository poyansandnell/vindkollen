// Sammanvägd "infraljud-/bullerpåverkan"-indikator (grön/gul/röd) för AR-vyn.
// Detta är EN INFORMATIV RISKINDIKATOR, inte en medicinsk mätning eller en
// officiell bullerutredning — se `NOISE_IMPACT_DISCLAIMER` för den exakta
// text som alltid visas tillsammans med statusen.
//
// Indikatorn väger samman fem signaler till en poäng 0..100:
// 1. Beräknad ljudnivå (dBA) från `estimateSoundLevel` — dominerande faktor.
// 2. Antal vindkraftverk som bidrar märkbart (fler källor = mer påverkan).
// 3. Vindriktning, OM tillgänglig — medvind (vinden blåser i användarens
//    riktning från verken) ökar upplevd påverkan; annars neutral.
// 4. Exponeringstid — hur länge användaren har stått kvar på platsen.
import { normalizeAngle } from "./geo";
import type { SoundLevelEstimate } from "./soundLevel";

export type NoiseImpactLevel = "low" | "moderate" | "high";

export interface NoiseImpactInput {
  estimate: SoundLevelEstimate;
  /** Bäring (grader, 0-360) från användaren till närmaste vindkraftverk. */
  bearingToNearestDeg: number | null;
  /** Vindriktning (grader, 0-360) vinden blåser FRÅN (meteorologisk konvention), eller null om okänd. */
  windFromDeg: number | null;
  /** Hur länge (sekunder) användaren sammanhängande har befunnit sig i AR-vyn på denna plats. */
  exposureSeconds: number;
}

export interface NoiseImpactResult {
  level: NoiseImpactLevel;
  /** 0..100, endast för intern gradering/debug — visas inte som exakt tal i UI. */
  score: number;
  /** Är vinden bedömd som medvind (bär ljud från verken mot användaren)? Null = okänt (ingen vinddata). */
  downwind: boolean | null;
  /** Läsbara, redan formulerade delförklaringar (svenska) att lista i panelen. */
  reasons: string[];
}

const DBA_SCORE_MIN = 25;
const DBA_SCORE_MAX = 55;
const DBA_WEIGHT = 65;
const COUNT_WEIGHT = 15;
const COUNT_SCALE = 10;
const DOWNWIND_BONUS = 15;
const DOWNWIND_ANGLE_TOLERANCE_DEG = 45;
const EXPOSURE_WEIGHT = 15;
const EXPOSURE_FULL_MINUTES = 30;

const LEVEL_LOW_MAX = 35;
const LEVEL_MODERATE_MAX = 65;

function clamp01(x: number): number {
  return Math.min(Math.max(x, 0), 1);
}

/**
 * Är vinden medvind, dvs. bär ljud FRÅN vindkraftverken MOT användaren?
 * Det inträffar när vinden blåser FRÅN samma väderstreck som verket ligger
 * i förhållande till användaren (vindens ursprungsriktning ≈ bäringen till
 * verket) — då för vinden ljudet i riktning mot användaren.
 */
function isDownwind(bearingToTurbineDeg: number, windFromDeg: number): boolean {
  const diff = Math.abs(normalizeAngle(windFromDeg - bearingToTurbineDeg));
  return diff < DOWNWIND_ANGLE_TOLERANCE_DEG;
}

export function estimateNoiseImpact(input: NoiseImpactInput): NoiseImpactResult {
  const { estimate, bearingToNearestDeg, windFromDeg, exposureSeconds } = input;
  const reasons: string[] = [];

  if (!Number.isFinite(estimate.totalDba)) {
    reasons.push("Väntar på GPS-position för att kunna beräkna påverkan.");
    return { level: "low", score: 0, downwind: null, reasons };
  }

  const dbaScore = clamp01((estimate.totalDba - DBA_SCORE_MIN) / (DBA_SCORE_MAX - DBA_SCORE_MIN)) * DBA_WEIGHT;
  reasons.push(`Beräknad ljudnivå: ${estimate.totalDba.toFixed(1)} dBA.`);

  const countScore = clamp01(estimate.contributingCount / COUNT_SCALE) * COUNT_WEIGHT;
  reasons.push(
    estimate.contributingCount === 1
      ? "1 vindkraftverk bidrar märkbart till ljudnivån."
      : `${estimate.contributingCount} vindkraftverk bidrar märkbart till ljudnivån.`,
  );

  let downwind: boolean | null = null;
  let windScore = 0;
  if (windFromDeg !== null && bearingToNearestDeg !== null) {
    downwind = isDownwind(bearingToNearestDeg, windFromDeg);
    windScore = downwind ? DOWNWIND_BONUS : 0;
    reasons.push(
      downwind
        ? "Medvind: vinden för ljudet från vindkraftverken mot dig, vilket kan öka den upplevda nivån."
        : "Vindriktningen bär för närvarande inte ljudet direkt mot dig.",
    );
  } else {
    reasons.push("Vindriktning saknas — påverkas inte av denna faktor just nu.");
  }

  const exposureMinutes = exposureSeconds / 60;
  const exposureScore = clamp01(exposureMinutes / EXPOSURE_FULL_MINUTES) * EXPOSURE_WEIGHT;
  if (exposureMinutes >= 1) {
    reasons.push(`Du har befunnit dig på platsen i ca ${Math.round(exposureMinutes)} min — längre exponering kan öka påverkan.`);
  }

  const score = clamp01((dbaScore + countScore + windScore + exposureScore) / 100) * 100;

  let level: NoiseImpactLevel = "low";
  if (score >= LEVEL_MODERATE_MAX) level = "high";
  else if (score >= LEVEL_LOW_MAX) level = "moderate";

  return { level, score, downwind, reasons };
}

export const NOISE_IMPACT_LEVEL_LABELS: Record<NoiseImpactLevel, string> = {
  low: "Låg beräknad påverkan",
  moderate: "Måttlig beräknad påverkan",
  high: "Hög beräknad påverkan",
};

export const NOISE_IMPACT_LEVEL_COLORS: Record<
  NoiseImpactLevel,
  { text: string; bg: string; border: string; emoji: string }
> = {
  low: { text: "text-emerald-300", bg: "bg-emerald-500/15", border: "border-emerald-400/30", emoji: "🟢" },
  moderate: { text: "text-yellow-300", bg: "bg-yellow-500/15", border: "border-yellow-400/30", emoji: "🟡" },
  high: { text: "text-red-300", bg: "bg-red-500/15", border: "border-red-400/30", emoji: "🔴" },
};

/**
 * Exakt disclaimer-text enligt produktspecifikationen — får inte omformuleras
 * till att påstå garanterad skada; håll formuleringarna "kan bidra till"/
 * "kan upplevas"/"för känsliga personer".
 */
export const NOISE_IMPACT_DISCLAIMER =
  "Detta är en uppskattad riskindikator, inte en medicinsk mätning. Långvarig exponering för buller och lågfrekvent ljud kan hos vissa personer bidra till störning, trötthet, huvudvärk, tryckkänsla eller sämre sömn. Påverkan varierar beroende på avstånd, väder, vindriktning, bostadens konstruktion och individuell känslighet.";
