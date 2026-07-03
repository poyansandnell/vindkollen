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
  const [error, setError] = useState<string | null>(null);

  const headingRef = useRef<number | null>(null);
  const betaRef = useRef<number | null>(null);
  const gammaRef = useRef<number | null>(null);
  const betaOffsetRef = useRef(0);
  const screenAngleRef = useRef(0);
  const quaternionRef = useRef(new THREE.Quaternion());
  const hasFixRef = useRef(false);
  const lastEventTimeRef = useRef<number | null>(null);
  const headingStabilityRef = useRef(1);
  // Litet rullande fönster av senaste |Δgir|/tidssteg-samples (grader/s) —
  // används bara för att räkna fram `headingStabilityRef`, ingen render.
  const headingDeltaSamplesRef = useRef<number[]>([]);

  const updateScreenAngle = useCallback(() => {
    const orientationApi = (screen as unknown as { orientation?: { angle: number } }).orientation;
    const legacyOrientation = (window as unknown as { orientation?: number }).orientation;
    screenAngleRef.current = orientationApi?.angle ?? (typeof legacyOrientation === "number" ? legacyOrientation : 0);
  }, []);

  const handleOrientation = useCallback((event: DeviceOrientationEvent) => {
    const webkitCompassHeading = (event as unknown as { webkitCompassHeading?: number }).webkitCompassHeading;

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

    const headingFactor = timeSmoothingFactor(0.15, dt);
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
      setHasFix(true);
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
    error,
    requestPermission,
    calibrateHorizon,
    quaternionRef,
    headingStabilityRef,
  };
}
