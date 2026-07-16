/**
 * Statisk projektregistret för Vindkollen.
 *
 * Primär datakälla på native (Capacitor/iOS/Android) där relativa API-URL:er
 * ej fungerar (capacitor://localhost/api/... → DOMException). Används även som
 * omedelbar fallback på webben medan ett API-anrop pågår i bakgrunden.
 *
 * Lägg till nya projekt genom att utöka BUNDLED_PROJECTS-arrayen.
 * id ≥ 10001 reserveras för bundlade poster; API-hämtade poster använder
 * sina egna Vindbrukskollen-ID:n (typiskt < 5000).
 */

/**
 * Minimal projekttyp för Sverigekartan.
 * Kompatibel med API-responsen från /api/wind/project-areas.
 */
export interface ApiProjectArea {
  id: number;
  name: string;
  status: string;
  /** @nullable */
  kommun?: string | null;
  /** @nullable */
  region?: string | null;
  /** @nullable */
  turbineCountPlannedMin?: number | null;
  /** @nullable */
  turbineCountPlannedMax?: number | null;
  centerLat?: number;
  centerLng?: number;
  /**
   * GeoJSON Polygon/MultiPolygon — null i bundlat läge och i API-svar
   * i summary-mode (utan ?detail=full).
   */
  polygon?: { type: string; coordinates: unknown } | null;
  /**
   * Valfri kampanjkonfiguration.
   * Definieras bara i bundlade poster, aldrig i API-svar.
   */
  campaign?: {
    enabled: boolean;
    type: "referendum-interest";
    title: string;
    description: string;
    municipality: string;
  } | null;
}

/**
 * Statisk förteckning över svenska vindkraftsprojekt.
 * Täcker hela landet från Skåne till Lappland.
 *
 * Koordinater och turbinantal baserade på offentlig information från
 * Vindbrukskollen och projektens tillståndsansökningar.
 */
