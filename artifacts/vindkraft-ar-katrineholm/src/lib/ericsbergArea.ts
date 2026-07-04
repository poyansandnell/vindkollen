// Geodata för "Placera vindkraftverken själv" — ett lekfullt men seriöst
// planeringsläge där användaren själv får placera 8 vindkraftverk på
// Ericsbergs marker (sydväst om Katrineholm, nära Björkvik) och se den
// beräknade konsekvensen i realtid.
//
// VIKTIGT: Det finns ingen exakt digital fastighetsgräns eller GIS-data
// tillgänglig för det här läget (de bifogade referensbilderna/PDF:erna
// innehåller ingen maskinläsbar geodata, bara "© Lantmäteriet"-attribution).
// Samtliga koordinater nedan — markgräns, bebyggelseklustren, natur-/
// kultur-/vattenskyddszonerna och riksintresse-/planeringszonerna — är
// därför GROVT UPPSKATTADE illustrationer, grundade i den ungefärliga
// verkliga positionen för Ericsbergs gods (sydväst om Katrineholm, nära
// Björkvik/Yngaren), inte exakta myndighets- eller lantmäteridata. Se
// `ERICSBERG_AREA_DISCLAIMER` för den text som alltid ska visas tillsammans
// med kartan.
import { distanceMeters } from "./geo";
import {
  ERICSBERG_ESTATE_AREA_BOUNDARY,
  ERICSBERG_PLACEMENT_BOUNDARY,
  geoJsonPolygonToLatLon,
} from "./ericsbergBoundaryData";

export interface LatLon {
  lat: number;
  lon: number;
}

/** Katrineholms centrum — samma referenspunkt som i `MapView.tsx`. */
export const KATRINEHOLM_CENTER: LatLon = { lat: 58.9959, lon: 16.2072 };

/**
 * Ungefärlig radie (meter) för Katrineholms tätortsbebyggelse räknat från
 * `KATRINEHOLM_CENTER` — används för att avgöra hur nära en placering ligger
 * den FAKTISKA tätortsbebyggelsen (inte bara en enda punkt), se
 * `placementScoring.ts`s "mycket nära centrum"-faktor.
 */
export const KATRINEHOLM_URBAN_RADIUS_M = 2000;

/** Ungefärligt mittpunkt för Ericsbergs marker, sydväst om Katrineholm. */
export const ERICSBERG_CENTER: LatLon = { lat: 58.883, lon: 16.058 };

/**
 * Ungefärlig markgräns (polygon, WGS84) för det område inom Ericsbergs
 * marker där verken kan placeras. Handritad utifrån de bifogade
 * referensbilderna — INTE en exakt fastighetsgräns. Källdata (redigerbar
 * separat) finns i `ericsbergBoundaryData.ts`.
 */
export const ERICSBERG_BOUNDARY: LatLon[] = geoJsonPolygonToLatLon(ERICSBERG_PLACEMENT_BOUNDARY);

/**
 * "Ericsbergs mark" — en betydligt STÖRRE, illustrativ markering av
 * Ericsbergs samlade godsmark (inte bara placeringsområdet ovan), grovt
 * dragen så den sträcker sig mellan de omgivande orterna/platserna
 * Katrineholm, Forssjö, Stora Malm, Ericsberg och Strångsjö/Norrlunda, per
 * användarens referensbild. Precis som `ERICSBERG_BOUNDARY` är detta EN GROV
 * UPPSKATTNING — se `ERICSBERG_AREA_DISCLAIMER` — inte en exakt
 * fastighets- eller lantmäterigräns. Visas som ett separat, valbart lager
 * ("Visa Ericsbergs mark") skilt från placeringsområdet. Källdata
 * (redigerbar separat) finns i `ericsbergBoundaryData.ts`.
 */
export const ERICSBERG_ESTATE_AREA: LatLon[] = geoJsonPolygonToLatLon(ERICSBERG_ESTATE_AREA_BOUNDARY);

const CUSTOM_BOUNDARY_STORAGE_KEY = "vindkraft-ar-katrineholm:customBoundary";

