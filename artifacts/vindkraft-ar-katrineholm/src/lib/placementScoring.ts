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
  HOUSEHOLD_CLUSTERS,
  KATRINEHOLM_CENTER,
  KATRINEHOLM_URBAN_RADIUS_M,
  KOMMUN_POPULATION,
  POSITIVE_ZONES,
  SENSITIVE_ZONES,
  distanceToZoneEdgeM,
  getActiveBoundary,
  isInsideBoundary,
  type HouseholdCluster,
  type SensitiveZone,
  type SensitiveZoneType,
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

export type HouseholdTierKey = "low" | "viss" | "high" | "veryHigh" | "critical" | "extreme";

export const HOUSEHOLD_TIER_LABELS: Record<HouseholdTierKey, string> = {
  low: "Boendepåverkan (avståndsviktad)",
  viss: "Viss boendepåverkan",
  high: "Hög boendepåverkan",
  veryHigh: "Mycket hög boendepåverkan",
  critical: "Kritisk boendepåverkan",
  extreme: "Extrem boendepåverkan",
};

const HOUSEHOLD_TIER_EXPLANATIONS: Record<HouseholdTierKey, string> = {
  low: "",
  viss: " Det antal berörda hushåll ger viss boendepåverkan.",
  high: " Det höga antalet berörda hushåll gör att boendepåverkan bedöms som hög.",
  veryHigh: " Det mycket höga antalet berörda hushåll gör att boendepåverkan bedöms som mycket hög.",
  critical: " Det kritiskt höga antalet berörda hushåll gör att boendepåverkan bedöms som kritisk.",
  extreme: " Det mycket stora antalet berörda hushåll gör att boendepåverkan bedöms som extrem.",
};

/**
 * Panelens färgbrytpunkter (från `PlacementScorePanel.tsx`): grön < 25,
 * gul < 50, orange < 75, röd ≥ 75. Används för minimigolv på totalpoängen.
 */
const PANEL_YELLOW_MIN = 25;
const PANEL_ORANGE_MIN = 50;
const PANEL_RED_MIN = 75;

export interface PlacementScoreResult {
  /** 0-100, klipps även om delfaktorerna summerar till mer/mindre. */
  totalScore: number;
  level: PlacementLevel;
  /** Hushållsnivå-nyckel — styr färg/etikett för boendepåverkan-faktorn i panelen. */
  householdTierKey: HouseholdTierKey;
  /** Avståndsviktad summa (över alla hushållskluster) av `households * kombineradPåverkanFraktion`. */
  householdsAffected: number;
  /** `householdsAffected * KOMMUN_POPULATION.personsPerHousehold`, avrundat. */
  inhabitantsAffected: number;
  /**
   * Viktat medelavstånd (viktat med `households * kombineradPåverkanFraktion` per
   * kluster) till NÄRMASTE verk, bland de kluster som faktiskt är påverkade.
   * `null` om ingen placering finns eller inget kluster har någon påverkan.
   */
  avgNearestHouseholdDistanceM: number | null;
  /**
   * 0-100: viktat medelvärde av kombinerad påverkansfraktion (se
   * `distanceImpactFraction`/`combinedImpactFraction`) över SAMTLIGA
   * hushållskluster, viktat med antal hushåll — dvs. hur stor andel av
   * kommunens hushåll som (avståndsviktat) berörs. Detta är det tydliga,
   * användarvända "Påverkansindex" som alltid visas i UI:t.
   */
  impactIndex: number;
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
  /** Fullständig per-verk felsökningsdata — se `TurbineDebugInfo`. */
  turbineDebug: TurbineDebugInfo[];
  /** Hur många datapunkter/zoner som faktiskt är laddade i respektive lager. */
  layerCounts: LayerCounts;
}

