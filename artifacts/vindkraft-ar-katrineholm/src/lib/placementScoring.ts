// Konsekvenspoäng (0-100, "påverkanspoäng") för "Placera vindkraftverken
// själv" — ju högre poäng, desto större uppskattad negativ konsekvens av
// den valda placeringen. Väger samman avstånd till bostäder/tätort, antal
// berörda hushåll, natur-/kultur-/vattenskyddsvärden, uppskattad buller- och
// visuell påverkan, samt om verket ligger inom ett riksintresse för vindbruk
// eller ett område kommunen redan pekat ut för vindkraft (bonus, sänker
// poängen — se `ericsbergArea.ts`s jsdoc för varför siffrorna är
// illustrativa uppskattningar, inte exakta myndighetsdata).
import { distanceMeters } from "./geo";
import { attenuatedLevelDba, combineLevelsDba } from "./soundLevel";
import {
  ERICSBERG_BOUNDARY,
  HOUSEHOLD_CLUSTERS,
  KATRINEHOLM_CENTER,
  KATRINEHOLM_URBAN_RADIUS_M,
  POSITIVE_ZONES,
  SENSITIVE_ZONES,
  distanceToZoneEdgeM,
  isInsideBoundary,
  type HouseholdCluster,
} from "./ericsbergArea";

export interface PlacedTurbine {
  id: string;
  lat: number;
  lon: number;
}

export interface FactorScore {
  key: string;
  label: string;
  /** Positivt = ökar konsekvenspoängen, negativt = sänker den (bonus). */
  impactPoints: number;
  note: string;
}

export type PlacementLevel = "low" | "moderate" | "high" | "veryHigh";

export interface PlacementScoreResult {
  /** 0-100, klipps även om delfaktorerna summerar till mer/mindre. */
  totalScore: number;
  level: PlacementLevel;
  householdsAffected: number;
  nearestHouseholdDistanceM: number | null;
  nearestHouseholdName: string | null;
  nearestUrbanDistanceM: number | null;
  outsideBoundaryIds: string[];
  factors: FactorScore[];
  playfulWarning: string | null;
  /**
   * Felsökningsdata: varje verks EGEN konsekvenspoäng om det stod ensamt
   * (dvs. `scorePlacement([t]).totalScore`), sorterad fallande — används av
   * felsöknings-/redigeringsläget i `PlaceTurbines.tsx` för att visa vilka
   * enskilda verk som bidrar mest till den totala poängen.
   */
  turbineContributions: { id: string; score: number }[];
}

const HOUSEHOLD_IMPACT_RADIUS_M = 2500;
const HOUSEHOLD_WEIGHT = 25;
const HOUSEHOLD_COUNT_WEIGHT = 15;
const HOUSEHOLD_COUNT_SCALE = 150;
// JUSTERAT (buggfix): en placering nära Katrineholms centrum gav tidigare
// alldeles för lite påverkanspoäng, eftersom `HOUSEHOLD_CLUSTERS` (Ericsberg/
// Björkvik/Marmorbruket/Forssjö) inte innehåller själva Katrineholms tätort
// — den enda kopplingen till centrum var denna gradvisa faktor, tidigare
// med vikt 8 av totalt 100, alldeles för svag för att en placering intill
// en stad med ~24 000 invånare skulle synas som "hög"/"mycket hög"
// påverkan (rött) i UI:t. Vikten är höjd, och kompletteras nedan av en
// separat, mycket kraftigare "mycket nära centrum"-faktor för korta avstånd.
const URBAN_WEIGHT = 20;
const URBAN_CLOSE_M = 3000;
const URBAN_FAR_M = 15000;
// Ny faktor: extra straff när ett verk ligger inom (eller nära) själva
// Katrineholms tätortsbebyggelse (`KATRINEHOLM_URBAN_RADIUS_M`) — detta är
// en helt annan storleksordning av berörd befolkning än de små byklustren
// ovan, och ska ensam kunna driva en placering till "hög"/"mycket hög"
// (rött) även om övriga faktorer är låga.
const URBAN_CRITICAL_WEIGHT = 35;
const URBAN_CRITICAL_MARGIN_M = 1500;
const NATURE_WEIGHT = 10;
const CULTURAL_WEIGHT = 9;
const WATER_WEIGHT = 9;
const NOISE_WEIGHT = 12;
const NOISE_MIN_DBA = 30;
const NOISE_MAX_DBA = 50;
const VISUAL_WEIGHT = 12;
const VISUAL_CLOSE_M = 800;
const VISUAL_FAR_M = 6000;
// Ny faktor: uppskattad skuggflimmerpåverkan (roterande rotorblads skuggor
// vid låg sol) — avtar snabbare med avstånd än buller/synlighet eftersom
// skuggflimmer bara är märkbart relativt nära verket.
const SHADOW_FLICKER_WEIGHT = 8;
const SHADOW_FLICKER_CLOSE_M = 500;
const SHADOW_FLICKER_FAR_M = 2000;
const RIKSINTRESSE_BONUS = -8;
const PLANERING_BONUS = -7;
const OUTSIDE_BOUNDARY_PENALTY_PER_TURBINE = 6;

