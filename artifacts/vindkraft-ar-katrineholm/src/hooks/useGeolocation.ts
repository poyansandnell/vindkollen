import { useEffect, useRef, useState } from "react";

export interface GeoState {
  lat: number | null;
  lon: number | null;
  accuracy: number | null;
  error: string | null;
  loading: boolean;
}

/** Bevakar enhetens position kontinuerligt via GPS. */
export function useGeolocation(enabled: boolean): GeoState {
  const [state, setState] = useState<GeoState>({
    lat: null,
    lon: null,
    accuracy: null,
    error: null,
    loading: enabled,
  });
  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    if (!("geolocation" in navigator)) {
      setState((s) => ({ ...s, loading: false, error: "Geolocation stöds inte i den här webbläsaren." }));
      return;
    }

    setState((s) => ({ ...s, loading: true }));

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setState({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          error: null,
          loading: false,
        });
      },
      (err) => {
        const message =
          err.code === err.PERMISSION_DENIED
            ? "Platsbehörighet nekad. Tillåt Plats för den här sidan i webbläsarens inställningar och ladda om."
            : err.code === err.POSITION_UNAVAILABLE
              ? "Kunde inte fastställa din position just nu. Kontrollera att GPS är påslaget."
              : err.code === err.TIMEOUT
                ? "Det tog för lång tid att hämta din position. Försök igen utomhus med fri sikt mot himlen."
                : err.message || "Kunde inte hämta position.";
        setState((s) => ({ ...s, loading: false, error: message }));
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [enabled]);

  return state;
}
