// Sammanvägd "infraljud-/bullerpåverkan"-indikator (grön/gul/röd) för AR-vyn.
// Detta är EN INFORMATIV RISKINDIKATOR, inte en medicinsk mätning eller en
// officiell bullerutredning — se `NOISE_IMPACT_DISCLAIMER` för den exakta
// text som alltid visas tillsammans med statusen.
//
// VIKTIGT: denna indikator visar ALDRIG ett exakt dBA-tal i UI:t — bara
// nivån (🟢Låg/🟡Måttlig/🔴Hög) + kvalitativa skäl. Den interna `estimate.
// totalDba` används fortfarande för att GRADERA nivån (se `dbaScore` nedan),
// men får inte läcka ut som en siffra i `reasons` eller någon annanstans —
// se `SoundLevelPanel`/`NoiseImpactMonitor` för den separata "Ljudnivå"-
// sektionen som faktiskt visar dBA.
//
// Indikatorn väger samman fem signaler till en poäng 0..100:
// 1. Beräknad ljudnivå (dBA, internt) från `estimateSoundLevel` — dominerande
//    faktor, men uttrycks utåt bara via avstånd till närmaste verk.
// 2. Antal vindkraftverk som bidrar märkbart (fler källor = mer påverkan).
// 3. Vindriktning OCH vindhastighet, OM tillgängliga — medvind (vinden
//    blåser i användarens riktning från verken) ökar upplevd påverkan,
//    skalat efter hur hårt det blåser; annars neutral/oskalad.
// 4. Exponeringstid — hur länge användaren har stått kvar på platsen.
import { formatDistance, normalizeAngle } from "./geo";
import type { SoundLevelEstimate } from "./soundLevel";

export type NoiseImpactLevel = "low" | "moderate" | "high";

export interface NoiseImpactInput {
  estimate: SoundLevelEstimate;
  /** Bäring (grader, 0-360) från användaren till närmaste vindkraftverk. */
  bearingToNearestDeg: number | null;
  /** Vindriktning (grader, 0-360) vinden blåser FRÅN (meteorologisk konvention), eller null om okänd. */
  windFromDeg: number | null;
  /** Vindhastighet (m/s), eller null om okänd — skalar medvindseffekten. */
  windSpeedMs: number | null;
  /** Hur länge (sekunder) användaren sammanhängande har befunnit sig i AR-vyn på denna plats. */
  exposureSeconds: number;
}

export interface NoiseImpactResult {
  level: NoiseImpactLevel;
  /** 0..100, endast för intern gradering/debug — visas inte som exakt tal i UI. */
  score: number;
  /** Är vinden bedömd som medvind (bär ljud från verken mot användaren)? Null = okänt (ingen vinddata). */
  downwind: boolean | null;
  /** Läsbara, redan formulerade delförklaringar (svenska) att lista i panelen — innehåller aldrig ett dBA-tal. */
  reasons: string[];
}

const DBA_SCORE_MIN = 25;
const DBA_SCORE_MAX = 55;
const DBA_WEIGHT = 65;
const COUNT_WEIGHT = 15;
const COUNT_SCALE = 10;
const DOWNWIND_BONUS = 15;
const DOWNWIND_ANGLE_TOLERANCE_DEG = 45;
// Vid denna vindhastighet (m/s) eller mer räknas medvindsbonusen fullt ut;
// under det skalas den ner linjärt (svag bris bär knappt ljud alls).
const DOWNWIND_FULL_SPEED_MS = 8;
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
  const { estimate, bearingToNearestDeg, windFromDeg, windSpeedMs, exposureSeconds } = input;
  const reasons: string[] = [];

  if (!Number.isFinite(estimate.totalDba)) {
    reasons.push("Väntar på GPS-position för att kunna beräkna påverkan.");
    return { level: "low", score: 0, downwind: null, reasons };
  }

  // OBS: `estimate.totalDba` används bara internt för att gradera nivån —
  // den siffran visas aldrig i infraljud-panelens texter. Skälet nedan
  // uttrycks istället kvalitativt via avstånd till närmaste verk.
  const dbaScore = clamp01((estimate.totalDba - DBA_SCORE_MIN) / (DBA_SCORE_MAX - DBA_SCORE_MIN)) * DBA_WEIGHT;
  if (estimate.nearestDistanceM !== null) {
    reasons.push(`Avstånd till närmaste vindkraftverk: ${formatDistance(estimate.nearestDistanceM)}.`);
  }

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
    const speedFactor = windSpeedMs !== null ? clamp01(windSpeedMs / DOWNWIND_FULL_SPEED_MS) : 1;
    windScore = downwind ? DOWNWIND_BONUS * speedFactor : 0;
    if (downwind) {
      reasons.push(
        windSpeedMs !== null
          ? `Medvind (${windSpeedMs.toFixed(0)} m/s): vinden för ljudet från vindkraftverken mot dig, vilket kan öka den upplevda nivån.`
          : "Medvind: vinden för ljudet från vindkraftverken mot dig, vilket kan öka den upplevda nivån.",
      );
    } else {
      reasons.push("Vindriktningen bär för närvarande inte ljudet direkt mot dig.");
    }
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
 * Exakt disclaimer-text enligt produktspecifikationen (uppdaterad efter
 * senaste feedbackrundan) — får INTE omformuleras eller parafraseras.
 */
export const NOISE_IMPACT_DISCLAIMER =
  "Detta är en uppskattad indikator baserad på projektets data och användarens position. Den är inte en faktisk mätning av infraljud.";
