import { useEffect, useRef, useState } from "react";

/**
 * Sammanfattat "hur pålitlig är AR-placeringen just nu"-läge. Kombinerar
 * GPS-precision och kompass-/riktningsstabilitet (de två signaler som
 * faktiskt driver AR-verkens VÄRLDSPOSITION/kameravinkel — till skillnad
 * från "Outdoor Confidence Index" i `useOutdoorConfidenceIndex.ts`, som
 * väger in kamera/ljus/wifi också men styr SYNLIGHET/tonläge, inte
 * placeringens stabilitet):
 *
 * - "initializing": ingen GPS-fix än (innan `ready` normalt är sant).
 * - "good": både GPS och kompass tillräckligt stabila — positionen
 *   uppdateras normalt (mjukt utjämnad, se `useSmoothedGeoPosition`).
 * - "degraded": minst en signal är svag — positionen FRYSES (se `freeze`)
 *   på senaste stabila läge istället för att uppdateras mot en osäker
 *   avläsning, och en text visas för användaren.
 * - "lost": degraderat läge har varat sammanhängande längre än
 *   `LOST_GRACE_MS` — verken börjar tona ut (se `fadeFactor`) istället för
 *   att bara stå kvar i all evighet på en position vi inte längre litar på.
 */
export type ArTrackingTier = "initializing" | "good" | "degraded" | "lost";

export interface ArTrackingDebugInfo {
  gpsAccuracyM: number | null;
  headingStability: number;
  headingAccuracyDeg: number | null;
  gpsQuality: number;
  headingQuality: number;
  combinedQuality: number;
  tier: ArTrackingTier;
  frozenForMs: number;
  reasons: string[];
}

export interface ArTrackingStabilityResult {
  tier: ArTrackingTier;
  /** Sant när placeringen ska frysas — skickas in i `useSmoothedGeoPosition`s `freeze`-parameter. */
  freeze: boolean;
  /** Den exakta produktkravstexten, satt när `tier === "degraded"` eller `"lost"`, annars `null`. */
  weakSignalMessage: string | null;
  /**
   * 0..1 — multipliceras in i `globalVisibilityFactor` (se `Home.tsx`) för
   * att tona ut verken mjukt först efter `LOST_GRACE_MS`, ALDRIG omedelbart
   * (produktkrav 4). 1 så länge tracking är "good"/"degraded" (degraderat
   * läge fryser fortfarande positionen, men verken syns kvar — bara om
   * frysningen varar ovanligt länge tonas de bort).
   */
  fadeFactor: number;
  /**
   * 0..100, live-uppdaterad varje `REEVALUATE_INTERVAL_MS` (oavsett tier) —
   * `headingStabilityRef` omvandlad till samma 0..1-kvalitetsskala som
   * `combinedQuality` använder, avrundad till en procentsats. Driver
   * "Kompass: X% stabil"-indikatorn i `Home.tsx` (produktkrav 2). Separat
   * state (inte bara härledd i render) eftersom `headingStabilityRef` är en
   * ren ref — utan detta skulle indikatorn bara uppdateras när något ANNAT
   * råkar trigga en re-render, inte kontinuerligt/"live" som kravet är.
   */
  compassQualityPercent: number;
  debug: ArTrackingDebugInfo;
}

export const WEAK_SIGNAL_MESSAGE = "Svag positionering – använder senaste stabila läge";

// GPS-precision (meter): <= GOOD ger full kvalitet (1), >= FREEZE ger 0
// (fryser positionen). Betydligt strängare än `useOutdoorConfidenceIndex`s
// gräns (50m) eftersom den här signalen direkt styr var verken RITAS,
// inte bara hur mycket de tonas — en dålig fix ska inte få flytta ett
// verk flera hundra meter i bild.
const GPS_GOOD_ACCURACY_M = 20;
const GPS_FREEZE_ACCURACY_M = 45;

// Kompass-stabilitet (0..1, från `useDeviceOrientation`s `headingStabilityRef`):
// >= GOOD ger full kvalitet, <= FREEZE fryser.
const HEADING_GOOD_STABILITY = 0.55;
const HEADING_FREEZE_STABILITY = 0.2;

