import { useCallback, useEffect, useRef, useState } from "react";
import { areNativePermissionsGranted, isNative, requestNativeGeolocationPermission, watchNativePosition } from "../lib/capacitorBridge";

export interface GeoState {
  lat: number | null;
  lon: number | null;
  accuracy: number | null;
  error: string | null;
  loading: boolean;
  /** True när felet beror på att webbläsaren/användaren nekat platsbehörighet. */
  permissionDenied: boolean;
  /**
   * Nuvarande status för platsbehörigheten enligt Permissions API.
   * "unsupported" om webbläsaren saknar Permissions API.
   */
  permissionState: PermissionState | "unsupported";
  /** Gör ett nytt försök att hämta position. */
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
  const nativeCleanupRef = useRef<(() => void) | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const retry = useCallback(() => {
    setState((s) => ({ ...s, error: null, permissionDenied: false, loading: true }));
    setRetryToken((t) => t + 1);
  }, []);

  // Proaktiv behörighetsstatus via Permissions API (webb)
  useEffect(() => {
    if (isNative()) return; // Hanteras separat via Capacitor
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

    setState((s) => ({ ...s, loading: true }));

    // Vakthund — garanterar att användaren alltid får ett fel + retry-knapp
    // efter max 20 sekunder om watchPosition aldrig svarar.
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

    // ------------------------------------------------------------------
    // Native: @capacitor/geolocation plugin (tillförlitligare än browser-API i WKWebView)
    // ------------------------------------------------------------------
    if (isNative()) {
      let stopped = false;

      async function startNativeGPS() {
        // 1. checkPermissions + requestPermissions via Capacitor —
        //    hoppa över om redan beviljad av requestAllPermissionsSequentially().
        const granted =
          areNativePermissionsGranted() || (await requestNativeGeolocationPermission());
        console.log("[Vindkollen] useGeolocation: location permission =", granted);
        if (stopped) return;

        if (!granted) {
          window.clearTimeout(watchdogId);
          setState((s) => ({
            ...s,
            loading: false,
            error:
              "Platsbehörighet nekad. Öppna Inställningar → Vindkollen → Plats och välj 'Vid användning av appen'.",
            permissionDenied: true,
            permissionState: "denied",
          }));
          return;
        }

        // 2. watchPosition via Capacitor Geolocation plugin
        const cleanup = await watchNativePosition(
          (lat, lon, accuracy) => {
            gotFix = true;
            window.clearTimeout(watchdogId);
            setState((s) => ({
              ...s,
              lat,
              lon,
              accuracy,
              error: null,
              permissionDenied: false,
              loading: false,
            }));
          },
          (errMsg) => {
            const permissionDenied = errMsg.toLowerCase().includes("denied") ||
              errMsg.toLowerCase().includes("nekad");
            setState((s) => ({
              ...s,
              loading: false,
              error: permissionDenied
                ? "Platsbehörighet nekad. Öppna Inställningar → Vindkollen → Plats."
                : errMsg || "Kunde inte hämta position.",
              permissionDenied,
              permissionState: permissionDenied ? "denied" : s.permissionState,
            }));
          },
        );

        if (stopped) {
          cleanup();
        } else {
          nativeCleanupRef.current = cleanup;
        }
      }

      void startNativeGPS();

      return () => {
        stopped = true;
        window.clearTimeout(watchdogId);
        nativeCleanupRef.current?.();
        nativeCleanupRef.current = null;
      };
    }

    // ------------------------------------------------------------------
    // Webb: navigator.geolocation.watchPosition
    // ------------------------------------------------------------------
    if (!("geolocation" in navigator)) {
      window.clearTimeout(watchdogId);
      setState((s) => ({
        ...s,
        loading: false,
        error: "Geolocation stöds inte i den här webbläsaren.",
      }));
      return;
    }

    let watchStarted = false;

    void requestNativeGeolocationPermission().then((granted) => {
      // requestNativeGeolocationPermission är no-op på webb (returnerar true)
      if (watchStarted) return;
      watchStarted = true;

      if (!granted) {
        window.clearTimeout(watchdogId);
        setState((s) => ({
          ...s,
          loading: false,
          error:
            "Platsbehörighet nekad. Öppna Inställningar → Vindkollen → Plats och välj 'Vid användning av appen'.",
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
      watchStarted = true;
      window.clearTimeout(watchdogId);
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [enabled, retryToken]);

  return { ...state, retry };
}
