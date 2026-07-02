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
}

function smoothCircular(prevRef: React.MutableRefObject<number | null>, raw: number, factor: number): number {
  if (prevRef.current === null) {
    prevRef.current = raw;
  } else {
    let diff = raw - prevRef.current;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    prevRef.current = (prevRef.current + diff * factor + 360) % 360;
  }
  return prevRef.current;
}

function smoothLinear(prevRef: React.MutableRefObject<number | null>, raw: number, factor: number): number {
  if (prevRef.current === null) {
    prevRef.current = raw;
  } else {
    prevRef.current = prevRef.current + (raw - prevRef.current) * factor;
  }
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

    const smoothedHeading = smoothCircular(headingRef, heading, 0.25);
    const smoothedBeta = smoothLinear(betaRef, event.beta, 0.3);
    const smoothedGamma = smoothLinear(gammaRef, event.gamma, 0.3);

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
  };
}
