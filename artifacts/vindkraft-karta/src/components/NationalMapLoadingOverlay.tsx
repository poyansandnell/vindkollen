import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

const DONE_SHOW_MS = 420;
const FADE_DURATION_MS = 350;

interface NationalMapLoadingOverlayProps {
  isLoading: boolean;
  isError: boolean;
  count: number;
  onRetry: () => void;
  onHidden: () => void;
}

type Phase = "loading" | "done" | "error" | "fading";

export function NationalMapLoadingOverlay({
  isLoading,
  isError,
  count,
  onRetry,
  onHidden,
}: NationalMapLoadingOverlayProps) {
  const [displayCount, setDisplayCount] = useState(0);
  const [phase, setPhase] = useState<Phase>("loading");
  const phaseRef = useRef<Phase>("loading");
  const displayRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (doneTimerRef.current !== null) {
      clearTimeout(doneTimerRef.current);
      doneTimerRef.current = null;
    }
  }, []);

  const updatePhase = useCallback(
    (next: Phase) => {
      phaseRef.current = next;
      setPhase(next);
    },
    [],
  );

  useEffect(() => () => cancelRaf(), [cancelRaf]);

  useEffect(() => {
    if (isError && phaseRef.current !== "fading") {
      cancelRaf();
      updatePhase("error");
    }
  }, [isError, cancelRaf, updatePhase]);

  useEffect(() => {
    if (!isLoading && !isError && phaseRef.current === "loading") {
      updatePhase("done");
    }
    if (isLoading && phaseRef.current === "error") {
      displayRef.current = 0;
      setDisplayCount(0);
      updatePhase("loading");
    }
  }, [isLoading, isError, updatePhase]);

  useEffect(() => {
    if (phase === "error" || phase === "fading") return;

    const ESTIMATE = 3500;
    let lastTime: number | null = null;

    const tick = (now: number) => {
      if (lastTime === null) lastTime = now;
      const dt = Math.min(now - lastTime, 80);
      lastTime = now;

      const cur = displayRef.current;
      const target = phase === "loading" ? ESTIMATE * 0.82 : count;
      const tau = phase === "loading" ? 1800 : 480;
      const next = cur + (target - cur) * (1 - Math.exp(-dt / tau));
      displayRef.current = next;
      setDisplayCount(Math.round(next));

      if (phase === "done" && Math.abs(next - count) < 0.5) {
        displayRef.current = count;
        setDisplayCount(count);
        doneTimerRef.current = setTimeout(() => updatePhase("fading"), DONE_SHOW_MS);
        return;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return cancelRaf;
  }, [phase, count, cancelRaf, updatePhase]);

  useEffect(() => {
    if (phase !== "fading") return;
    const id = setTimeout(onHidden, FADE_DURATION_MS + 60);
    return () => clearTimeout(id);
  }, [phase, onHidden]);

  const finalCount = count > 0 ? count : 3500;
  const progress =
    phase === "loading"
      ? Math.min(displayCount / (3500 * 0.82), 1) * 0.82
      : Math.min(displayCount / finalCount, 1);

  const isDoneOrFading = phase === "done" || phase === "fading";

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center"
      style={{
        opacity: phase === "fading" ? 0 : 1,
        transition: `opacity ${FADE_DURATION_MS}ms ease-out`,
        pointerEvents: phase === "fading" ? "none" : "auto",
      }}
      role="status"
      aria-live="polite"
      aria-label={isDoneOrFading ? "Kartdata laddad" : "Laddar kartdata"}
    >
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" aria-hidden="true" />

      <div className="relative mx-4 w-full max-w-[300px] rounded-2xl border border-white/10 bg-[#111]/95 px-6 py-5 shadow-2xl">
        {phase === "error" ? (
          <div className="text-center">
            <div className="mb-3 text-2xl" aria-hidden="true">⚠️</div>
            <p className="font-semibold text-white">Kunde inte ladda data</p>
            <p className="mt-1 text-sm text-white/60">
              Kontrollera anslutningen och försök igen.
            </p>
            <button
              onClick={onRetry}
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-orange-500 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-orange-600"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Försök igen
            </button>
          </div>
        ) : (
          <>
            <p className="text-[10px] font-bold uppercase tracking-widest text-orange-400">
              Vindkollen
            </p>
            <p className="mt-0.5 text-sm text-white/70">
              {isDoneOrFading
                ? "Vindkraftsprojekt laddade"
                : "Laddar Sveriges vindkraftsprojekt\u2026"}
            </p>

            <div className="mt-3 flex items-baseline gap-1.5">
              {isDoneOrFading && (
                <span className="font-bold text-orange-400" aria-hidden="true">
                  ✓
                </span>
              )}
              <span className="tabular-nums text-4xl font-black leading-none text-white">
                {displayCount.toLocaleString("sv-SE")}
              </span>
            </div>

            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-orange-500"
                style={{
                  width: `${Math.round(progress * 100)}%`,
                  transition: "width 60ms linear",
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