function isValidLatLonArray(value: unknown): value is LatLon[] {
  return (
    Array.isArray(value) &&
    value.length >= 3 &&
    value.every((p) => p && typeof p.lat === "number" && typeof p.lon === "number")
  );
}

function loadCustomBoundaryFromStorage(): LatLon[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CUSTOM_BOUNDARY_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidLatLonArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

let customBoundaryOverride: LatLon[] | null = loadCustomBoundaryFromStorage();

/**
 * Den placeringsgräns som FAKTISKT ska användas — en användarredigerad
 * gräns (sparad via `setCustomBoundary`, persisterad i localStorage under
 * `CUSTOM_BOUNDARY_STORAGE_KEY`) om en sådan finns, annars den inbyggda
 * `ERICSBERG_BOUNDARY`. `placementScoring.ts` och `PlacementMap.tsx` ska
 * använda den här funktionen (inte den statiska konstanten direkt) så att
 * gränsredigeraren i `PlaceTurbines.tsx` faktiskt påverkar poängsättning och
 * ritning.
 */
export function getActiveBoundary(): LatLon[] {
  return customBoundaryOverride ?? ERICSBERG_BOUNDARY;
}

export function hasCustomBoundary(): boolean {
  return customBoundaryOverride !== null;
}

export function setCustomBoundary(points: LatLon[]): void {
  if (!isValidLatLonArray(points)) return;
  customBoundaryOverride = points;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(CUSTOM_BOUNDARY_STORAGE_KEY, JSON.stringify(points));
  }
}

export function resetCustomBoundary(): void {
  customBoundaryOverride = null;
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(CUSTOM_BOUNDARY_STORAGE_KEY);
  }
}

/** Exporterar en gräns som en GeoJSON `Polygon`-feature ([lon,lat]-par, sluten ring). */
export function boundaryToGeoJson(boundary: LatLon[]): {
  type: "Feature";
  properties: { name: string };
  geometry: { type: "Polygon"; coordinates: number[][][] };
} {
  const ring = boundary.map((p) => [p.lon, p.lat]);
  if (ring.length > 0) {
    const [firstLon, firstLat] = ring[0];
    const [lastLon, lastLat] = ring[ring.length - 1];
    if (firstLon !== lastLon || firstLat !== lastLat) ring.push([firstLon, firstLat]);
  }
  return {
    type: "Feature",
    properties: { name: "Ericsbergs placeringsområde (redigerad)" },
    geometry: { type: "Polygon", coordinates: [ring] },
  };
}

