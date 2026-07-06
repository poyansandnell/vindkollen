import { useRef } from "react";
import { distanceMeters } from "@/lib/geo";

/**
 * Bas-tidskonstant (sekunder) för den exponentiella utjämningen av lat/lon.
 * Samma mönster som `useDeviceOrientation.ts`s gir-utjämning (0.15s), men
 * betydligt längre eftersom rått GPS-brus normalt är mycket grövre (flera
 * meter, ibland tiotals meter) än kompassbrus (bråkdelar av en grad).
 * Den faktiska, effektiva tidskonstanten skalas upp ytterligare när
 * GPS-precisionen (`accuracy`) är dålig — se `effectiveTau`.
 */
// Höjd (juli 2026, produktkrav "stabilisera placeringen") från 2.5 -> 3.2 —
// verken kändes fortfarande vandra/hoppa sidled vid små GPS-brusspikar,
// särskilt kombinerat med den nu striktare gir-utjämningen i
// `useDeviceOrientation.ts`. En något längre bas-tidskonstant prioriterar
// stabilitet framför omedelbar respons på riktiga förflyttningar (som ändå
// sker mycket långsammare än sensorbruset denna konstant dämpar).
const BASE_TAU_SEC = 3.2;

/**
 * Om GPS-precisionen är sämre än det här (meter) körs utjämningen med en
 * proportionellt längre tidskonstant — en dålig fix (typiskt vid
 * flervägsreflektioner nära byggnader) ska inte få lov att svänga
 * verkens position lika snabbt som en bra fix.
 */
const REFERENCE_ACCURACY_M = 8;
// Sänkt (juli 2026, produktfeedback "tar ca 60 sekunder att få rätt position
// inomhus") från 5 -> 2.5: vid dålig inomhus-GPS (t.ex. ±40-80m) gav 5x
// multiplikatorn en effektiv tau på upp till 16s, vilket för ett
// EMA-filter innebär ~3*tau ≈ 48-60s innan positionen ens hunnit konvergera
// till 95% av sitt slutgiltiga värde — precis den upplevda väntetiden som
// rapporterades. Verken sitter flera km bort (se `turbines.ts`), så en
// kvarstående GPS-osäkerhet på tiotals meter ger bara någon enstaka grads
// bäringsfel för de flesta verk — risken för synligt "hopp" vid en snabbare
// konvergens är alltså liten jämfört med den tidigare orimligt långa väntan.
// 2.5x halverar värsta-fallets tau (~8s, ~24s till 95%) utan att ge upp
// spik-dämpningen för korta GPS-brusstötar.
const MAX_TAU_MULTIPLIER = 2.5;

/**
 * En enskild råavläsning som avviker mer än så här många meter från den
 * senast utjämnade positionen, och som skulle motsvara en orimlig hastighet
 * (se `MAX_PLAUSIBLE_SPEED_MPS`), klassas som en GPS-"spik"
 * (flervägsreflektion/hopp) och ignoreras helt istället för att smygas in
 * via EMA-filtret — annars skulle en enda kraftig spik fortfarande synas
 * som ett tydligt hack i verkens position innan filtret hinner dämpa den.
 */
const MAX_PLAUSIBLE_SPEED_MPS = 4; // ~14 km/h, generöst för gång/lätt jogg

/** Tidsbaserad exponentiell utjämningsfaktor (oberoende av GPS-avläsningsfrekvens). */
function timeSmoothingFactor(tau: number, dt: number): number {
  if (dt <= 0) return 0;
  return 1 - Math.exp(-dt / tau);
}

function effectiveTau(accuracy: number | null): number {
  if (accuracy === null || accuracy <= REFERENCE_ACCURACY_M) return BASE_TAU_SEC;
  const multiplier = Math.min(accuracy / REFERENCE_ACCURACY_M, MAX_TAU_MULTIPLIER);
  return BASE_TAU_SEC * multiplier;
}

