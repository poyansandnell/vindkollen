import { useCallback, useEffect, useRef, useState } from "react";
import {
  areNativePermissionsGranted,
  isNative,
  requestNativeCameraPermission,
  startNativeCameraPreview,
  stopNativeCameraPreview,
} from "../lib/capacitorBridge";

export interface CameraState {
  stream: MediaStream | null;
  /**
   * True när kameran körs som native camera-preview (iOS/Android).
   * CameraPreview renderas som ett nativt lager bakom WKWebView —
   * det finns ingen MediaStream/video-element i detta läge.
   */
  nativePreview: boolean;
  error: string | null;
  loading: boolean;
  /** Gör ett nytt försök att starta kameran. */
  retry: () => void;
}

/** Startar bakre kameran — via getUserMedia på webb, CameraPreview på native. */
export function useCameraStream(enabled: boolean): CameraState {
  const [state, setState] = useState<Omit<CameraState, "retry">>({
    stream: null,
    nativePreview: false,
    error: null,
    loading: enabled,
  });
  const streamRef = useRef<MediaStream | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const retry = useCallback(() => {
    setState((s) => ({ ...s, error: null, loading: true }));
    setRetryToken((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));

    // ------------------------------------------------------------------
    // Native: CameraPreview plugin (renderas bakom WKWebView)
    // ------------------------------------------------------------------
    if (isNative()) {
      async function startNative() {
        // 1. Begär kamerabehörighet — hoppa över om redan beviljad av
        //    requestAllPermissionsSequentially() i handleStart.
        const alreadyGranted = areNativePermissionsGranted();
        console.log("[AR] useCameraStream: alreadyGranted =", alreadyGranted);
        let permGranted = alreadyGranted;
        if (!alreadyGranted) {
          console.log("[AR] useCameraStream: requesting camera permission (not pre-granted)");
          try {
            permGranted = await requestNativeCameraPermission();
          } catch (err) {
            console.error("[AR] useCameraStream: requestNativeCameraPermission threw:", err);
            permGranted = false;
          }
        }
        console.log("[AR] useCameraStream: camera permission =", permGranted);
        if (cancelled) return;

        if (!permGranted) {
          setState({
            stream: null,
            nativePreview: false,
            error:
              "Kamerabehörighet nekad. Öppna Inställningar → Vindkollen → Kamera och tillåt åtkomst.",
            loading: false,
          });
          return;
        }

        // 2. Starta native camera-preview
        console.log("[AR] Starting CameraPreview");
        let started = false;
        try {
          started = await startNativeCameraPreview();
        } catch (err) {
          console.error("[AR] startNativeCameraPreview threw:", err);
        }
        console.log("[AR] CameraPreview started:", started);
        if (cancelled) {
          if (started) void stopNativeCameraPreview();
          return;
        }

        if (!started) {
          setState({
            stream: null,
            nativePreview: false,
            error:
              "Kunde inte starta kameraförhandsgranskning. Kontrollera att ingen annan app använder kameran.",
            loading: false,
          });
          return;
        }

        setState({ stream: null, nativePreview: true, error: null, loading: false });
      }

      void startNative();

      return () => {
        cancelled = true;
        void stopNativeCameraPreview();
        setState((s) => ({ ...s, nativePreview: false }));
      };
    }

    // ------------------------------------------------------------------
    // Webb: getUserMedia (befintlig logik)
    // ------------------------------------------------------------------
    let gotStream = false;
    const watchdogId = window.setTimeout(() => {
      if (gotStream || cancelled) return;
      setState((s) => {
        if (s.stream !== null) return s;
        return {
          ...s,
          loading: false,
          error:
            "Det tog för lång tid att starta kameran. Kontrollera att ingen annan app använder kameran och försök igen.",
        };
      });
    }, 15000);

    async function startWeb() {
      if (!navigator.mediaDevices?.getUserMedia) {
        gotStream = true;
        window.clearTimeout(watchdogId);
        setState({
          stream: null,
          nativePreview: false,
          error: "Kameran stöds inte i den här webbläsaren.",
          loading: false,
        });
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        gotStream = true;
        window.clearTimeout(watchdogId);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setState({ stream, nativePreview: false, error: null, loading: false });
      } catch (err) {
        gotStream = true;
        window.clearTimeout(watchdogId);
        if (cancelled) return;
        const name = err instanceof Error ? err.name : "";
        const message =
          name === "NotAllowedError" || name === "PermissionDeniedError"
            ? "Kamerabehörighet nekad. Tillåt kamera i webbläsarens inställningar och försök igen."
            : name === "NotFoundError" || name === "DevicesNotFoundError"
              ? "Ingen kamera hittades på enheten."
              : name === "NotReadableError"
                ? "Kameran kunde inte startas — den kan vara upptagen i en annan app."
                : err instanceof Error
                  ? err.message
                  : "Kunde inte starta kameran.";
        setState({ stream: null, nativePreview: false, error: message, loading: false });
      }
    }

    void startWeb();

    return () => {
      cancelled = true;
      window.clearTimeout(watchdogId);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [enabled, retryToken]);

  return { ...state, retry };
}
