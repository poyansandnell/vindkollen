import { useEffect, useRef, useState } from "react";

export interface WindDirectionState {
  /** Grader (0-360) vinden blåser FRÅN, meteorologisk konvention, eller null om okänt/ej hämtat än. */
  windFromDeg: number | null;
  /** Vindhastighet (m/s), rent informativt. */
  windSpeedMs: number | null;
  loading: boolean;
}

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Hämtar aktuell vindriktning för användarens position från Open-Meteo
 * (fri väder-API, kräver ingen nyckel). Rent tillägg till infraljud-
 * monitorn — om nätverket är otillgängligt eller anropet misslyckas
 * behålls `windFromDeg: null` och monitorn faller tillbaka till att
 * ignorera vindriktningsfaktorn helt (se `noiseImpact.ts`), aldrig krasch.
 */
export function useWindDirection(lat: number | null, lon: number | null): WindDirectionState {
  const [windFromDeg, setWindFromDeg] = useState<number | null>(null);
  const [windSpeedMs, setWindSpeedMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const lastFetchKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (lat === null || lon === null) return;

    // Avrunda till ~1km för att inte trigga om ett nytt anrop för varje
    // enskild GPS-uppdatering — vindriktningen ändras inte meningsfullt
    // över så korta avstånd.
    const roundedLat = lat.toFixed(2);
    const roundedLon = lon.toFixed(2);
    const key = `${roundedLat},${roundedLon}`;
    if (lastFetchKeyRef.current === key) return;
    lastFetchKeyRef.current = key;

    let cancelled = false;
    const controller = new AbortController();

    async function fetchWind() {
      setLoading(true);
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${roundedLat}&longitude=${roundedLon}&current=wind_direction_10m,wind_speed_10m&timezone=auto`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const dir = data?.current?.wind_direction_10m;
        const speed = data?.current?.wind_speed_10m;
        if (cancelled) return;
        setWindFromDeg(typeof dir === "number" ? dir : null);
        setWindSpeedMs(typeof speed === "number" ? speed : null);
      } catch {
        // Tyst fallback — vindriktning är en "om sådan data finns"-faktor,
        // inte ett krav. Behåller senast kända värde istället för att
        // nollställa till null vid ett enstaka nätverksfel.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchWind();
    const interval = window.setInterval(() => {
      lastFetchKeyRef.current = null;
      void fetchWind();
    }, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [lat, lon]);

  return { windFromDeg, windSpeedMs, loading };
}