/**
 * Låg-passfiltrerar rå `lat`/`lon` från `useGeolocation` med ett tidsbaserat
 * exponentiellt glidande medelvärde (EMA), på samma sätt som
 * `useDeviceOrientation.ts` utjämnar gir/pitch/roll — men med tre extra lager
 * anpassade för GPS specifikt:
 *
 * 1. Tidskonstanten skalas upp när `accuracy` är dålig (se `effectiveTau`),
 *    så en osäker fix inte får svänga positionen lika snabbt som en bra.
 * 2. Enstaka orimliga "spik"-avläsningar (skulle motsvara en omöjlig
 *    hastighet, se `MAX_PLAUSIBLE_SPEED_MPS`) ignoreras helt istället för
 *    att smygas in via filtret.
 * 3. Är kontinuerlig (till skillnad från `useStableGeoPosition`s hela
 *    15m-hoppsfrysning) — svarar mjukt och successivt på verklig rörelse
 *    men dämpar bort det meterskaliga GPS-bruset som annars fick verken att
 *    "fladdra"/hoppa i AR-vyn.
 * 4. Ett explicit `freeze`-läge (se `useArTrackingStability`): när
 *    positioneringen som helhet (GPS OCH/ELLER kompass) bedöms opålitlig
 *    fryses den utjämnade positionen HELT — varken nya råvärden eller
 *    tidens gång tillåts påverka den (se `lastTimeRef` nedan) — istället
 *    för att bara låta `accuracy`-skalningen dra ut tidskonstanten. Detta
 *    är den bokstavliga "håll kvar senaste stabila läge"-frysningen i
 *    produktkravet. När frysningen släpper räknas `dt` från tidpunkten
 *    INNAN frysningen (fortfarande takad till 5s), så korrigeringen mot den
 *    nya positionen ändå sker mjukt över ~1-3s snarare än att hoppa direkt
 *    — samma EMA som redan användes för vanlig GPS-brusdämpning.
 *
 * Ren ref-baserad state (ingen egen re-render).
 */
export function useSmoothedGeoPosition(
  lat: number | null,
  lon: number | null,
  accuracy: number | null = null,
  freeze: boolean = false,
): { lat: number | null; lon: number | null } {
  const smoothedRef = useRef<{ lat: number | null; lon: number | null }>({ lat: null, lon: null });
  const lastTimeRef = useRef<number | null>(null);

  if (lat === null || lon === null) {
    smoothedRef.current = { lat: null, lon: null };
    lastTimeRef.current = null;
    return smoothedRef.current;
  }

  if (smoothedRef.current.lat === null || smoothedRef.current.lon === null) {
    smoothedRef.current = { lat, lon };
    lastTimeRef.current = performance.now();
    return smoothedRef.current;
  }

  // Frusen: returnera senaste utjämnade läget oförändrat, och rör inte
  // `lastTimeRef` — se jsdoc-punkt 4 ovan för varför detta ger en mjuk,
  // inte omedelbar, korrigering när frysningen släpper.
  if (freeze) {
    return smoothedRef.current;
  }

  const now = performance.now();
  const dt = lastTimeRef.current === null ? 1 : Math.min((now - lastTimeRef.current) / 1000, 5);
  lastTimeRef.current = now;

  const jumpM = distanceMeters(smoothedRef.current.lat, smoothedRef.current.lon, lat, lon);
  const maxPlausibleM = MAX_PLAUSIBLE_SPEED_MPS * dt + (accuracy ?? REFERENCE_ACCURACY_M);
  if (jumpM > maxPlausibleM) {
    // Orimligt hopp för den förflutna tiden — troligen en GPS-spik
    // (flervägsreflektion). Ignorera avläsningen helt denna gång; om det
    // faktiskt var en riktig förflyttning fångas den upp av nästa
    // avläsning(ar) istället.
    return smoothedRef.current;
  }

  const factor = timeSmoothingFactor(effectiveTau(accuracy), dt);
  smoothedRef.current = {
    lat: smoothedRef.current.lat + (lat - smoothedRef.current.lat) * factor,
    lon: smoothedRef.current.lon + (lon - smoothedRef.current.lon) * factor,
  };
  return smoothedRef.current;
}
