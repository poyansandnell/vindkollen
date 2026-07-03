import { useRef } from "react";

/**
 * Tidskonstant (sekunder) för den exponentiella utjämningen av lat/lon.
 * Samma mönster som `useDeviceOrientation.ts`s gir-utjämning (0.15s), men
 * längre eftersom rått GPS-brus normalt är mycket grövre (flera meter) än
 * kompassbrus (bråkdelar av en grad) — en för kort tidskonstant skulle
 * fortfarande släppa igenom synligt "fladder" i verkens skärmposition.
 * Kort nog för att fortfarande kännas responsiv när man faktiskt går.
 */
const POSITION_TAU_SEC = 1.2;

/** Tidsbaserad exponentiell utjämningsfaktor (oberoende av GPS-avläsningsfrekvens). */
function timeSmoothingFactor(tau: number, dt: number): number {
  if (dt <= 0) return 0;
  return 1 - Math.exp(-dt / tau);
}

/**
 * Låg-passfiltrerar rå `lat`/`lon` från `useGeolocation` med ett tidsbaserat
 * exponentiellt glidande medelvärde (EMA), på samma sätt som
 * `useDeviceOrientation.ts` utjämnar gir/pitch/roll.
 *
 * Till skillnad från `useStableGeoPosition` (som helt fryser positionen tills
 * användaren flyttat sig >15m — bra för att undvika onödig omräkning av
 * dBA-uppskattningen, men skulle göra AR-verkens placering hackig/"teleporterande"
 * i stora hopp) ger den här hooken en *kontinuerlig* men utjämnad position:
 * den svarar mjukt och successivt på verklig rörelse (går i ~1-2 sekunder),
 * men dämpar bort det höga, meterskaliga GPS-bruset i vanliga
 * konsument-GPS-avläsningar som annars fick verken att "fladdra"/hoppa i
 * AR-vyn även när användaren stod still.
 *
 * Ren ref-baserad state (ingen egen re-render) — konsumenter läser samma
 * `{ lat, lon }`-par varje render tills nästa `useGeolocation`-uppdatering.
 */
export function useSmoothedGeoPosition(lat: number | null, lon: number | null): { lat: number | null; lon: number | null } {
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

  const now = performance.now();
  const dt = lastTimeRef.current === null ? 1 : Math.min((now - lastTimeRef.current) / 1000, 5);
  lastTimeRef.current = now;

  const factor = timeSmoothingFactor(POSITION_TAU_SEC, dt);
  smoothedRef.current = {
    lat: smoothedRef.current.lat + (lat - smoothedRef.current.lat) * factor,
    lon: smoothedRef.current.lon + (lon - smoothedRef.current.lon) * factor,
  };
  return smoothedRef.current;
}
