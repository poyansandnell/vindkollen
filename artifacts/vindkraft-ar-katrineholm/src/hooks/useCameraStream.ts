import { useCallback, useEffect, useRef, useState } from "react";
import { requestNativeCameraPermission } from "../lib/capacitorBridge";

export interface CameraState {
  stream: MediaStream | null;
  error: string | null;
  loading: boolean;
  /** Gör ett nytt försök att starta kameran — triggar webbläsarens native-dialog om läget fortfarande är "prompt". */
  retry: () => void;
}

/** Startar bakre kameran som bakgrund för AR-vyn. */
export function useCameraStream(enabled: boolean): CameraState {
  const [state, setState] = useState<Omit<CameraState, "retry">>({
    stream: null,
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

    // Vakthund — garanterar ett felmeddelande + retry-knapp om getUserMedia
    // hänger (kamerabehörighetsdialog hänger, kamera upptagen, m.m.).
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

    async function start() {
      // --- Capacitor native: begär kamerabehörighet via iOS-systemdialog ---
      // getUserMedia i WKWebView kräver att appen explicit frågar om
      // kamerabehörighet via Capacitor-plugin INNAN API:et anropas,
      // annars misslyckas det tyst med "not supported" eller "error".
      const permissionGranted = await requestNativeCameraPermission();
      if (cancelled) return;

      if (!permissionGranted) {
        gotStream = true;
        window.clearTimeout(watchdogId);
        setState({
          stream: null,
          error: "Kamerabehörighet nekad. Öppna Inställningar → Vindkollen → Kamera och tillåt åtkomst.",
          loading: false,
        });
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        gotStream = true;
        window.clearTimeout(watchdogId);
        setState({ stream: null, error: "Kameran stöds inte i den här webbläsaren.", loading: false });
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        gotStream = true;
        window.clearTimeout(watchdogId);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setState({ stream, error: null, loading: false });
      } catch (err) {
        gotStream = true;
        window.clearTimeout(watchdogId);
        if (cancelled) return;
        const name = err instanceof Error ? err.name : "";
        const message =
          name === "NotAllowedError" || name === "PermissionDeniedError"
            ? "Kamerabehörighet nekad. Öppna Inställningar → Vindkollen → Kamera och tillåt åtkomst."
            : name === "NotFoundError" || name === "DevicesNotFoundError"
              ? "Ingen kamera hittades på enheten."
              : name === "NotReadableError"
                ? "Kameran kunde inte startas — den kan vara upptagen i en annan app."
                : err instanceof Error
                  ? err.message
                  : "Kunde inte starta kameran.";
        setState({
          stream: null,
          error: message,
          loading: false,
        });
      }
    }

    start();

    return () => {
      cancelled = true;
      window.clearTimeout(watchdogId);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [enabled, retryToken]);

  return { ...state, retry };
}
