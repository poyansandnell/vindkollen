import { useEffect, useRef } from "react";

interface DeviceMotionEventiOS {
  requestPermission?: () => Promise<"granted" | "denied">;
}

/**
 * Svag, alltid valfri signal till "Outdoor Confidence Index": mäter hur
 * jämnt/stilla enheten hålls just nu via `DeviceMotionEvent`-acceleration.
 * En telefon som hålls upp och siktas (typiskt utomhusbruk av den här appen)
 * har en annan rörelseprofil än en som ligger stilla på ett bord eller i en
 * ficka. Detta är EN svag, kompletterande signal (5% vikt i indexet) — INTE
 * en tillförlitlig inomhus/utomhus-detektor på egen hand, så den degraderar
 * alltid till ett neutralt värde (0.5) istället för att dra ner hela indexet
 * om sensorn saknas eller nekas.
 *
 * Returnerar en stabil ref (0..1, 1 = tydlig, naturlig hållrörelse) som
 * `useOutdoorConfidenceIndex` läser varje beräkning utan att behöva trigga
 * en re-render per sensoravläsning.
 */
export function useMotionActivity(enabled: boolean): React.MutableRefObject<number> {
  const motionScoreRef = useRef(0.5);
  const samplesRef = useRef<number[]>([]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || !("DeviceMotionEvent" in window)) {
      motionScoreRef.current = 0.5;
      return;
    }

    const DME = window.DeviceMotionEvent as unknown as DeviceMotionEventiOS;

    function handleMotion(event: DeviceMotionEvent) {
      const acc = event.accelerationIncludingGravity;
      if (!acc || acc.x === null || acc.y === null || acc.z === null) return;
      const magnitude = Math.sqrt(acc.x * acc.x + acc.y * acc.y + acc.z * acc.z);
      const samples = samplesRef.current;
      samples.push(magnitude);
      if (samples.length > 30) samples.shift();
      if (samples.length < 5) return;
      const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
      const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
      // Måttlig, naturlig handhållnings-variation (varken helt stilla på ett
      // bord/i en ficka, eller kraftigt skakig) ger högst poäng. Skalning
      // vald empiriskt för typiska mobilsensor-enheter (m/s²).
      const idealVariance = 0.6;
      const distance = Math.abs(variance - idealVariance);
      motionScoreRef.current = Math.max(0, 1 - distance / 2.5);
    }

    let cancelled = false;
    function attach() {
      if (cancelled) return;
      window.addEventListener("devicemotion", handleMotion);
    }

    if (DME && typeof DME.requestPermission === "function") {
      // iOS kräver explicit tillstånd. Om det redan beviljats (t.ex. via
      // kompass-tillståndsflödet) kommer detta lyckas tyst; annars lämnas
      // signalen neutral (0.5) tills tillstånd finns.
      DME.requestPermission()
        .then((result) => {
          if (result === "granted") attach();
        })
        .catch(() => {});
    } else {
      attach();
    }

    return () => {
      cancelled = true;
      window.removeEventListener("devicemotion", handleMotion);
      motionScoreRef.current = 0.5;
      samplesRef.current = [];
    };
  }, [enabled]);

  return motionScoreRef;
}