export interface TurbineDebugInfo {
  id: string;
  lat: number;
  lon: number;
  insideBoundary: boolean;
  nearestHouseholdDistanceM: number | null;
  nearestHouseholdName: string | null;
  householdsWithin1kmCount: number;
  householdsWithin2kmCount: number;
  householdsWithin3kmCount: number;
  distanceToKatrineholmCenterM: number;
  nearestNatureDistanceM: number | null;
  nearestNatureName: string | null;
  nearestCulturalDistanceM: number | null;
  nearestCulturalName: string | null;
  nearestWaterDistanceM: number | null;
  nearestWaterName: string | null;
  noiseDba: number | null;
  shadowFlickerScore: number;
  visualScore: number;
  /** Verkets EGEN totalpoäng om det stod ensamt (samma tal som i `turbineContributions`). */
  totalScore: number;
}

export interface LayerCounts {
  householdClusters: number;
  natureZones: number;
  culturalZones: number;
  waterZones: number;
  positiveZones: number;
}

/**
 * Nationell platskontext hämtad från `/api/location-context` (Overpass API).
 * När den skickas in till `scorePlacement` ersätter den de hårdkodade
 * Ericsberg/Katrineholm-konstanterna, så att scoring fungerar var som helst
 * i Sverige.
 */
export interface LocationSettlement {
  name: string;
  lat: number;
  lng: number;
  population: number;
  households: number;
}

export interface LocationProtectedArea {
  name: string;
  type: "nature" | "cultural" | "water";
  lat: number;
  lng: number;
  radiusM: number;
}

export interface LocationContext {
  settlements: LocationSettlement[];
  protectedAreas: LocationProtectedArea[];
}

/**
 * Avståndsviktad påverkansmodell (ersätter en tidigare fast räckviddsradie):
 * varje bostad/hushållskluster får en "påverkansfraktion" 0-1 baserat på
 * avstånd till ETT verk, ankrad i följande exempelvärden (linjärt
 * interpolerad mellan ankarna för en mjuk, kontinuerlig kurva istället för
 * ett stegvis hopp): 0-2 km ≈ 100 %, 2-5 km ≈ 70 %, 5-10 km ≈ 40 %,
 * 10-20 km ≈ 15 %, >20 km avtar mot 0 % (helt 0 vid 25 km). Se
 * `combinedImpactFraction` för hur flera verk mot SAMMA hushållskluster
 * kombineras (så att effekten ökar om flera verk påverkar samma område,
 * istället för att bara räkna det närmaste).
 */
const DISTANCE_IMPACT_ANCHORS: [distanceM: number, fraction: number][] = [
  [0, 1.0],
  [2000, 1.0],
  [5000, 0.7],
  [10000, 0.4],
  [20000, 0.15],
  [25000, 0],
];
const HOUSEHOLD_IMPACT_WEIGHT = 40;
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

function nearestHousehold(
  point: { lat: number; lon: number },
  clusters: HouseholdCluster[],
): { cluster: HouseholdCluster; distanceM: number } | null {
  let best: { cluster: HouseholdCluster; distanceM: number } | null = null;
  for (const cluster of clusters) {
    const distanceM = distanceMeters(point.lat, point.lon, cluster.lat, cluster.lon);
    if (!best || distanceM < best.distanceM) best = { cluster, distanceM };
  }
  return best;
}

function nearestZoneOfType(
  point: { lat: number; lon: number },
  type: SensitiveZoneType,
  zones: SensitiveZone[],
): { name: string; distanceM: number } | null {
  let best: { name: string; distanceM: number } | null = null;
  for (const zone of zones) {
    if (zone.type !== type) continue;
    // Avstånd till kanten (negativt = innanför zonen), klippt till 0 så
    // "inom zonen" konsekvent visas som 0 m i felsökningspanelen.
    const distanceM = Math.max(0, distanceToZoneEdgeM(point, zone));
    if (!best || distanceM < best.distanceM) best = { name: zone.name, distanceM };
  }
  return best;
}