/** Ray-casting punkt-i-polygon-test. */
export function isInsideBoundary(point: LatLon, boundary: LatLon[] = ERICSBERG_BOUNDARY): boolean {
  let inside = false;
  for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
    const xi = boundary[i].lon;
    const yi = boundary[i].lat;
    const xj = boundary[j].lon;
    const yj = boundary[j].lat;
    const intersects =
      yi > point.lat !== yj > point.lat &&
      point.lon < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export interface HouseholdCluster {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Uppskattat antal hushåll — grov illustration, inte folkbokföringsdata. */
  households: number;
}

/**
 * Kommunfaktan simuleringen bygger på (av användaren angivna, avrundade
 * siffror — inte SCB-data hämtad i appen): Katrineholms kommun har totalt
 * ca 35 000 invånare, varav ca 25 000 bor i inre Katrineholm (tätorten) och
 * resterande ca 10 000 är fördelade på kransorterna/byarna runtom. Omräknat
 * med en grov schablon på ~2,1 personer/hushåll ger det ca 11 900 hushåll i
 * inre Katrineholm och ca 4 800 hushåll i kransorterna — de tal
 * `HOUSEHOLD_CLUSTERS` nedan summerar till (approximativt, se
 * per-kluster-kommentarerna).
 */
export const KOMMUN_POPULATION = {
  totalInhabitants: 35000,
  innerKatrineholmInhabitants: 25000,
  kransorterInhabitants: 10000,
  personsPerHousehold: 2.1,
};

/**
 * BUGGFIX: tidigare innehöll denna lista bara fyra små kluster kring
 * Ericsberg (Björkvik/Marmorbruket/Forssjö/Ericsbergs gård), vilket gjorde
 * att "Antal berörda hushåll", "Avstånd till bostäder" och (eftersom bullret
 * i `placementScoring.ts` räknas mot just dessa kluster) "Bullerpåverkan"
 * alla blev 0 så fort verk placerades nära Katrineholm/Forssjö-området
 * längre bort från Ericsberg — precis de platser användaren faktiskt testar
 * eftersom de 8 verkliga närmaste verken (`DEFAULT_TURBINES` i
 * PlaceTurbines.tsx) står 3–8 km NORDOST om Ericsberg, inte i eller nära
 * det. Listan är nu utökad med inre Katrineholms tätortsbebyggelse (uppdelad
 * i några stadsdelspunkter så avstånds-/räkneberäkningar blir meningsfulla,
 * inte en enda punkt) och de verkliga kransorterna/byarna i kommunen, så att
 * en placering NÄRA VILKEN AV DESSA ORTER SOM HELST ger utslag — inte bara
 * Ericsberg. Koordinaterna för kransorterna är, liksom övriga geodata i den
 * här filen, grovt uppskattade lägen för respektive ort, inte exakt
 * lantmäteridata. Hushållssiffrorna är fördelade proportionellt mot
 * `KOMMUN_POPULATION` ovan.
 */
export const HOUSEHOLD_CLUSTERS: HouseholdCluster[] = [
  // --- Inre Katrineholm (~25 000 invånare ≈ ~11 900 hushåll), uppdelat på
  // några stadsdelspunkter kring centrum så avståndsberäkningar mot olika
  // delar av tätorten blir rimliga. ---
  { id: "katrineholm-centrum", name: "Katrineholm centrum", lat: 58.9959, lon: 16.2072, households: 4600 },
  { id: "katrineholm-norr", name: "Katrineholm, Nyhem/Norr", lat: 58.9995, lon: 16.202, households: 2400 },
  { id: "katrineholm-vaster", name: "Katrineholm, Sandbäcken/Väster", lat: 58.994, lon: 16.188, households: 2000 },
  { id: "katrineholm-oster", name: "Katrineholm, Ängsholmen/Öster", lat: 58.9925, lon: 16.223, households: 1500 },
  { id: "katrineholm-soder", name: "Katrineholm, Näringen/Söder", lat: 58.9865, lon: 16.204, households: 1400 },
  // --- Kransorter/byar (~10 000 invånare ≈ ~4 800 hushåll totalt). ---
  { id: "bjorkvik", name: "Björkvik", lat: 58.869, lon: 16.145, households: 900 },
  { id: "skoldinge", name: "Sköldinge", lat: 59.021, lon: 16.083, households: 700 },
  { id: "julita", name: "Julita", lat: 59.128, lon: 16.213, households: 600 },
  { id: "strangsjo", name: "Strångsjö", lat: 58.93, lon: 16.021, households: 500 },
  { id: "bie", name: "Bie", lat: 58.832, lon: 16.281, households: 400 },
  { id: "askoping", name: "Äsköping", lat: 58.989, lon: 16.352, households: 300 },
  { id: "forssjo", name: "Forssjö", lat: 58.93, lon: 16.145, households: 150 },
  { id: "ericsberg-gard", name: "Ericsbergs gård & skola", lat: 58.883, lon: 16.058, households: 25 },
  {
    id: "landsbygd-ovrigt",
    name: "Övrig landsbygd/kransbygd",
    lat: 58.955,
    lon: 16.14,
    households: 225,
  },
];

export type SensitiveZoneType = "nature" | "cultural" | "water";

export interface SensitiveZone {
  id: string;
  name: string;
  type: SensitiveZoneType;
  lat: number;
  lon: number;
  radiusM: number;
  description: string;
}

/**
 * Zoner som ökar konsekvenspoängen om ett verk placeras inom dem.
 *
 * BUGGFIX (samma som för `HOUSEHOLD_CLUSTERS` ovan): de ursprungliga tre
 * zonerna låg alla vid sjön Yngaren/Ericsberg, så natur-/kultur-/
 * vattenskyddspoängen blev alltid 0 för placeringar nära Katrineholm/
 * Forssjö. Tillagt: några verkliga, kända sjöar/naturområden/kulturmiljöer
 * i och strax söder om Katrineholms tätort (Näsnaren, Duveholmssjön, Djulö
 * naturreservat, Duveholms slott) — namnen och ungefärliga lägena är
 * verkliga, men gränserna/radierna är grova illustrationer precis som
 * övriga zoner i den här filen.
 */
export const SENSITIVE_ZONES: SensitiveZone[] = [
  {
    id: "yngaren-natur",
    name: "Yngarens naturområde",
    type: "nature",
    lat: 58.87,
    lon: 16.1,
    radiusM: 800,
    description: "Uppskattat värdefullt natur- och friluftsområde vid sjön Yngaren.",
  },
  {
    id: "ericsberg-kulturmiljo",
    name: "Ericsbergs slottspark",
    type: "cultural",
    lat: 58.884,
    lon: 16.057,
    radiusM: 600,
    description: "Uppskattad kulturmiljö kring Ericsbergs slott och park.",
  },
  {
    id: "yngaren-vattenskydd",
    name: "Vattenskyddsområde Yngaren",
    type: "water",
    lat: 58.865,
    lon: 16.09,
    radiusM: 700,
    description: "Uppskattat vattenskyddsområde kring sjön Yngaren.",
  },
  {
    id: "djulo-naturreservat",
    name: "Djulö naturreservat",
    type: "nature",
    lat: 59.003,
    lon: 16.238,
    radiusM: 900,
    description: "Naturreservat/friluftsområde strax nordöst om Katrineholms centrum.",
  },
  {
    id: "duveholms-slott",
    name: "Duveholms slott och park",
    type: "cultural",
    lat: 58.99,
    lon: 16.185,
    radiusM: 500,
    description: "Kulturmiljö kring Duveholms slott, sjö och park i Katrineholm.",
  },
  {
    id: "duveholmssjon",
    name: "Duveholmssjön",
    type: "water",
    lat: 58.988,
    lon: 16.182,
    radiusM: 500,
    description: "Sjö/vattenområde i västra Katrineholm.",
  },
  {
    id: "nasnaren-vatten",
    name: "Näsnaren",
    type: "water",
    lat: 58.951,
    lon: 16.192,
    radiusM: 1200,
    description: "Sjön Näsnaren, söder om Katrineholms tätort.",
  },
];

export type PositiveZoneType = "riksintresse" | "planering";

export interface PositiveZone {
  id: string;
  name: string;
  type: PositiveZoneType;
  lat: number;
  lon: number;
  radiusM: number;
  description: string;
}

/**
 * Zoner som SÄNKER konsekvenspoängen om ett verk placeras inom dem — de är
 * redan pekade ut som lämpliga för vindkraft (riksintresse) eller ingår i
 * kommunens egen planering, vilket gör en placering där mer förutsägbar.
 */
export const POSITIVE_ZONES: PositiveZone[] = [
  {
    id: "riksintresse-vindbruk",
    name: "Riksintresse vindbruk (uppskattat)",
    type: "riksintresse",
    lat: 58.895,
    lon: 16.045,
    radiusM: 900,
    description: "Uppskattat område av riksintresse för vindbruk enligt Energimyndigheten.",
  },
  {
    id: "kommunal-vindbruksplan",
    name: "Utpekat i kommunens vindbruksplan (uppskattat)",
    type: "planering",
    lat: 58.878,
    lon: 16.07,
    radiusM: 1000,
    description: "Uppskattat område som kommunen pekat ut som lämpligt för vindkraft.",
  },
];

/** Avstånd (meter) mellan en punkt och en zons mittpunkt, minus zonens radie (negativt = innanför). */
export function distanceToZoneEdgeM(point: LatLon, zone: { lat: number; lon: number; radiusM: number }): number {
  return distanceMeters(point.lat, point.lon, zone.lat, zone.lon) - zone.radiusM;
}

export const ERICSBERG_AREA_DISCLAIMER =
  "Markgränsen, bebyggelsen och de skyddade/utpekade områdena på kartan är ungefärliga illustrationer baserade på tillgängligt kartunderlag — inte exakta fastighets- eller myndighetsgränser.";
