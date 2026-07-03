import { useEffect, useRef, useState } from "react";

// Glidande medelvärde över de senaste 5-10 sekunderna (mitten av intervallet)
// enligt produktkravet — jämnar ut korta, hastiga svängningar i den råa
// dBA-uppskattningen (t.ex. GPS-brus som slinker igenom
// `useStableGeoPosition`s tröskel, eller tillfälliga omräkningar) utan att
// släpa efter en verklig, varaktig förflyttning i mer än ett par sekunder.
const WINDOW_MS = 7000;
// Panelen/vinljudet får bara byta visat värde högst en gång per sekund enligt
// produktkravet — även om det underliggande glidande medelvärdet i praktiken
// ändras kontinuerligt (varje ny render), synkas det synliga talet bara mot
// detta intervall.
const UPDATE_INTERVAL_MS = 1000;

/**
 * Jämnar ut en snabbt föränderlig rå dBA-nivå (t.ex.
 * `soundLevelEstimate.totalDba`) till ett glidande medelvärde över de
 * senaste `WINDOW_MS` millisekunderna, och begränsar hur ofta det synliga
 * värdet faktiskt uppdateras till högst en gång per sekund — enligt
 * produktkravet ska varken ljudnivåpanelen eller vindljudets volym hoppa
 * ryckigt mellan varje enskild GPS-/renderuppdatering.
 *
 * `-Infinity`/`NaN`-indata (inget GPS-fix ännu) hoppar över utjämningen och
 * returneras direkt — det finns inget meningsfullt medelvärde att räkna ut
 * innan en första riktig nivå finns.
 */
export function useSmoothedDba(rawTotalDba: number): number {
  const [smoothed, setSmoothed] = useState(rawTotalDba);
  const samplesRef = useRef<{ value: number; time: number }[]>([]);
  const lastUpdateRef = useRef(0);
  const latestRawRef = useRef(rawTotalDba);
  latestRawRef.current = rawTotalDba;

  useEffect(() => {
    if (!Number.isFinite(rawTotalDba)) {
      samplesRef.current = [];
      lastUpdateRef.current = 0;
      setSmoothed(rawTotalDba);
      return;
    }
    const now = Date.now();
    samplesRef.current.push({ value: rawTotalDba, time: now });
    samplesRef.current = samplesRef.current.filter((s) => now - s.time <= WINDOW_MS);
  }, [rawTotalDba]);

  useEffect(() => {
    if (!Number.isFinite(latestRawRef.current) && samplesRef.current.length === 0) return;
    const interval = window.setInterval(() => {
      const now = Date.now();
      if (now - lastUpdateRef.current < UPDATE_INTERVAL_MS) return;
      const samples = samplesRef.current.filter((s) => now - s.time <= WINDOW_MS);
      if (samples.length === 0) return;
      const avg = samples.reduce((sum, s) => sum + s.value, 0) / samples.length;
      lastUpdateRef.current = now;
      setSmoothed(avg);
    }, 250);
    return () => window.clearInterval(interval);
  }, []);

  return Number.isFinite(rawTotalDba) ? smoothed : rawTotalDba;
}
