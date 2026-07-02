// Uppskattning av upplevd ljudnivå (dBA) från vindkraftverken, baserat på
// GPS-avstånd till varje verk. Detta är EN INFORMATIV UPPSKATTNING — den
// styr INTE volymen på det procedurella vindljudet i appen (se
// `useWindSound.ts`), och ska inte tolkas som en exakt bullerutredning.
//
// Metod:
// 1. Varje verk antas ha en ljudeffektnivå (LWA) på ca 106 dBA — en typisk
//    deklarerad nivå för moderna 6 MW-klass-verk (t.ex. Vestas V162-6.2MW),
//    vilket är den turbintyp de 29 verken är grundade på.
// 2. Ljudnivån vid en given punkt (Lp) beräknas med en förenklad
//    geometrisk spridningsformel för en punktkälla över mark (hemisfärisk
//    spridning), som ofta används vid överslagsberäkningar av
//    vindkraftsbuller: Lp = LWA - 20*log10(d) - 11 (d i meter).
//    Detta ignorerar luftabsorption, terräng, vind och markdämpning —
//    verkliga bullerutredningar är betydligt mer detaljerade.
// 3. Bidrag från flera verk kombineras logaritmiskt (energisummering):
//    L_total = 10*log10(sum(10^(Li/10))).
export const SOUND_POWER_LEVEL_DBA = 106;

/** Ljudnivå (dBA) vid avstånd `distanceM` från ett enskilt verk. */
export function attenuatedLevelDba(distanceM: number): number {
  const d = Math.max(distanceM, 1);
  return SOUND_POWER_LEVEL_DBA - 20 * Math.log10(d) - 11;
}

/** Kombinerar flera ljudnivåer (dBA) logaritmiskt till en total nivå. */
export function combineLevelsDba(levelsDba: number[]): number {
  if (levelsDba.length === 0) return -Infinity;
  const sumEnergy = levelsDba.reduce((sum, l) => sum + 10 ** (l / 10), 0);
  return 10 * Math.log10(sumEnergy);
}

export interface SoundLevelEstimate {
  /** Uppskattad total ljudnivå (dBA) vid användarens position. */
  totalDba: number;
  /** Avstånd (meter) till närmaste verk, eller null om inga verk finns. */
  nearestDistanceM: number | null;
  /** Antal verk som bidrar märkbart till totalnivån (inom ~15 dB av den starkaste källan). */
  contributingCount: number;
}

/**
 * Beräknar en total dBA-uppskattning från avstånd (meter) till varje verk.
 * Rent informativt — påverkar inte ljuduppspelningen.
 */
export function estimateSoundLevel(distancesM: number[]): SoundLevelEstimate {
  if (distancesM.length === 0) {
    return { totalDba: -Infinity, nearestDistanceM: null, contributingCount: 0 };
  }
  const levels = distancesM.map(attenuatedLevelDba);
  const totalDba = combineLevelsDba(levels);
  const nearestDistanceM = Math.min(...distancesM);
  // "Bidrar märkbart" = ligger inom 15 dB av den starkaste enskilda källan —
  // källor mycket svagare än så påverkar totalsumman försumbart.
  const strongest = Math.max(...levels);
  const contributingCount = levels.filter((l) => l >= strongest - 15).length;
  return { totalDba, nearestDistanceM, contributingCount };
}

export type SoundLevelSeverity = "green" | "yellow" | "orange" | "red";

/** Färgkodning av ljudnivån enligt de fasta tröskelvärdena i produktspecifikationen. */
export function soundLevelSeverity(totalDba: number): SoundLevelSeverity {
  if (!Number.isFinite(totalDba) || totalDba < 30) return "green";
  if (totalDba < 35) return "yellow";
  if (totalDba < 40) return "orange";
  return "red";
}

export const SEVERITY_COLORS: Record<SoundLevelSeverity, { text: string; bg: string; border: string; emoji: string }> = {
  green: { text: "text-emerald-300", bg: "bg-emerald-500/15", border: "border-emerald-400/30", emoji: "🟢" },
  yellow: { text: "text-yellow-300", bg: "bg-yellow-500/15", border: "border-yellow-400/30", emoji: "🟡" },
  orange: { text: "text-orange-300", bg: "bg-orange-500/15", border: "border-orange-400/30", emoji: "🟠" },
  red: { text: "text-red-300", bg: "bg-red-500/15", border: "border-red-400/30", emoji: "🔴" },
};

/** Exakt disclaimer-text enligt produktspecifikationen. */
export const SOUND_LEVEL_DISCLAIMER =
  "Denna ljudnivå är en förenklad uppskattning baserad på projektets bullerunderlag och användarens GPS-position. Den ersätter inte en officiell bullerberäkning.";
