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

export interface LatLon {
  lat: number;
  lon: number;
}

/** Katrineholms centrum — samma referenspunkt som i `MapView.tsx`. */
export const KATRINEHOLM_CENTER: LatLon = { lat: 58.9959, lon: 16.2072 };

/** Ungefärligt mittpunkt för Ericsbergs marker, sydväst om Katrineholm. */
export const ERICSBERG_CENTER: LatLon = { lat: 58.883, lon: 16.058 };

/**
 * Ungefärlig markgräns (polygon, WGS84) för det område inom Ericsbergs
 * marker där verken kan placeras. Handritad utifrån de bifogade
 * referensbilderna — INTE en exakt fastighetsgräns.
 */
export const ERICSBERG_BOUNDARY: LatLon[] = [
  { lat: 58.897, lon: 16.03 },
  { lat: 58.9, lon: 16.065 },
  { lat: 58.893, lon: 16.095 },
  { lat: 58.878, lon: 16.098 },
  { lat: 58.868, lon: 16.078 },
  { lat: 58.867, lon: 16.045 },
  { lat: 58.874, lon: 16.022 },
  { lat: 58.888, lon: 16.018 },
];

/**
 * "Ericsbergs mark" — en betydligt STÖRRE, illustrativ markering av
 * Ericsbergs samlade godsmark (inte bara placeringsområdet ovan), grovt
 * dragen så den sträcker sig mellan de omgivande orterna/platserna Forssjö,
 * Stora Malm, Ericsberg, Djulöfors och Strångsjö/Norrlunda, per användarens
 * referensbild. Precis som `ERICSBERG_BOUNDARY` är detta EN GROV
 * UPPSKATTNING — se `ERICSBERG_AREA_DISCLAIMER` — inte en exakt
 * fastighets- eller lantmäterigräns. Visas som ett separat, valbart lager
 * ("Visa Ericsbergs mark") skilt från placeringsområdet.
 */
export const ERICSBERG_ESTATE_AREA: LatLon[] = [
  { lat: 58.936, lon: 16.02 },
  { lat: 58.932, lon: 16.11 },
  { lat: 58.915, lon: 16.155 },
  { lat: 58.88, lon: 16.16 },
  { lat: 58.845, lon: 16.14 },
  { lat: 58.815, lon: 16.1 },
  { lat: 58.802, lon: 16.03 },
  { lat: 58.815, lon: 15.96 },
  { lat: 58.85, lon: 15.94 },
  { lat: 58.89, lon: 15.95 },
  { lat: 58.92, lon: 15.975 },
];

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
 * Illustrativa bebyggelsekluster kring Ericsberg. Namnen är grundade i
 * verkliga orter/platser i trakten (Björkvik, Marmorbruket) men
 * hushållsantalen är uppskattningar för spelets/simuleringens skull.
 */
export const HOUSEHOLD_CLUSTERS: HouseholdCluster[] = [
  { id: "ericsberg-gard", name: "Ericsbergs gård & skola", lat: 58.883, lon: 16.058, households: 25 },
  { id: "bjorkvik", name: "Björkvik", lat: 58.869, lon: 16.145, households: 220 },
  { id: "marmorbruket", name: "Marmorbruket", lat: 58.86, lon: 16.01, households: 15 },
  { id: "forssjo", name: "Forssjö", lat: 58.93, lon: 16.145, households: 90 },
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

/** Zoner som ökar konsekvenspoängen om ett verk placeras inom dem. */
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
