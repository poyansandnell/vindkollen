import { useRef } from "react";
import { distanceMeters } from "@/lib/geo";

// Ignorerar GPS-brus/-jitter under den här gränsen (meter) — konsumenter
// (dBA-uppskattningen m.fl.) ska inte omberäknas för varje litet, naturligt
// GPS-studs medan användaren i praktiken står still. Enligt produktkravet
// (10-20 m), satt i mitten av intervallet.
const JITTER_THRESHOLD_M = 15;

/**
 * Returnerar en "stabiliserad" GPS-position som bara uppdateras när
 * användaren faktiskt flyttat sig mer än `JITTER_THRESHOLD_M` från den
 * senast accepterade positionen — små studs i råa `lat`/`lon` (typiskt GPS-
 * brus, inte verklig rörelse) ignoreras helt istället för att förplantas
 * vidare till t.ex. dBA-uppskattningen. Stabil funktion (ingen re-render av
 * sig själv), håller sitt eget state i en ref och returnerar samma
 * lat/lon-par tills ett riktigt hopp inträffar.
 */
export function useStableGeoPosition(lat: number | null, lon: number | null): { lat: number | null; lon: number | null } {
  const stableRef = useRef<{ lat: number | null; lon: number | null }>({ lat: null, lon: null });

  if (lat === null || lon === null) {
    stableRef.current = { lat: null, lon: null };
    return stableRef.current;
  }

  if (stableRef.current.lat === null || stableRef.current.lon === null) {
    stableRef.current = { lat, lon };
    return stableRef.current;
  }

  const movedM = distanceMeters(stableRef.current.lat, stableRef.current.lon, lat, lon);
  if (movedM >= JITTER_THRESHOLD_M) {
    stableRef.current = { lat, lon };
  }
  return stableRef.current;
}