function householdsWithinRadius(
  point: { lat: number; lon: number },
  radiusM: number,
  clusters: HouseholdCluster[],
): number {
  let count = 0;
  for (const cluster of clusters) {
    if (distanceMeters(point.lat, point.lon, cluster.lat, cluster.lon) <= radiusM) {
      count += cluster.households;
    }
  }
  return count;
}

/**
 * Kontinuerlig (styckvis linjär) påverkansfraktion 0-1 för EN bostad/kluster
 * mot ETT enskilt verk, ankrad i `DISTANCE_IMPACT_ANCHORS`. Se konstantens
 * kommentar för de exempelvärden kurvan är byggd kring.
 */
function distanceImpactFraction(distanceM: number): number {
  const anchors = DISTANCE_IMPACT_ANCHORS;
  if (distanceM <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    const [d1, f1] = anchors[i - 1];
    const [d2, f2] = anchors[i];
    if (distanceM <= d2) {
      const t = (distanceM - d1) / (d2 - d1);
      return f1 + (f2 - f1) * t;
    }
  }
  return 0;
}

interface HouseholdClusterImpact {
  cluster: HouseholdCluster;
  /** 1 - Π(1 - fraktion_i) över alla verk — ökar med varje verk som når klustret, oavsett hur många redan gör det. */
  combinedFraction: number;
  /** Avstånd till det NÄRMASTE verket, oavsett dess enskilda fraktion. */
  nearestDistanceM: number;
}

/**
 * Kombinerar flera verks påverkan på SAMMA hushållskluster via en
 * sannolikhets-"union" (1 - produkten av att INGET verk påverkar), så att
 * fler verk mot samma område ökar den sammanlagda effekten (utan att kunna
 * överstiga 100 %) — istället för att bara räkna det närmaste verket.
 */
function computeHouseholdImpacts(turbines: PlacedTurbine[], clusters: HouseholdCluster[]): HouseholdClusterImpact[] {
  return clusters.map((cluster) => {
    let product = 1;
    let nearestDistanceM = Infinity;
    for (const t of turbines) {
      const d = distanceMeters(t.lat, t.lon, cluster.lat, cluster.lon);
      if (d < nearestDistanceM) nearestDistanceM = d;
      product *= 1 - distanceImpactFraction(d);
    }
    return {
      cluster,
      combinedFraction: turbines.length > 0 ? clamp01(1 - product) : 0,
      nearestDistanceM,
    };
  });
}

/**
 * Kontinuerlig färgövergång grön → gul → orange → mörkröd för en 0-100
 * påverkanspoäng — används för att färga kartans verk-markörer dynamiskt
 * (istället för fyra diskreta steg som i `PLACEMENT_LEVEL_COLORS`).
 */
export function impactScoreToColor(score: number): string {
  const s = clamp(score, 0, 100);
  const stops: [number, [number, number, number]][] = [
    [0, [52, 211, 153]],
    [30, [234, 179, 8]],
    [60, [249, 115, 22]],
    [100, [127, 29, 29]],
  ];
  for (let i = 1; i < stops.length; i++) {
    const [d1, c1] = stops[i - 1];
    const [d2, c2] = stops[i];
    if (s <= d2) {
      const t = (s - d1) / (d2 - d1);
      const r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
      const g = Math.round(c1[1] + (c2[1] - c1[1]) * t);
      const b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
      return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
    }
  }
  return "#7f1d1d";
}

const LAYER_COUNTS: LayerCounts = {
  householdClusters: HOUSEHOLD_CLUSTERS.length,
  natureZones: SENSITIVE_ZONES.filter((z) => z.type === "nature").length,
  culturalZones: SENSITIVE_ZONES.filter((z) => z.type === "cultural").length,
  waterZones: SENSITIVE_ZONES.filter((z) => z.type === "water").length,
  positiveZones: POSITIVE_ZONES.length,
};

/**
 * Beräknar en konsekvenspoäng för en placering av (upp till) 8 verk. Tomma
 * eller ofullständiga placeringar (färre än 8 verk) poängsätts ändå utifrån
 * de verk som faktiskt är utplacerade, så panelen kan uppdateras live medan
 * användaren drar ut verk ett i taget.
 */
