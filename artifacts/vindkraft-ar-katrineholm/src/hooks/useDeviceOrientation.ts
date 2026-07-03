import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { computeDeviceQuaternion } from "@/lib/deviceOrientationMath";

interface DeviceOrientationEventiOS {
  requestPermission?: () => Promise<"granted" | "denied">;
}

export interface DeviceOrientationApi {
  supported: boolean;
  needsPermission: boolean;
  hasFix: boolean;
  /**
   * Sant först en liten stund efter `hasFix` — antingen när girriktningen
   * varit stabil (se `headingStabilityRef`) en sammanhängande stund, eller
   * efter en maxväntetid, beroende på vilket som inträffar först. Används
   * för att inte visa vindkraftverk förrän kompassen hunnit "räta in sig"
   * efter start, istället för att direkt lita på en enda första avläsning
   * som (särskilt vid magnetiska störningar inomhus) kan vara kraftigt fel.
   */
  hasSettled: boolean;
  error: string | null;
  requestPermission: () => Promise<boolean>;
  calibrateHorizon: () => void;
  /** Muteras varje sensoravläsning — kamerans quaternion kan kopieras direkt från denna ref utan re-render. */
  quaternionRef: React.MutableRefObject<THREE.Quaternion>;
  /**
   * 0..1 mått på hur stabil kompassriktningen (gir) varit över de senaste
   * dryga sekunden — 1 = i princip stillastående, 0 = kraftigt/oregelbundet
   * svängande. Används som en av flera svaga signaler i "Outdoor Confidence
   * Index" (en skakig/svängande kompass tyder ofta på att telefonen just nu
   * rörs runt snarare än hålls stadigt riktad mot himlen).
   */
  headingStabilityRef: React.MutableRefObject<number>;
}

// Dödzon: sensorbrus på bråkdelar av en grad ska inte alls påverka
// den utjämnade riktningen — annars "skimrar" objekten även när telefonen
// ligger helt stilla på ett bord.
const DEADZONE_DEG = 0.06;

// Adaptiv utjämning av gir (kompassriktning): magnetometerbrus (särskilt
// inomhus/nära metall) ger ofta enstaka-graders hopp mellan avläsningar
// ÄVEN när telefonen ligger helt stilla — betydligt mer än den tidigare
// fasta tidskonstanten (0.15s) kunde dämpa bort, vilket gjorde att
// vindkraftverken syntes "vandra" trots att telefonen inte rörde sig.
// Lösningen är en tvåhastighets-/adaptiv utjämning (samma princip som ett
// "one euro"-filter): en liten skillnad mellan på varandra följande råa
// avläsningar tolkas som brus och dämpas kraftigt (lång tidskonstant), en
// stor skillnad tolkas som en avsiktlig vridning och släpps igenom snabbt
// (kort tidskonstant) så att AR-vyn ändå känns responsiv när man faktiskt
// vrider på telefonen.
const HEADING_NOISE_DELTA_DEG = 3;
const HEADING_TURN_DELTA_DEG = 12;
const HEADING_STILL_TAU = 0.9;
const HEADING_TURN_TAU = 0.12;
// Om en enskild avläsning antyder en orimligt snabb vridning (fler grader/
// sekund än en människa rimligen kan vrida en telefon) beror det nästan
// alltid på en tillfällig magnetisk störning/sensorglitch, inte en verklig
// rörelse — då hoppar vi över just den avläsningen istället för att låta
// den slå igenom i den utjämnade riktningen.
const MAX_PLAUSIBLE_TURN_RATE_DEG_PER_SEC = 720;
// Hur stabil (se `headingStabilityRef`) girriktningen måste vara, och hur
// länge sammanhängande, innan kompassen anses ha "rätat in sig" (`hasSettled`).
const SETTLE_STABILITY_THRESHOLD = 0.75;
const SETTLE_STABLE_DURATION_MS = 1200;
// Maxväntetid innan vi ändå släpper igenom — annars skulle en telefon i en
// magnetiskt orolig miljö (t.ex. nära en byggnad med mycket armering)
// aldrig komma förbi väntningen.
const SETTLE_MAX_WAIT_MS = 5000;

