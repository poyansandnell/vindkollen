import { useCallback, useEffect, useRef, useState } from "react";
import { requestNativeGeolocationPermission } from "../lib/capacitorBridge";

export interface GeoState {
  lat: number | null;
  lon: number | null;
  accuracy: number | null;
  error: string | null;
  loading: boolean;
  /** True när felet beror på att webbläsaren/användaren nekat platsbehörighet. */
  permissionDenied: boolean;
  /**
   * Nuvarande status för platsbehörigheten enligt Permissions API, uppdaterad
   * proaktivt (inte bara efter ett misslyckat försök). "unsupported" om
   * webbläsaren saknar Permissions API — då vet vi bara via ett faktiskt
   * försök om behörigheten är nekad.
   */
  permissionState: PermissionState | "unsupported";
  /** Gör ett nytt försök att hämta position — triggar webbläsarens native-dialog om läget fortfarande är "prompt". */
  retry: () => void;
}

/** Bevakar enhetens position kontinuerligt via GPS. */
export function useGeolocation(enabled: boolean): GeoState {
  const [state, setState] = useState<Omit<GeoState, "retry">>({
    lat: null,
    lon: null,
    accuracy: null,
    error: null,
    loading: enabled,
    permissionDenied: false,
    permissionState: "unsupported",
  });
  const watchIdRef = useRef<number | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const retry = useCallback(() => {
    setState((s) => ({ ...s, error: null, permissionDenied: false, loading: true }));
    setRetryToken((t) => t + 1);
  }, []);

  // Läser proaktivt av platsbehörighetens status via Permissions API,
  // oavsett om vi redan gjort ett watchPosition-anrop.
  useEffect(() => {
    if (!navigator.permissions?.query) return;

    let cancelled = false;
    let status: PermissionStatus | null = null;

    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((result) => {
        if (cancelled) return;
        status = result;
        setState((s) => ({ ...s, permissionState: result.state }));
        result.onchange = () => {
          setState((s) => ({ ...s, permissionState: result.state }));
        };
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (status) status.onchange = null;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;

    if (!("geolocation" in navigator)) {
      setState((s) => ({ ...s, loading: false, error: "Geolocation stöds inte i den här webbläsaren." }));
      return;
    }

    setState((s) => ({ ...s, loading: true }));

    // Vakthund — garanterar att användaren alltid får ett fel + retry-knapp
    // efter max 20 sekunder om watchPosition aldrig svarar (känt iOS-problem).
    let gotFix = false;
    const watchdogId = window.setTimeout(() => {
      if (gotFix) return;
      setState((s) => {
        if (s.lat !== null) return s;
        return {
          ...s,
          loading: false,
          error:
            "Det tog för lång tid att hämta din position. Kontrollera att Plats/GPS är påslaget för Vindkollen i Inställningar och försök igen.",
        };
      });
    }, 20000);

    // --- Capacitor native: begär platsbehörighet via iOS-systemdialog ---
    // navigator.geolocation.watchPosition i WKWebView kräver att appen
    // explicit begär platsbehörighet via Capacitor-plugin INNAN anropet,
    // annars misslyckas det utan att någon dialog visas.
    let watchStarted = false;

    void requestNativeGeolocationPermission().then((granted) => {
      if (watchStarted) return; // Effect redan avmonterad
      watchStarted = true;

      if (!granted) {
        window.clearTimeout(watchdogId);
        setState((s) => ({
          ...s,
          loading: false,
          error: "Platsbehörighet nekad. Öppna Inställningar → Vindkollen → Plats och välj 'Vid användning av appen'.",
          permissionDenied: true,
          permissionState: "denied",
        }));
        return;
      }

      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          gotFix = true;
          window.clearTimeout(watchdogId);
          setState((s) => ({
            ...s,
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            error: null,
            permissionDenied: false,
            loading: false,
          }));
        },
        (err) => {
          const permissionDenied = err.code === err.PERMISSION_DENIED;
          const message = permissionDenied
            ? "Platsbehörighet nekad. Öppna Inställningar → Vindkollen → Plats och välj 'Vid användning av appen'."
            : err.code === err.POSITION_UNAVAILABLE
              ? "Kunde inte fastställa din position just nu. Kontrollera att GPS är påslaget."
              : err.code === err.TIMEOUT
                ? "Det tog för lång tid att hämta din position. Försök igen utomhus med fri sikt mot himlen."
                : err.message || "Kunde inte hämta position.";
          setState((s) => ({
            ...s,
            loading: false,
            error: message,
            permissionDenied,
            permissionState: permissionDenied ? "denied" : s.permissionState,
          }));
        },
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
      );
    });

    return () => {
      watchStarted = true; // Stoppar promise-callbacken om den ännu inte kört
      window.clearTimeout(watchdogId);
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [enabled, retryToken]);

  return { ...state, retry };
}