// Under vilken sammanlagd kvalitet (svagaste av GPS/kompass, se `combinedQuality`)
// tracking anses "good" respektive helt frusen ("degraded"/"lost").
const QUALITY_GOOD_THRESHOLD = 0.55;

// Hur länge (ms) ett sammanhängande "degraded"-läge tillåts pågå innan
// verken börjar tona ut — ger gott om tid för en kort GPS-/kompass-blip
// att lösa sig av sig själv utan att användaren ens hinner se dem försvinna
// (produktkrav 4: "ligg kvar i några sekunder").
const LOST_GRACE_MS = 4000;
// Hur lång tid (ms) uttoningen tar EFTER graceperioden, om läget
// fortfarande är dåligt — en mjuk gradient, inte ett tvärt hopp till osynlig.
const FADE_DURATION_MS = 3000;
// Golvet uttoningen stannar på — aldrig helt 0, så ett verk som "kommer
// tillbaka" inte behöver blinka upp från total osynlighet, och en
// debug-testare fortfarande ser en svag kontur att resonera kring.
const FADE_FLOOR = 0.08;

// Hur ofta (ms) läget omvärderas — kompass-stabiliteten muteras i en ref
// (ingen egen re-render), så vi måste polla den regelbundet snarare än att
// bara reagera på GPS-statets ändringar.
const REEVALUATE_INTERVAL_MS = 250;

function gpsAccuracyToQuality(accuracy: number | null): number {
  if (accuracy === null) return 0;
  if (accuracy <= GPS_GOOD_ACCURACY_M) return 1;
  if (accuracy >= GPS_FREEZE_ACCURACY_M) return 0;
  return 1 - (accuracy - GPS_GOOD_ACCURACY_M) / (GPS_FREEZE_ACCURACY_M - GPS_GOOD_ACCURACY_M);
}

function headingStabilityToQuality(stability: number): number {
  if (stability >= HEADING_GOOD_STABILITY) return 1;
  if (stability <= HEADING_FREEZE_STABILITY) return 0;
  return (stability - HEADING_FREEZE_STABILITY) / (HEADING_GOOD_STABILITY - HEADING_FREEZE_STABILITY);
}

/**
 * Kontinuerlig sensorfusion för AR-PLACERINGENS stabilitet (produktkrav 1-4):
 * väger samman GPS-precision och kompass-/riktningsstabilitet till en enda
 * "tracking tier", och driver dels en hård positionsfrysning (`freeze`, se
 * `useSmoothedGeoPosition`), dels en fördröjd, mjuk uttoning (`fadeFactor`)
 * om läget förblir dåligt ovanligt länge — aldrig ett omedelbart hopp eller
 * en plötslig försvinning.
 *
 * Kompletterar (ersätter inte) `useOutdoorConfidenceIndex`, som redan väger
 * samman fler svaga signaler (kamera, ljus, rörelse, wifi) för att styra
 * SYNLIGHET/tonläge — den här haken fokuserar smalt på de två signaler som
 * faktiskt avgör VAR verken hamnar i världen och vart kameran pekar.
 *
 * "Runtime-omkalibrering" (produktkrav 6) hanteras redan uppströms: extrema
 * hopp filtreras bort helt i både `useDeviceOrientation` (orimlig
 * vridningshastighet) och `useSmoothedGeoPosition` (orimlig GPS-hastighet),
 * och användarens manuella "Kalibrera horisont"/"Kalibrera om riktning"
 * fungerar som en stark, omedelbar referenspunkt (nollställer
 * horisontoffseten direkt) snarare än att bara sakta byggas upp av sig
 * själv — ett försök att "lära om" pitch/gir automatiskt utan en absolut
 * extern referens (ingen WebXR/SLAM tillgänglig i en vanlig mobilwebbläsare)
 * skulle bara riskera att smygande introducera FEL drift.
 */