function circularDiffDeg(a: number, b: number): number {
  let diff = a - b;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return diff;
}

/** Tidsbaserad exponentiell utjämningsfaktor (oberoende av sensorns frekvens). */
function timeSmoothingFactor(tau: number, dt: number): number {
  if (dt <= 0) return 0;
  return 1 - Math.exp(-dt / tau);
}

function smoothCircular(prevRef: React.MutableRefObject<number | null>, raw: number, factor: number): number {
  if (prevRef.current === null) {
    prevRef.current = raw;
    return prevRef.current;
  }
  let diff = raw - prevRef.current;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  if (Math.abs(diff) < DEADZONE_DEG) return prevRef.current;
  prevRef.current = (prevRef.current + diff * factor + 360) % 360;
  return prevRef.current;
}

function smoothLinear(prevRef: React.MutableRefObject<number | null>, raw: number, factor: number): number {
  if (prevRef.current === null) {
    prevRef.current = raw;
    return prevRef.current;
  }
  const diff = raw - prevRef.current;
  if (Math.abs(diff) < DEADZONE_DEG) return prevRef.current;
  prevRef.current = prevRef.current + diff * factor;
  return prevRef.current;
}

/**
 * Läser enhetens fullständiga orientering (gir/alpha, pitch/beta, roll/gamma)
 * och räknar fram en THREE.Quaternion som matchar telefonens fysiska riktning
 * i rummet — samma transformation som three.js DeviceOrientationControls
 * använder. Detta gör att kameran roterar korrekt (inklusive tilt uppåt/nedåt
 * och sidlutning) så att AR-objekt upplevs som fast förankrade i verkligheten/
 * horisonten, istället för att bara följa gir (kompassriktning) som tidigare.
 *
 * En kalibreringsfunktion låter användaren låsa "rak horisont" genom att hålla
 * telefonen plant mot horisonten och trycka på en knapp, vilket kompenserar
 * för sensordrift i pitch (beta) mellan olika enheter.
 */
