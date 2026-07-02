import { useCallback, useEffect, useRef, useState } from "react";

interface DeviceOrientationEventiOS {
  requestPermission?: () => Promise<"granted" | "denied">;
}

export interface CompassState {
  heading: number | null;
  supported: boolean;
  needsPermission: boolean;
  error: string | null;
}

/**
 * Läser digital kompassriktning (0 = norr, medurs) från enhetens sensorer.
 * iOS Safari kräver ett användarinitierat anrop till requestPermission().
 */
export function useCompassHeading(enabled: boolean) {
  const [state, setState] = useState<CompassState>({
    heading: null,
    supported: typeof window !== "undefined" && "DeviceOrientationEvent" in window,
    needsPermission: false,
    error: null,
  });
  const smoothedRef = useRef<number | null>(null);

  const handleOrientation = useCallback((event: DeviceOrientationEvent) => {
    let raw: number | null = null;

    const webkitCompassHeading = (event as unknown as { webkitCompassHeading?: number })
      .webkitCompassHeading;

    if (typeof webkitCompassHeading === "number") {
      // iOS Safari gives compass heading directly (0 = norr, medurs).
      raw = webkitCompassHeading;
    } else if (event.absolute && event.alpha !== null) {
      // Android: alpha 0 = enheten pekar mot norr, ökar moturs.
      raw = (360 - event.alpha) % 360;
    } else if (event.alpha !== null) {
      raw = (360 - event.alpha) % 360;
    }

    if (raw === null || Number.isNaN(raw)) return;

    // Exponentiell utjämning för att undvika hackig rörelse.
    if (smoothedRef.current === null) {
      smoothedRef.current = raw;
    } else {
      let diff = raw - smoothedRef.current;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      smoothedRef.current = (smoothedRef.current + diff * 0.25 + 360) % 360;
    }

    setState((s) => ({ ...s, heading: smoothedRef.current, error: null }));
  }, []);

  useEffect(() => {
    if (!enabled || !state.supported) return;

    window.addEventListener("deviceorientationabsolute", handleOrientation as EventListener, true);
    window.addEventListener("deviceorientation", handleOrientation as EventListener, true);

    return () => {
      window.removeEventListener("deviceorientationabsolute", handleOrientation as EventListener, true);
      window.removeEventListener("deviceorientation", handleOrientation as EventListener, true);
    };
  }, [enabled, state.supported, handleOrientation]);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    const DOE = window.DeviceOrientationEvent as unknown as DeviceOrientationEventiOS;
    if (DOE && typeof DOE.requestPermission === "function") {
      try {
        const result = await DOE.requestPermission();
        if (result === "granted") {
          setState((s) => ({ ...s, needsPermission: false, error: null }));
          return true;
        }
        setState((s) => ({ ...s, error: "Åtkomst till kompass nekades." }));
        return false;
      } catch {
        setState((s) => ({ ...s, error: "Kunde inte begära åtkomst till kompass." }));
        return false;
      }
    }
    // Android / browsers that don't require explicit permission.
    return true;
  }, []);

  useEffect(() => {
    const DOE = window.DeviceOrientationEvent as unknown as DeviceOrientationEventiOS;
    if (DOE && typeof DOE.requestPermission === "function") {
      setState((s) => ({ ...s, needsPermission: true }));
    }
  }, []);

  return { ...state, requestPermission };
}