export function useArTrackingStability(params: {
  enabled: boolean;
  gpsAccuracy: number | null;
  headingStabilityRef: React.MutableRefObject<number>;
  headingAccuracyDegRef: React.MutableRefObject<number | null>;
  orientationHasFix: boolean;
}): ArTrackingStabilityResult {
  const { enabled, gpsAccuracy, headingStabilityRef, headingAccuracyDegRef, orientationHasFix } = params;

  const [tier, setTier] = useState<ArTrackingTier>("initializing");
  const [fadeFactor, setFadeFactor] = useState(1);
  const [frozenForMs, setFrozenForMs] = useState(0);
  const [compassQualityPercent, setCompassQualityPercent] = useState(0);
  const degradedSinceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setTier("initializing");
      setFadeFactor(1);
      setFrozenForMs(0);
      setCompassQualityPercent(0);
      degradedSinceRef.current = null;
      return;
    }

    const id = window.setInterval(() => {
      // Uppdateras OVILLKORLIGT varje tick (innan alla tidiga returer nedan)
      // så indikatorn känns "live" — headingStabilityRef muteras kontinuerligt
      // av sensoravläsningar och ändras därför nästan alltid en aning mellan
      // varje 250ms-tick.
      setCompassQualityPercent(Math.round(headingStabilityToQuality(headingStabilityRef.current) * 100));

      if (gpsAccuracy === null || !orientationHasFix) {
        setTier((prev) => (prev === "initializing" ? prev : "initializing"));
        // Ingen fix alls än — inget att frysa/tona (produktkrav 3-4
        // gäller "dålig" data, inte "ingen" data, som redan hanteras av
        // `Home.tsx`s väntar-overlay).
        setTier("initializing");
        setFadeFactor(1);
        setFrozenForMs(0);
        degradedSinceRef.current = null;
        return;
      }

      const gpsQuality = gpsAccuracyToQuality(gpsAccuracy);
      const headingQuality = headingStabilityToQuality(headingStabilityRef.current);
      // Svagaste länken avgör — kravet är uttryckligt "om NÅGON av GPS/
      // kompass/AR-tracking blir dålig", inte ett medelvärde som kan dölja
      // en enskild dålig signal bakom en bra.
      const combinedQuality = Math.min(gpsQuality, headingQuality);

      const now = Date.now();
      const isGood = combinedQuality >= QUALITY_GOOD_THRESHOLD;

      if (isGood) {
        degradedSinceRef.current = null;
        setTier("good");
        setFadeFactor(1);
        setFrozenForMs(0);
        return;
      }

      if (degradedSinceRef.current === null) degradedSinceRef.current = now;
      const degradedForMs = now - degradedSinceRef.current;
      setFrozenForMs(degradedForMs);

      if (degradedForMs < LOST_GRACE_MS) {
        setTier("degraded");
        setFadeFactor(1);
      } else {
        setTier("lost");
        const fadeProgress = Math.min(1, (degradedForMs - LOST_GRACE_MS) / FADE_DURATION_MS);
        setFadeFactor(1 - fadeProgress * (1 - FADE_FLOOR));
      }
    }, REEVALUATE_INTERVAL_MS);

    return () => window.clearInterval(id);
  }, [enabled, gpsAccuracy, orientationHasFix, headingStabilityRef]);

  const gpsQuality = gpsAccuracyToQuality(gpsAccuracy);
  const headingQuality = headingStabilityToQuality(headingStabilityRef.current);
  const reasons: string[] = [];
  if (gpsAccuracy === null) reasons.push("Ingen GPS-fix ännu");
  else if (gpsQuality < 1) reasons.push(`Svag GPS-precision (±${Math.round(gpsAccuracy)} m)`);
  if (!orientationHasFix) reasons.push("Ingen kompassriktning ännu");
  else if (headingQuality < 1) reasons.push("Kompassen/riktningen är instabil just nu");
  if (reasons.length === 0) reasons.push("Inga kända problem");

  const freeze = tier === "degraded" || tier === "lost";

  return {
    tier,
    freeze,
    weakSignalMessage: freeze ? WEAK_SIGNAL_MESSAGE : null,
    fadeFactor,
    compassQualityPercent,
    debug: {
      gpsAccuracyM: gpsAccuracy,
      headingStability: headingStabilityRef.current,
      headingAccuracyDeg: headingAccuracyDegRef.current,
      gpsQuality,
      headingQuality,
      combinedQuality: Math.min(gpsQuality, headingQuality),
      tier,
      frozenForMs,
      reasons,
    },
  };
}