function clamp01(x: number): number {
  return Math.min(Math.max(x, 0), 1);
}

function clamp(x: number, min: number, max: number): number {
  return Math.min(Math.max(x, min), max);
}

function nearestHousehold(point: { lat: number; lon: number }): { cluster: HouseholdCluster; distanceM: number } | null {
  let best: { cluster: HouseholdCluster; distanceM: number } | null = null;
  for (const cluster of HOUSEHOLD_CLUSTERS) {
    const distanceM = distanceMeters(point.lat, point.lon, cluster.lat, cluster.lon);
    if (!best || distanceM < best.distanceM) best = { cluster, distanceM };
  }
  return best;
}

/**
 * Beräknar en konsekvenspoäng för en placering av (upp till) 8 verk. Tomma
 * eller ofullständiga placeringar (färre än 8 verk) poängsätts ändå utifrån
 * de verk som faktiskt är utplacerade, så panelen kan uppdateras live medan
 * användaren drar ut verk ett i taget.
 */
export function scorePlacement(turbines: PlacedTurbine[]): PlacementScoreResult {
  const factors: FactorScore[] = [];

  if (turbines.length === 0) {
    return {
      totalScore: 0,
      level: "low",
      householdsAffected: 0,
      nearestHouseholdDistanceM: null,
      nearestHouseholdName: null,
      nearestUrbanDistanceM: null,
      outsideBoundaryIds: [],
      factors: [],
      playfulWarning: null,
      turbineContributions: [],
    };
  }

  // --- Avstånd till bostäder (globalt närmaste hushållskluster) ---
  let nearestHouseholdDistanceM: number | null = null;
  let nearestHouseholdName: string | null = null;
  for (const t of turbines) {
    const nearest = nearestHousehold(t);
    if (nearest && (nearestHouseholdDistanceM === null || nearest.distanceM < nearestHouseholdDistanceM)) {
      nearestHouseholdDistanceM = nearest.distanceM;
      nearestHouseholdName = nearest.cluster.name;
    }
  }
  const householdProximityScore =
    nearestHouseholdDistanceM === null
      ? 0
      : clamp01(1 - nearestHouseholdDistanceM / HOUSEHOLD_IMPACT_RADIUS_M) * HOUSEHOLD_WEIGHT;
  factors.push({
    key: "householdProximity",
    label: "Avstånd till bostäder",
    impactPoints: householdProximityScore,
    note:
      nearestHouseholdDistanceM !== null
        ? `Närmaste bebyggelse (${nearestHouseholdName}) ligger ${Math.round(nearestHouseholdDistanceM)} m från ett verk.`
        : "Inget avstånd kunde beräknas.",
  });

  // --- Antal berörda hushåll (viktat efter avstånd till NÄRMASTE verk) ---
  let householdsAffected = 0;
  for (const cluster of HOUSEHOLD_CLUSTERS) {
    let closest = Infinity;
    for (const t of turbines) {
      const d = distanceMeters(t.lat, t.lon, cluster.lat, cluster.lon);
      if (d < closest) closest = d;
    }
    const weight = clamp01(1 - closest / HOUSEHOLD_IMPACT_RADIUS_M);
    householdsAffected += cluster.households * weight;
  }
  householdsAffected = Math.round(householdsAffected);
  const householdCountScore = clamp01(householdsAffected / HOUSEHOLD_COUNT_SCALE) * HOUSEHOLD_COUNT_WEIGHT;
  factors.push({
    key: "householdCount",
    label: "Antal berörda hushåll",
    impactPoints: householdCountScore,
    note: `Uppskattningsvis ${householdsAffected} hushåll kan påverkas av placeringen.`,
  });

  // --- Avstånd till tätort (Katrineholm) ---
  let nearestUrbanDistanceM: number | null = null;
  for (const t of turbines) {
    const d = distanceMeters(t.lat, t.lon, KATRINEHOLM_CENTER.lat, KATRINEHOLM_CENTER.lon);
    if (nearestUrbanDistanceM === null || d < nearestUrbanDistanceM) nearestUrbanDistanceM = d;
  }
  const urbanScore =
    nearestUrbanDistanceM === null
      ? 0
      : clamp01(1 - (nearestUrbanDistanceM - URBAN_CLOSE_M) / (URBAN_FAR_M - URBAN_CLOSE_M)) * URBAN_WEIGHT;
  factors.push({
    key: "urbanProximity",
    label: "Avstånd till tätort",
    impactPoints: urbanScore,
    note:
      nearestUrbanDistanceM !== null
        ? `Närmaste verk ligger ca ${(nearestUrbanDistanceM / 1000).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} km från Katrineholms centrum.`
        : "Inget avstånd kunde beräknas.",
  });

  // --- Mycket nära Katrineholms centrum (buggfix, se konstantens kommentar
  // ovan): en separat, betydligt kraftigare faktor för korta avstånd till
  // tätortsbebyggelsen, så placeringar nära centrum konsekvent hamnar i
  // "hög"/"mycket hög" (rött) — inte bara en svag gradvis ökning. ---
  const urbanCriticalDistanceM =
    nearestUrbanDistanceM === null ? null : nearestUrbanDistanceM - KATRINEHOLM_URBAN_RADIUS_M;
  const urbanCriticalScore =
    urbanCriticalDistanceM === null
      ? 0
      : clamp01(1 - urbanCriticalDistanceM / URBAN_CRITICAL_MARGIN_M) * URBAN_CRITICAL_WEIGHT;
  if (urbanCriticalScore > 0) {
    factors.push({
      key: "urbanCritical",
      label: "Mycket nära Katrineholms centrum",
      impactPoints: urbanCriticalScore,
      note: `Ett verk ligger mycket nära (eller inom) Katrineholms tätortsbebyggelse — endast ca ${Math.round(
        Math.max(0, urbanCriticalDistanceM ?? 0),
      )} m från tätortsgränsen.`,
    });
  }

  // --- Natur/kultur/vattenskydd (straff om ETT ELLER FLERA verk ligger inom en zon) ---
  function sensitiveZoneScore(type: "nature" | "cultural" | "water", weight: number) {
    const zones = SENSITIVE_ZONES.filter((z) => z.type === type);
    let worstOverlapFraction = 0;
    let hitName: string | null = null;
    for (const zone of zones) {
      for (const t of turbines) {
        const edge = distanceToZoneEdgeM(t, zone);
        if (edge < 0) {
          const fraction = clamp01(-edge / zone.radiusM);
          if (fraction > worstOverlapFraction) {
            worstOverlapFraction = fraction;
            hitName = zone.name;
          }
        }
      }
    }
    return { score: worstOverlapFraction * weight, hitName };
  }

  const nature = sensitiveZoneScore("nature", NATURE_WEIGHT);
  factors.push({
    key: "nature",
    label: "Natur- och friluftsvärden",
    impactPoints: nature.score,
    note: nature.hitName
      ? `Ett verk ligger inom ${nature.hitName}.`
      : "Inget verk ligger inom ett uppskattat naturvärdesområde.",
  });

  const cultural = sensitiveZoneScore("cultural", CULTURAL_WEIGHT);
  factors.push({
    key: "cultural",
    label: "Kulturmiljövärden",
    impactPoints: cultural.score,
    note: cultural.hitName
      ? `Ett verk ligger inom ${cultural.hitName}.`
      : "Inget verk ligger inom en uppskattad kulturmiljö.",
  });

  const water = sensitiveZoneScore("water", WATER_WEIGHT);
  factors.push({
    key: "water",
    label: "Vattenskyddsvärden",
    impactPoints: water.score,
    note: water.hitName
      ? `Ett verk ligger inom ${water.hitName}.`
      : "Inget verk ligger inom ett uppskattat vattenskyddsområde.",
  });

  // --- Buller: dBA vid närmaste hushållskluster (energisumma av alla verk) ---
  let worstHouseholdDba = -Infinity;
  for (const cluster of HOUSEHOLD_CLUSTERS) {
    const levels = turbines.map((t) => attenuatedLevelDba(distanceMeters(t.lat, t.lon, cluster.lat, cluster.lon)));
    const combined = combineLevelsDba(levels);
    if (combined > worstHouseholdDba) worstHouseholdDba = combined;
  }
  const noiseScore = Number.isFinite(worstHouseholdDba)
    ? clamp01((worstHouseholdDba - NOISE_MIN_DBA) / (NOISE_MAX_DBA - NOISE_MIN_DBA)) * NOISE_WEIGHT
    : 0;
  factors.push({
    key: "noise",
    label: "Uppskattad bullerpåverkan",
    impactPoints: noiseScore,
    note: Number.isFinite(worstHouseholdDba)
      ? `Uppskattad ljudnivå vid närmast berörda bebyggelse: ca ${Math.round(worstHouseholdDba)} dBA.`
      : "Kunde inte beräknas.",
  });

  // --- Visuell påverkan: baserad på avstånd till närmaste bebyggelse/tätort ---
  const nearestForVisual = Math.min(nearestHouseholdDistanceM ?? Infinity, nearestUrbanDistanceM ?? Infinity);
  const visualScore = Number.isFinite(nearestForVisual)
    ? clamp01(1 - (nearestForVisual - VISUAL_CLOSE_M) / (VISUAL_FAR_M - VISUAL_CLOSE_M)) * VISUAL_WEIGHT
    : 0;
  factors.push({
    key: "visual",
    label: "Visuell påverkan",
    impactPoints: visualScore,
    note: "Uppskattad synlighet från närmaste bebyggelse/tätort, givet verkens totalhöjd (ca 250 m).",
  });

  // --- Skuggpåverkan (skuggflimmer vid låg sol) ---
  const shadowFlickerScore = Number.isFinite(nearestForVisual)
    ? clamp01(1 - (nearestForVisual - SHADOW_FLICKER_CLOSE_M) / (SHADOW_FLICKER_FAR_M - SHADOW_FLICKER_CLOSE_M)) *
      SHADOW_FLICKER_WEIGHT
    : 0;
  factors.push({
    key: "shadowFlicker",
    label: "Skuggpåverkan vid låg sol",
    impactPoints: shadowFlickerScore,
    note: "Uppskattad risk för skuggflimmer (roterande rotorbladsskuggor) hos närmaste bebyggelse vid låg sol.",
  });

  // --- Riksintresse vindbruk (bonus) ---
  const riksintresseZone = POSITIVE_ZONES.find((z) => z.type === "riksintresse");
  const insideRiksintresse = riksintresseZone
    ? turbines.some((t) => distanceToZoneEdgeM(t, riksintresseZone) < 0)
    : false;
  factors.push({
    key: "riksintresse",
    label: "Riksintresse vindbruk",
    impactPoints: insideRiksintresse ? RIKSINTRESSE_BONUS : 0,
    note: insideRiksintresse
      ? "Minst ett verk ligger inom ett uppskattat riksintresseområde för vindbruk — en mer förutsägbar placering."
      : "Inget verk ligger inom det uppskattade riksintresseområdet.",
  });

  // --- Kommunal vindbruksplanering (bonus) ---
  const planeringZone = POSITIVE_ZONES.find((z) => z.type === "planering");
  const insidePlanering = planeringZone ? turbines.some((t) => distanceToZoneEdgeM(t, planeringZone) < 0) : false;
  factors.push({
    key: "planering",
    label: "Kommunens vindbruksplanering",
    impactPoints: insidePlanering ? PLANERING_BONUS : 0,
    note: insidePlanering
      ? "Minst ett verk ligger inom ett område kommunen redan pekat ut som lämpligt för vindkraft."
      : "Inget verk ligger inom kommunens uppskattat utpekade område.",
  });

  // --- Verk utanför Ericsbergs marker ---
  const outsideBoundaryIds = turbines.filter((t) => !isInsideBoundary(t, ERICSBERG_BOUNDARY)).map((t) => t.id);
  if (outsideBoundaryIds.length > 0) {
    factors.push({
      key: "outsideBoundary",
      label: "Utanför Ericsbergs marker",
      impactPoints: outsideBoundaryIds.length * OUTSIDE_BOUNDARY_PENALTY_PER_TURBINE,
      note: `${outsideBoundaryIds.length} verk ligger utanför det markerade markområdet.`,
    });
  }

  const rawTotal = factors.reduce((sum, f) => sum + f.impactPoints, 0);
  const totalScore = clamp(rawTotal, 0, 100);

  let level: PlacementLevel = "low";
  if (totalScore >= 80) level = "veryHigh";
  else if (totalScore >= 60) level = "high";
  else if (totalScore >= 30) level = "moderate";

  let playfulWarning: string | null = null;
  if (outsideBoundaryIds.length > 0) {
    playfulWarning = "Hoppsan! Ett eller flera verk står utanför Ericsbergs marker. Dra tillbaka dem innanför gränsen.";
  } else if (nearestHouseholdDistanceM !== null && nearestHouseholdDistanceM < 400) {
    playfulWarning = `Oj då! Ett verk står bara ${Math.round(nearestHouseholdDistanceM)} m från ${nearestHouseholdName} — det blir nog svårt att sova där.`;
  } else if (level === "veryHigh") {
    playfulWarning = "Den här placeringen ger mycket hög beräknad påverkan — fundera på att sprida ut verken mer.";
  } else if (level === "high") {
    playfulWarning = "Ganska tuff placering! Flytta gärna ett par verk längre från bebyggelse och skyddade områden.";
  }

  const turbineContributions =
    turbines.length > 1
      ? turbines
          .map((t) => ({ id: t.id, score: scorePlacement([t]).totalScore }))
          .sort((a, b) => b.score - a.score)
      : turbines.map((t) => ({ id: t.id, score: totalScore }));

  return {
    totalScore,
    level,
    householdsAffected,
    nearestHouseholdDistanceM,
    nearestHouseholdName,
    nearestUrbanDistanceM,
    outsideBoundaryIds,
    factors,
    playfulWarning,
    turbineContributions,
  };
}

export const PLACEMENT_LEVEL_LABELS: Record<PlacementLevel, string> = {
  low: "Låg påverkan",
  moderate: "Måttlig påverkan",
  high: "Hög påverkan",
  veryHigh: "Mycket hög påverkan",
};

export const PLACEMENT_LEVEL_COLORS: Record<
  PlacementLevel,
  { text: string; bg: string; border: string; emoji: string; hex: string }
> = {
  low: { text: "text-emerald-300", bg: "bg-emerald-500/15", border: "border-emerald-400/30", emoji: "🟢", hex: "#34d399" },
  moderate: { text: "text-yellow-300", bg: "bg-yellow-500/15", border: "border-yellow-400/30", emoji: "🟡", hex: "#eab308" },
  high: { text: "text-orange-300", bg: "bg-orange-500/15", border: "border-orange-400/30", emoji: "🟠", hex: "#f97316" },
  veryHigh: { text: "text-red-300", bg: "bg-red-500/15", border: "border-red-400/30", emoji: "🔴", hex: "#ef4444" },
};

export const PLACEMENT_DISCLAIMER =
  "Poängen är en förenklad, illustrativ uppskattning baserad på grovt uppskattade avstånd och områden — inte en officiell miljö- eller tillståndsbedömning.";