export function scorePlacement(turbines: PlacedTurbine[], ctx?: LocationContext): PlacementScoreResult {
  // --- Lös effektiva datakällor: ctx ersätter hårdkodad Ericsberg-data ---
  const effClusters: HouseholdCluster[] = ctx
    ? ctx.settlements.map((s, i) => ({
        id: `loc-${i}`,
        name: s.name,
        lat: s.lat,
        lon: s.lng,
        households: s.households,
      }))
    : HOUSEHOLD_CLUSTERS;

  const effUrbanSettlement = ctx
    ? ctx.settlements.length > 0
      ? ctx.settlements.reduce((a, b) => (a.population > b.population ? a : b))
      : null
    : null;
  const effUrbanCenter: { lat: number; lon: number } | null = ctx
    ? effUrbanSettlement
      ? { lat: effUrbanSettlement.lat, lon: effUrbanSettlement.lng }
      : null
    : KATRINEHOLM_CENTER;
  const effUrbanName: string = ctx
    ? (effUrbanSettlement?.name ?? "närmaste tätort")
    : "Katrineholms centrum";
  const effUrbanRadius: number = ctx
    ? effUrbanSettlement
      ? effUrbanSettlement.population > 20000
        ? 2500
        : effUrbanSettlement.population > 5000
          ? 1500
          : 800
      : 1000
    : KATRINEHOLM_URBAN_RADIUS_M;

  const effZones: SensitiveZone[] = ctx
    ? ctx.protectedAreas.map((p, i) => ({
        id: `loc-${i}`,
        name: p.name,
        type: p.type,
        lat: p.lat,
        lon: p.lng,
        radiusM: p.radiusM,
        description: "",
      }))
    : SENSITIVE_ZONES;

  const effPersonsPerHousehold = ctx ? 2.0 : KOMMUN_POPULATION.personsPerHousehold;

  const factors: FactorScore[] = [];

  if (turbines.length === 0) {
    return {
      totalScore: 0,
      level: "low",
      householdTierKey: "low",
      householdsAffected: 0,
      inhabitantsAffected: 0,
      avgNearestHouseholdDistanceM: null,
      impactIndex: 0,
      nearestHouseholdDistanceM: null,
      nearestHouseholdName: null,
      nearestUrbanDistanceM: null,
      outsideBoundaryIds: [],
      factors: [],
      playfulWarning: null,
      turbineContributions: [],
      turbineDebug: [],
      layerCounts: {
        householdClusters: effClusters.length,
        natureZones: effZones.filter((z) => z.type === "nature").length,
        culturalZones: effZones.filter((z) => z.type === "cultural").length,
        waterZones: effZones.filter((z) => z.type === "water").length,
        positiveZones: POSITIVE_ZONES.length,
      },
    };
  }

  // --- Avstånd till bostäder (globalt närmaste hushållskluster) ---
  let nearestHouseholdDistanceM: number | null = null;
  let nearestHouseholdName: string | null = null;
  for (const t of turbines) {
    const nearest = nearestHousehold(t, effClusters);
    if (nearest && (nearestHouseholdDistanceM === null || nearest.distanceM < nearestHouseholdDistanceM)) {
      nearestHouseholdDistanceM = nearest.distanceM;
      nearestHouseholdName = nearest.cluster.name;
    }
  }
  factors.push({
    key: "householdProximity",
    label: "Avstånd till bostäder",
    impactPoints: 0,
    note:
      nearestHouseholdDistanceM !== null
        ? `Närmaste bebyggelse (${nearestHouseholdName}) ligger ${Math.round(nearestHouseholdDistanceM)} m från ett verk.`
        : "Inget avstånd kunde beräknas.",
  });

  // --- Boendepåverkan: avståndsviktad, kombinerad över ALLA verk per hushållskluster ---
  const householdImpacts = computeHouseholdImpacts(turbines, effClusters);
  let householdsAffectedF = 0;
  let totalHouseholds = 0;
  let weightedDistanceSum = 0;
  let weightedDistanceWeight = 0;
  for (const hi of householdImpacts) {
    householdsAffectedF += hi.cluster.households * hi.combinedFraction;
    totalHouseholds += hi.cluster.households;
    if (hi.combinedFraction > 0 && Number.isFinite(hi.nearestDistanceM)) {
      weightedDistanceSum += hi.cluster.households * hi.combinedFraction * hi.nearestDistanceM;
      weightedDistanceWeight += hi.cluster.households * hi.combinedFraction;
    }
  }
  const householdsAffected = Math.round(householdsAffectedF);
  const inhabitantsAffected = Math.round(householdsAffectedF * effPersonsPerHousehold);
  const avgNearestHouseholdDistanceM = weightedDistanceWeight > 0 ? weightedDistanceSum / weightedDistanceWeight : null;
  const impactIndex = totalHouseholds > 0 ? Math.round(clamp01(householdsAffectedF / totalHouseholds) * 100) : 0;

  // Hushållsnivå — styr etikett, faktorfärg och minimigolv.
  const householdTierKey: HouseholdTierKey =
    householdsAffected > 10000 ? "extreme" :
    householdsAffected > 5000 ? "critical" :
    householdsAffected > 2000 ? "veryHigh" :
    householdsAffected > 500 ? "high" :
    householdsAffected > 100 ? "viss" :
    "low";

  // Minimipoäng för faktorn baserat på antal hushåll — oberoende av avståndsviktning.
  const householdMinimumScore =
    householdsAffected > 10000 ? 10 :
    householdsAffected > 5000 ? 8 :
    householdsAffected > 2000 ? 6 :
    householdsAffected > 500 ? 4 :
    householdsAffected > 100 ? 2 :
    0;

  const distanceBasedHouseholdScore = clamp01(impactIndex / 100) * HOUSEHOLD_IMPACT_WEIGHT;
  const householdImpactScore = Math.max(distanceBasedHouseholdScore, householdMinimumScore);

  const avgDistStr =
    avgNearestHouseholdDistanceM !== null
      ? `, i genomsnitt ${(avgNearestHouseholdDistanceM / 1000).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} km från närmaste verk.`
      : ".";

  factors.push({
    key: "householdImpact",
    label: HOUSEHOLD_TIER_LABELS[householdTierKey],
    impactPoints: householdImpactScore,
    note:
      `Uppskattningsvis ${householdsAffected.toLocaleString("sv-SE")} hushåll (cirka ${inhabitantsAffected.toLocaleString("sv-SE")} invånare) berörs. ` +
      `Påverkansindex ${impactIndex}/100${avgDistStr}` +
      HOUSEHOLD_TIER_EXPLANATIONS[householdTierKey],
  });

  // --- Avstånd till tätort (närmaste stad/ort) ---
  let nearestUrbanDistanceM: number | null = null;
  if (effUrbanCenter) {
    for (const t of turbines) {
      const d = distanceMeters(t.lat, t.lon, effUrbanCenter.lat, effUrbanCenter.lon);
      if (nearestUrbanDistanceM === null || d < nearestUrbanDistanceM) nearestUrbanDistanceM = d;
    }
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
        ? `Närmaste verk ligger ca ${(nearestUrbanDistanceM / 1000).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} km från ${effUrbanName}.`
        : "Ingen tätort hittades i närheten.",
  });

  // --- Mycket nära tätortsbebyggelse: separat, kraftigare faktor för korta
  // avstånd — placeringar nära centrum hamnar konsekvent i "hög"/"mycket hög". ---
  const urbanCriticalDistanceM =
    nearestUrbanDistanceM === null ? null : nearestUrbanDistanceM - effUrbanRadius;
  const urbanCriticalScore =
    urbanCriticalDistanceM === null
      ? 0
      : clamp01(1 - urbanCriticalDistanceM / URBAN_CRITICAL_MARGIN_M) * URBAN_CRITICAL_WEIGHT;
  if (urbanCriticalScore > 0) {
    factors.push({
      key: "urbanCritical",
      label: `Mycket nära ${effUrbanName}`,
      impactPoints: urbanCriticalScore,
      note: `Ett verk ligger mycket nära (eller inom) ${effUrbanName}s tätortsbebyggelse — endast ca ${Math.round(
        Math.max(0, urbanCriticalDistanceM ?? 0),
      )} m från tätortsgränsen.`,
    });
  }

  // --- Natur/kultur/vattenskydd (straff om ETT ELLER FLERA verk ligger inom en zon) ---
  function sensitiveZoneScore(type: "nature" | "cultural" | "water", weight: number) {
    const zones = effZones.filter((z) => z.type === type);
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
  for (const cluster of effClusters) {
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

  // --- Verk utanför Ericsbergs marker (bara i fristående Ericsberg-läge) ---
  const outsideBoundaryIds = ctx
    ? []
    : turbines.filter((t) => !isInsideBoundary(t, getActiveBoundary())).map((t) => t.id);
  if (!ctx && outsideBoundaryIds.length > 0) {
    factors.push({
      key: "outsideBoundary",
      label: "Utanför Ericsbergs marker",
      impactPoints: outsideBoundaryIds.length * OUTSIDE_BOUNDARY_PENALTY_PER_TURBINE,
      note: `${outsideBoundaryIds.length} verk ligger utanför det markerade markområdet.`,
    });
  }

  const rawTotal = factors.reduce((sum, f) => sum + f.impactPoints, 0);

  // Minimigolv på totalpoängen när mycket många hushåll berörs — projektet
  // ska aldrig visas som grönt/gult/orange om antalet berörda hushåll är
  // kritiskt. Trösklar matchar panelens färgbrytpunkter (25/50/75).
  const minimumTotalScoreFromHousing =
    householdsAffected > 10000 ? PANEL_RED_MIN :
    householdsAffected > 5000 ? PANEL_ORANGE_MIN :
    householdsAffected > 2000 ? PANEL_YELLOW_MIN :
    0;
  const totalScore = clamp(Math.max(rawTotal, minimumTotalScoreFromHousing), 0, 100);

  let level: PlacementLevel = "low";
  if (totalScore >= 80) level = "veryHigh";
  else if (totalScore >= 60) level = "high";
  else if (totalScore >= 30) level = "moderate";

  let playfulWarning: string | null = null;
  if (!ctx && outsideBoundaryIds.length > 0) {
    playfulWarning = "Hoppsan! Ett eller flera verk står utanför Ericsbergs marker. Dra tillbaka dem innanför gränsen.";
  } else if (nearestHouseholdDistanceM !== null && nearestHouseholdDistanceM < 400) {
    playfulWarning = `Oj då! Ett verk står bara ${Math.round(nearestHouseholdDistanceM)} m från ${nearestHouseholdName} — det blir nog svårt att sova där.`;
  } else if (level === "veryHigh") {
    playfulWarning = "Den här placeringen ger mycket hög beräknad påverkan — fundera på att sprida ut verken mer.";
  } else if (level === "high") {
    playfulWarning = "Ganska tuff placering! Flytta gärna ett par verk längre från bebyggelse och skyddade områden.";
  }

  const soloScores = new Map<string, number>();
  if (turbines.length > 1) {
    for (const t of turbines) soloScores.set(t.id, scorePlacement([t], ctx).totalScore);
  } else {
    for (const t of turbines) soloScores.set(t.id, totalScore);
  }

  const turbineContributions = turbines
    .map((t) => ({ id: t.id, score: soloScores.get(t.id) ?? totalScore }))
    .sort((a, b) => b.score - a.score);

  // --- Fullständig per-verk felsökningsdata (se `TurbineDebugInfo`) — svar
  // på buggrapportens krav på en fördjupad felsökningspanel: koordinat,
  // inne/ute-status, hushåll inom 1/2/3 km, avstånd till varje enskilt
  // lager (centrum, natur, kultur, vatten), buller/skugg/visuell
  // delpoäng, samt totalpoängen om verket stått ensamt. ---
  const turbineDebug: TurbineDebugInfo[] = turbines.map((t) => {
    const nearest = nearestHousehold(t, effClusters);
    const nature = nearestZoneOfType(t, "nature", effZones);
    const cultural = nearestZoneOfType(t, "cultural", effZones);
    const water = nearestZoneOfType(t, "water", effZones);
    let worstDba = -Infinity;
    for (const cluster of effClusters) {
      const level = attenuatedLevelDba(distanceMeters(t.lat, t.lon, cluster.lat, cluster.lon));
      if (level > worstDba) worstDba = level;
    }
    const urbanDistForDebug = effUrbanCenter
      ? distanceMeters(t.lat, t.lon, effUrbanCenter.lat, effUrbanCenter.lon)
      : Infinity;
    const nearestForVisualSolo = Math.min(nearest?.distanceM ?? Infinity, urbanDistForDebug);
    const soloVisualScore = Number.isFinite(nearestForVisualSolo)
      ? clamp01(1 - (nearestForVisualSolo - VISUAL_CLOSE_M) / (VISUAL_FAR_M - VISUAL_CLOSE_M)) * VISUAL_WEIGHT
      : 0;
    const soloShadowScore = Number.isFinite(nearestForVisualSolo)
      ? clamp01(1 - (nearestForVisualSolo - SHADOW_FLICKER_CLOSE_M) / (SHADOW_FLICKER_FAR_M - SHADOW_FLICKER_CLOSE_M)) *
        SHADOW_FLICKER_WEIGHT
      : 0;
    return {
      id: t.id,
      lat: t.lat,
      lon: t.lon,
      insideBoundary: isInsideBoundary(t, getActiveBoundary()),
      nearestHouseholdDistanceM: nearest?.distanceM ?? null,
      nearestHouseholdName: nearest?.cluster.name ?? null,
      householdsWithin1kmCount: householdsWithinRadius(t, 1000, effClusters),
      householdsWithin2kmCount: householdsWithinRadius(t, 2000, effClusters),
      householdsWithin3kmCount: householdsWithinRadius(t, 3000, effClusters),
      distanceToKatrineholmCenterM: effUrbanCenter
        ? distanceMeters(t.lat, t.lon, effUrbanCenter.lat, effUrbanCenter.lon)
        : 0,
      nearestNatureDistanceM: nature?.distanceM ?? null,
      nearestNatureName: nature?.name ?? null,
      nearestCulturalDistanceM: cultural?.distanceM ?? null,
      nearestCulturalName: cultural?.name ?? null,
      nearestWaterDistanceM: water?.distanceM ?? null,
      nearestWaterName: water?.name ?? null,
      noiseDba: Number.isFinite(worstDba) ? worstDba : null,
      shadowFlickerScore: soloShadowScore,
      visualScore: soloVisualScore,
      totalScore: soloScores.get(t.id) ?? totalScore,
    };
  });

  return {
    totalScore,
    level,
    householdTierKey,
    householdsAffected,
    inhabitantsAffected,
    avgNearestHouseholdDistanceM,
    impactIndex,
    nearestHouseholdDistanceM,
    nearestHouseholdName,
    nearestUrbanDistanceM,
    outsideBoundaryIds,
    factors,
    playfulWarning,
    turbineContributions,
    turbineDebug,
    layerCounts: {
      householdClusters: effClusters.length,
      natureZones: effZones.filter((z) => z.type === "nature").length,
      culturalZones: effZones.filter((z) => z.type === "cultural").length,
      waterZones: effZones.filter((z) => z.type === "water").length,
      positiveZones: POSITIVE_ZONES.length,
    },
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
