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

  // VIKTIGT: intervallet startas ALLTID vid mount, oavsett om det just då
  // finns några samples eller ej. Tidigare fanns ett "optimerings"-villkor
  // här (`if (!Number.isFinite(...) && samples.length === 0) return;`) som
  // skulle hoppa över att starta intervallet om det inte fanns någon data
  // ÄN — men eftersom denna effekt bara körs EN gång (tom dependency-array)
  // och GPS-fixet nästan alltid saknas vid själva mount-ögonblicket, var
  // villkoret i praktiken NÄSTAN ALLTID sant vid första körningen. Det
  // gjorde att intervallet aldrig startade — inte ens efter att GPS-fixet
  // senare kom in och riktiga samples började samlas i `samplesRef` via
  // effekten ovan. Resultatet: `smoothed` fastnade permanent på sitt
  // initiala värde (-Infinity), och "🔊 Ljudnivå"-panelen visade "Väntar på
  // GPS-position…" för alltid — även när GPS/kamera/kompass i övrigt
  // fungerade helt korrekt (skiljer sig alltså från själva GPS-hämtningen).
  useEffect(() => {
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
