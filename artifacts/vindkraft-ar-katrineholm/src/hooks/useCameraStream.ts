import { useCallback, useEffect, useRef, useState } from "react";

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

    // Egen "vakthund"-timer, samma mönster som `useGeolocation.ts`. Vissa
    // användare (rapporterat: "det bara tuggar", evig snurra på "Startar
    // kameran…") har fastnat på obestämd tid utan att `getUserMedia`
    // någonsin vare sig lyckas eller kastar ett fel — troligen p.g.a. en
    // hängande kamerabehörighetsdialog, en kamera upptagen av en annan
    // process/flik, eller ett OS-/webbläsarspecifikt hårdvaruproblem. Utan
    // denna vakthund fanns ingen väg framåt för de användarna: inget
    // felmeddelande, ingen "Försök igen"-knapp, bara en evig spinner.
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
      if (!navigator.mediaDevices?.getUserMedia) {
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
      window.clearTimeout(watchdogId);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [enabled, retryToken]);

  return { ...state, retry };
}
