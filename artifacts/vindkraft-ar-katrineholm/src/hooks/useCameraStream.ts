import { useEffect, useRef, useState } from "react";

export interface CameraState {
  stream: MediaStream | null;
  error: string | null;
  loading: boolean;
}

/** Startar bakre kameran som bakgrund för AR-vyn. */
export function useCameraStream(enabled: boolean): CameraState {
  const [state, setState] = useState<CameraState>({ stream: null, error: null, loading: enabled });
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState({ stream: null, error: "Kameran stöds inte i den här webbläsaren.", loading: false });
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setState({ stream, error: null, loading: false });
      } catch (err) {
        const name = err instanceof Error ? err.name : "";
        const message =
          name === "NotAllowedError" || name === "PermissionDeniedError"
            ? "Kamerabehörighet nekad. Tillåt Kamera för den här sidan i webbläsarens inställningar och ladda om."
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
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [enabled]);

  return state;
}