export const BUNDLED_PROJECTS: ApiProjectArea[] = [
  // ── Södermanland ──────────────────────────────────────────────────────
  {
    id: 10001,
    name: "Länsterberget",
    status: "samråd",
    kommun: "Katrineholm",
    region: "Södermanland",
    turbineCountPlannedMin: 29,
    turbineCountPlannedMax: 29,
    centerLat: 58.97,
    centerLng: 16.27,
    polygon: null,
    campaign: {
      enabled: true,
      type: "referendum-interest",
      title: "Folkomröstning om vindkraft 2026",
      description:
        "Skriv under för att kräva en kommunal folkomröstning om vindkraftsetableringen norr om Katrineholm.",
      municipality: "Katrineholm",
    },
  },
  // ── Östergötland ──────────────────────────────────────────────────────
  {
    id: 10002,
    name: "Hultema",
    status: "beviljat",
    kommun: "Mjölby",
    region: "Östergötland",
    turbineCountPlannedMin: 22,
    turbineCountPlannedMax: 22,
    centerLat: 58.32,
    centerLng: 15.18,
    polygon: null,
  },
  // ── Kalmar / Öland ────────────────────────────────────────────────────
  {
    id: 10003,
    name: "Kårehamn",
    status: "driftsatt",
    kommun: "Borgholm",
    region: "Kalmar",
    turbineCountPlannedMin: 16,
    turbineCountPlannedMax: 16,
    centerLat: 57.27,
    centerLng: 17.08,
    polygon: null,
  },
  // ── Jönköping / Kronoberg ─────────────────────────────────────────────
  {
    id: 10004,
    name: "Lemnhult",
    status: "driftsatt",
    kommun: "Vetlanda",
    region: "Jönköping",
    turbineCountPlannedMin: 31,
    turbineCountPlannedMax: 31,
    centerLat: 57.55,
    centerLng: 15.27,
    polygon: null,
  },
  // ── Skåne ─────────────────────────────────────────────────────────────
  {
    id: 10005,
    name: "Fälla vindpark",
    status: "driftsatt",
    kommun: "Hässleholm",
    region: "Skåne",
    turbineCountPlannedMin: 23,
    turbineCountPlannedMax: 23,
    centerLat: 56.15,
    centerLng: 13.97,
    polygon: null,
  },
  {
    id: 10006,
    name: "Lillgrund",
    status: "driftsatt",
    kommun: "Malmö",
    region: "Skåne",
    turbineCountPlannedMin: 48,
    turbineCountPlannedMax: 48,
    centerLat: 55.50,
    centerLng: 12.78,
    polygon: null,
  },
  // ── Blekinge (offshore) ───────────────────────────────────────────────
  {
    id: 10007,
    name: "Blekinge Offshore",
    status: "beviljat",
    kommun: "Sölvesborg",
    region: "Blekinge",
    turbineCountPlannedMin: 700,
    turbineCountPlannedMax: 700,
    centerLat: 55.85,
    centerLng: 15.30,
    polygon: null,
  },
  // ── Halland ───────────────────────────────────────────────────────────
  {
    id: 10008,
    name: "Hjuleberg",
    status: "driftsatt",
    kommun: "Falkenberg",
    region: "Halland",
    turbineCountPlannedMin: 18,
    turbineCountPlannedMax: 18,
    centerLat: 56.78,
    centerLng: 12.73,
    polygon: null,
  },
  // ── Västra Götaland ───────────────────────────────────────────────────
  {
    id: 10009,
    name: "Hällevadsholm",
    status: "driftsatt",
    kommun: "Mellerud",
    region: "Västra Götaland",
    turbineCountPlannedMin: 25,
    turbineCountPlannedMax: 25,
    centerLat: 58.70,
    centerLng: 12.20,
    polygon: null,
  },
  {
    id: 10010,
    name: "Hedared",
    status: "driftsatt",
    kommun: "Borås",
    region: "Västra Götaland",
    turbineCountPlannedMin: 24,
    turbineCountPlannedMax: 24,
    centerLat: 57.75,
    centerLng: 12.75,
    polygon: null,
  },
  // ── Värmland ──────────────────────────────────────────────────────────
  {
    id: 10011,
    name: "Bäckhammar",
    status: "driftsatt",
    kommun: "Kristinehamn",
    region: "Värmland",
    turbineCountPlannedMin: 8,
    turbineCountPlannedMax: 8,
    centerLat: 59.40,
    centerLng: 14.20,
    polygon: null,
  },
  // ── Gotland ───────────────────────────────────────────────────────────
  {
    id: 10012,
    name: "Näsudden vindpark",
    status: "driftsatt",
    kommun: "Gotland",
    region: "Gotland",
    turbineCountPlannedMin: 45,
    turbineCountPlannedMax: 45,
    centerLat: 57.08,
    centerLng: 18.17,
    polygon: null,
  },
  // ── Gävleborg ─────────────────────────────────────────────────────────
  {
    id: 10013,
    name: "Jädraås",
    status: "driftsatt",
    kommun: "Ockelbo",
    region: "Gävleborg",
    turbineCountPlannedMin: 66,
    turbineCountPlannedMax: 66,
    centerLat: 60.83,
    centerLng: 16.15,
    polygon: null,
  },
  {
    id: 10014,
    name: "Storgrundet",
    status: "beviljat",
    kommun: "Söderhamn",
    region: "Gävleborg",
    turbineCountPlannedMin: 30,
    turbineCountPlannedMax: 30,
    centerLat: 61.13,
    centerLng: 17.49,
    polygon: null,
  },
  {
    id: 10015,
    name: "Svartkläppen",
    status: "aktuellt",
    kommun: "Ljusdal",
    region: "Gävleborg",
    turbineCountPlannedMin: 32,
    turbineCountPlannedMax: 40,
    centerLat: 61.80,
    centerLng: 15.50,
    polygon: null,
  },
  // ── Västernorrland ────────────────────────────────────────────────────
  {
    id: 10016,
    name: "Salsjön",
    status: "driftsatt",
    kommun: "Sundsvall",
    region: "Västernorrland",
    turbineCountPlannedMin: 22,
    turbineCountPlannedMax: 22,
    centerLat: 62.55,
    centerLng: 16.82,
    polygon: null,
  },
  // ── Jämtland / Härjedalen ─────────────────────────────────────────────
  {
    id: 10017,
    name: "Bergebo",
    status: "beviljat",
    kommun: "Härjedalen",
    region: "Jämtland",
    turbineCountPlannedMin: 97,
    turbineCountPlannedMax: 97,
    centerLat: 62.30,
    centerLng: 13.85,
    polygon: null,
  },
  // ── Västerbotten ──────────────────────────────────────────────────────
  {
    id: 10018,
    name: "Blakliden-Fäbodberget",
    status: "driftsatt",
    kommun: "Åsele",
    region: "Västerbotten",
    turbineCountPlannedMin: 84,
    turbineCountPlannedMax: 84,
    centerLat: 64.85,
    centerLng: 17.20,
    polygon: null,
  },
  // ── Norrbotten ────────────────────────────────────────────────────────
  {
    id: 10019,
    name: "Markbygden ETT",
    status: "driftsatt",
    kommun: "Piteå",
    region: "Norrbotten",
    turbineCountPlannedMin: 179,
    turbineCountPlannedMax: 179,
    centerLat: 65.35,
    centerLng: 21.20,
    polygon: null,
  },
  {
    id: 10020,
    name: "Uljabuouda",
    status: "beviljat",
    kommun: "Arjeplog",
    region: "Norrbotten",
    turbineCountPlannedMin: 72,
    turbineCountPlannedMax: 72,
    centerLat: 66.30,
    centerLng: 17.70,
    polygon: null,
  },
];

/**
 * Katrineholms-projektet (Länsterberget) med fullständig kampanjkonfiguration.
 * Används i Home.tsx för att avgöra om petitions-CTA:n ska visas.
 */
export const KATRINEHOLM_PROJECT = BUNDLED_PROJECTS.find((p) => p.id === 10001)!;
