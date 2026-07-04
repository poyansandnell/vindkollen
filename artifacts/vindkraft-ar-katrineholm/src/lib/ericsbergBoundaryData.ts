// Separat, lättredigerad geodatafil för "Placera vindkraftverken själv".
//
// Formatet är medvetet GeoJSON-likt (ett enkelt [lon, lat]-koordinatpar per
// hörn, samma ordning som riktig GeoJSON `Polygon`-geometri) men utan någon
// GeoJSON-bibliotekskod — det gör filen trivial att uppdatera direkt (t.ex.
// om nya referensbilder/PDF:er med en mer exakt markgräns dyker upp) utan
// att behöva förstå resten av appens kod. `ericsbergArea.ts` konverterar
// koordinaterna till appens interna `{ lat, lon }`-format vid import.
//
// VIKTIGT (se även `ericsbergArea.ts`s jsdoc): det finns ingen exakt digital
// fastighetsgräns eller GIS-data tillgänglig för det här läget — punkterna
// nedan är GROVT UPPSKATTADE illustrationer, inte myndighets- eller
// lantmäteridata.
//
// SÅ REDIGERAR DU: byt ut `coordinates`-listan nedan med nya [lon, lat]-par.
// Ordningen på punkterna spelar roll (de bildar polygonens kant i tur och
// ordning) men första/sista punkten behöver INTE upprepas — polygonen
// sluts automatiskt mellan sista och första punkten.

export interface GeoJsonPolygon {
  type: "Polygon";
  /** [lon, lat]-par, i GeoJSON-ordning (longitud FÖRE latitud). */
  coordinates: [number, number][];
}

/**
 * Placeringsområdet — den mindre gräns inom vilken verk faktiskt kan
 * placeras (utanför den visas en varning i UI:t, se `placementScoring.ts`).
 */
export const ERICSBERG_PLACEMENT_BOUNDARY: GeoJsonPolygon = {
  type: "Polygon",
  coordinates: [
    [16.03, 58.897],
    [16.065, 58.9],
    [16.095, 58.893],
    [16.098, 58.878],
    [16.078, 58.868],
    [16.045, 58.867],
    [16.022, 58.874],
    [16.018, 58.888],
  ],
};

/**
 * "Ericsbergs mark" — betydligt större, illustrativt lager som sträcker sig
 * mellan de omgivande orterna/platserna Katrineholm (nordöst), Forssjö,
 * Stora Malm, Ericsberg och Strångsjö/Norrlunda (sydväst), enligt
 * referensbilden. Utökad norrut mot Katrineholms södra utkant jämfört med
 * en tidigare version som stannade strax söder om centrum.
 */
export const ERICSBERG_ESTATE_AREA_BOUNDARY: GeoJsonPolygon = {
  type: "Polygon",
  coordinates: [
    [16.145, 58.955],
    [16.19, 58.94],
    [16.2, 58.915],
    [16.19, 58.885],
    [16.16, 58.865],
    [16.15, 58.835],
    [16.11, 58.81],
    [16.05, 58.795],
    [15.97, 58.8],
    [15.93, 58.825],
    [15.915, 58.865],
    [15.93, 58.905],
    [15.97, 58.93],
    [16.02, 58.945],
    [16.08, 58.955],
  ],
};

export function geoJsonPolygonToLatLon(polygon: GeoJsonPolygon): { lat: number; lon: number }[] {
  return polygon.coordinates.map(([lon, lat]) => ({ lat, lon }));
}