export function useDeviceOrientation(enabled: boolean): DeviceOrientationApi {
  const [supported] = useState(() => typeof window !== "undefined" && "DeviceOrientationEvent" in window);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [hasFix, setHasFix] = useState(false);
  const [hasSettled, setHasSettled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const headingRef = useRef<number | null>(null);
  const betaRef = useRef<number | null>(null);
  const gammaRef = useRef<number | null>(null);
  const betaOffsetRef = useRef(0);
  const screenAngleRef = useRef(0);
  const quaternionRef = useRef(new THREE.Quaternion());
  const hasFixRef = useRef(false);
  const hasFixAtRef = useRef<number | null>(null);
  const hasSettledRef = useRef(false);
  const stableSinceRef = useRef<number | null>(null);
  const lastEventTimeRef = useRef<number | null>(null);
  const headingStabilityRef = useRef(1);
  // Litet rullande fönster av senaste |Δgir|/tidssteg-samples (grader/s) —
  // används bara för att räkna fram `headingStabilityRef`, ingen render.
  const headingDeltaSamplesRef = useRef<number[]>([]);
  // Sant så fort ett riktigt `deviceorientationabsolute`-event tagits emot.
  // Många Android-webbläsare skickar BÅDE `deviceorientationabsolute` OCH
  // vanliga `deviceorientation`-event för samma sensoravläsning — men den
  // senares `alpha` är inte alltid kompass-/norr-refererad (kan drifta från
  // en godtycklig startriktning på vissa webbläsare/enheter). Att mata båda
  // källorna genom samma utjämningsfilter ger två konkurrerande
  // "sanningar" om riktningen, vilket upplevs som att AR-objekten svänger/
  // hoppar kraftigt. Så fort en absolut avläsning finns litar vi bara på
  // den (eller andra event som själva flaggar `absolute: true`) och
  // ignorerar icke-absoluta `deviceorientation`-event helt. iOS Safari
  // saknar `deviceorientationabsolute` helt, så där förblir flaggan false
  // och vanliga `deviceorientation`-event (med `webkitCompassHeading`)
  // fortsätter fungera precis som förut.
  const hasAbsoluteFixRef = useRef(false);

  const updateScreenAngle = useCallback(() => {
    const orientationApi = (screen as unknown as { orientation?: { angle: number } }).orientation;
    const legacyOrientation = (window as unknown as { orientation?: number }).orientation;
    screenAngleRef.current = orientationApi?.angle ?? (typeof legacyOrientation === "number" ? legacyOrientation : 0);
  }, []);

  const handleOrientation = useCallback((event: DeviceOrientationEvent) => {
    const webkitCompassHeading = (event as unknown as { webkitCompassHeading?: number }).webkitCompassHeading;
    const eventType = (event as unknown as { type?: string }).type;
    const isAbsoluteEvent = eventType === "deviceorientationabsolute" || event.absolute === true;

    if (isAbsoluteEvent) {
      hasAbsoluteFixRef.current = true;
    } else if (hasAbsoluteFixRef.current && typeof webkitCompassHeading !== "number") {
      // Vi har redan en pålitlig absolut/kompass-källa (Android
      // `deviceorientationabsolute`, eller iOS `webkitCompassHeading` som
      // alltid är absolut) — ignorera det här icke-absoluta
      // `deviceorientation`-eventet helt så det inte konkurrerar med och
      // förvränger den utjämnade riktningen.
      return;
    }

    let heading: number | null = null;
    if (typeof webkitCompassHeading === "number") {
      // iOS Safari ger kompassriktning direkt (0 = norr, medurs).
      heading = webkitCompassHeading;
    } else if (event.alpha !== null) {
      // Android: alpha 0 = enheten pekar mot norr, ökar moturs.
      heading = (360 - event.alpha) % 360;
    }

    if (heading === null || event.beta === null || event.gamma === null || Number.isNaN(heading)) return;

    // Tidsbaserad låg-passfiltrering: räknar om utjämningsfaktorn utifrån
    // faktisk tid sedan förra avläsningen, så resultatet blir stabilt även
    // om sensorns frekvens varierar (15–60 Hz beroende på enhet). Pitch/roll
    // (beta/gamma) utjämnas mer (längre tidskonstant) än gir, eftersom
    // vertikal drift stör horisontkänslan mest.
    const now = performance.now();
    const dt = lastEventTimeRef.current === null ? 1 / 60 : Math.min((now - lastEventTimeRef.current) / 1000, 0.5);
    lastEventTimeRef.current = now;

    const prevHeadingRaw = headingRef.current;

    // Hoppa över enstaka avläsningar som antyder en orimligt snabb vridning
    // (se konstantens kommentar ovan) — dessa är nästan alltid en tillfällig
    // magnetisk störning/sensorglitch, inte en verklig rörelse.
    if (prevHeadingRaw !== null && dt > 0) {
      const rawTurnRate = Math.abs(circularDiffDeg(heading, prevHeadingRaw)) / dt;
      if (rawTurnRate > MAX_PLAUSIBLE_TURN_RATE_DEG_PER_SEC) return;
    }

    // Adaptiv tidskonstant för giren: liten skillnad mot föregående råa
    // avläsning => sannolikt bara magnetometerbrus => dämpa kraftigt (lång
    // tidskonstant); stor skillnad => sannolikt en avsiktlig vridning =>
    // släpp igenom snabbt (kort tidskonstant).
    let headingTau = HEADING_STILL_TAU;
    if (prevHeadingRaw !== null) {
      const rawDelta = Math.abs(circularDiffDeg(heading, prevHeadingRaw));
      const t = Math.min(
        1,
        Math.max(0, (rawDelta - HEADING_NOISE_DELTA_DEG) / (HEADING_TURN_DELTA_DEG - HEADING_NOISE_DELTA_DEG)),
      );
      headingTau = HEADING_STILL_TAU + (HEADING_TURN_TAU - HEADING_STILL_TAU) * t;
    }

    const headingFactor = timeSmoothingFactor(headingTau, dt);
    const pitchRollFactor = timeSmoothingFactor(0.35, dt);

    const prevHeading = headingRef.current;
    const smoothedHeading = smoothCircular(headingRef, heading, headingFactor);
    const smoothedBeta = smoothLinear(betaRef, event.beta, pitchRollFactor);
    const smoothedGamma = smoothLinear(gammaRef, event.gamma, pitchRollFactor);

    // Kompass-stabilitet: rullande medel av |Δgir|/s över de senaste ~1.2s.
    // Låg medelhastighet -> stabil (nära 1), hög -> instabil (nära 0).
    if (prevHeading !== null && dt > 0) {
      let delta = smoothedHeading - prevHeading;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      const degPerSec = Math.abs(delta) / dt;
      const samples = headingDeltaSamplesRef.current;
      samples.push(degPerSec);
      if (samples.length > 24) samples.shift();
      const avgDegPerSec = samples.reduce((a, b) => a + b, 0) / samples.length;
      // 0°/s -> stabilitet 1; >=20°/s (snabb vridning) -> stabilitet 0.
      headingStabilityRef.current = Math.max(0, 1 - avgDegPerSec / 20);
    }

    // Konvertera tillbaka till en "alpha" som ger rätt gir i standardformeln.
    const alphaForQuaternion = (360 - smoothedHeading) % 360;
    const adjustedBeta = smoothedBeta - betaOffsetRef.current;

    computeDeviceQuaternion(alphaForQuaternion, adjustedBeta, smoothedGamma, screenAngleRef.current, quaternionRef.current);

    setError(null);
    if (!hasFixRef.current) {
      hasFixRef.current = true;
      hasFixAtRef.current = now;
      setHasFix(true);
    }

    // Se `hasSettled`-dokumentationen i API-typen ovan: vänta tills giren
    // varit stabil en sammanhängande stund (eller en maxväntetid passerat)
    // innan vindkraftverken litar på riktningen och börjar visas.
    if (!hasSettledRef.current && hasFixRef.current) {
      if (headingStabilityRef.current >= SETTLE_STABILITY_THRESHOLD) {
        if (stableSinceRef.current === null) stableSinceRef.current = now;
      } else {
        stableSinceRef.current = null;
      }
      const stableForMs = stableSinceRef.current !== null ? now - stableSinceRef.current : 0;
      const sinceFixMs = hasFixAtRef.current !== null ? now - hasFixAtRef.current : 0;
      if (stableForMs >= SETTLE_STABLE_DURATION_MS || sinceFixMs >= SETTLE_MAX_WAIT_MS) {
        hasSettledRef.current = true;
        setHasSettled(true);
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled || !supported) return;

    updateScreenAngle();
    window.addEventListener("orientationchange", updateScreenAngle);
    window.addEventListener("resize", updateScreenAngle);
    window.addEventListener("deviceorientationabsolute", handleOrientation as EventListener, true);
    window.addEventListener("deviceorientation", handleOrientation as EventListener, true);

    return () => {
      window.removeEventListener("orientationchange", updateScreenAngle);
      window.removeEventListener("resize", updateScreenAngle);
      window.removeEventListener("deviceorientationabsolute", handleOrientation as EventListener, true);
      window.removeEventListener("deviceorientation", handleOrientation as EventListener, true);
    };
  }, [enabled, supported, handleOrientation, updateScreenAngle]);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    const DOE = window.DeviceOrientationEvent as unknown as DeviceOrientationEventiOS;
    if (DOE && typeof DOE.requestPermission === "function") {
      try {
        const result = await DOE.requestPermission();
        if (result === "granted") {
          setNeedsPermission(false);
          setError(null);
          return true;
        }
        setError("Åtkomst till kompass nekades.");
        return false;
      } catch {
        setError("Kunde inte begära åtkomst till kompass.");
        return false;
      }
    }
    return true;
  }, []);

  useEffect(() => {
    const DOE = window.DeviceOrientationEvent as unknown as DeviceOrientationEventiOS;
    if (DOE && typeof DOE.requestPermission === "function") {
      setNeedsPermission(true);
    }
  }, []);

  const calibrateHorizon = useCallback(() => {
    // Lås aktuell pitch (beta) som "rak horisont" — kompenserar för
    // sensordrift/bias mellan olika enheter och minskar vertikal drift.
    betaOffsetRef.current = (betaRef.current ?? 90) - 90;
  }, []);

  return {
    supported,
    needsPermission,
    hasFix,
    hasSettled,
    error,
    requestPermission,
    calibrateHorizon,
    quaternionRef,
    headingStabilityRef,
  };
}
