import { useMemo } from "react";
import { useMotionActivity } from "@/hooks/useMotionActivity";
import { useConnectionHint } from "@/hooks/useConnectionHint";

export type OutdoorConfidenceTier = "show" | "cautious" | "aim" | "hide";

export interface OutdoorConfidenceBreakdown {
  /** Kamera/AI-himmelsandel (0..1) — 45% vikt, den mest träffsäkra källan. */
  camera: number;
  /** GPS-precision mappad till 0..1 (bättre precision -> högre) — 20% vikt. */
  gps: number;
  /** Ljusnivå (riktig AmbientLightSensor om möjligt, annars kameraproxy) — 15% vikt. */
  light: number;
  /** Kompass-stabilitet (0..1) — 10% vikt. */
  compass: number;
  /** Rörelse/gyro-signal (0..1, neutral 0.5 om ej tillgänglig) — 5% vikt. */
  motion: number;
  /** Wifi/inomhus-antydan (0..1, neutral 0.5 om ej tillgänglig) — 5% vikt. */
  connection: number;
}

export interface OutdoorConfidenceState {
  /** Sammanvägt index 0..100. */
  score: number;
  breakdown: OutdoorConfidenceBreakdown;
  tier: OutdoorConfidenceTier;
}

const WEIGHTS = {
  camera: 0.45,
  gps: 0.2,
  light: 0.15,
  compass: 0.1,
  motion: 0.05,
  connection: 0.05,
} as const;

// GPS-precision (meter) mappad till en 0..1-konfidens: <=8m ger full poäng,
// >=50m (typiskt inomhus/dålig sikt mot satelliter) ger nästan ingen.
function gpsAccuracyToConfidence(accuracy: number | null): number {
  if (accuracy === null) return 0.5; // neutral tills en första fix finns
  if (accuracy <= 8) return 1;
  if (accuracy >= 50) return 0.05;
  return 1 - (accuracy - 8) / (50 - 8);
}

function tierFor(score: number): OutdoorConfidenceTier {
  if (score >= 90) return "show";
  if (score >= 70) return "cautious";
  if (score >= 40) return "aim";
  return "hide";
}

/**
 * Slår samman flera oberoende, olika tillförlitliga signaler till ett enda
 * "Outdoor Confidence Index" (0-100%) enligt produktkravet: Kamera/AI 45%,
 * GPS-precision 20%, ljussensor 15%, kompass-stabilitet 10%, rörelse/gyro 5%,
 * wifi/inomhus 5%. Varje svag/valfri signal (ljus utan riktig sensor, rörelse,
 * wifi) degraderar till ett neutralt värde (0.5) istället för att dra ner
 * hela indexet när den inte är tillgänglig — bara kamera/AI (den mest
 * pålitliga källan) och GPS bidrar med starkt polariserande värden.
 *
 * Tröskelvärden (tiers) enligt produktkrav:
 * - >=90%: visa verk normalt.
 * - 70-89%: visa försiktigt (t.ex. lägre opacitet).
 * - 40-69%: be användaren rikta kameran mot himlen, dölj verk under tiden.
 * - <40%: dölj verk helt, visa "Gå utomhus".
 */
export function useOutdoorConfidenceIndex(params: {
  enabled: boolean;
  cameraSkyRatio: number;
  gpsAccuracy: number | null;
  ambientLuminance: number;
  headingStabilityRef: React.MutableRefObject<number>;
}): OutdoorConfidenceState {
  const { enabled, cameraSkyRatio, gpsAccuracy, ambientLuminance, headingStabilityRef } = params;
  const motionRef = useMotionActivity(enabled);
  const connectionRef = useConnectionHint();

  return useMemo(() => {
    // Kamera/AI-andelen skalas likadant som `outdoorConfidence` i
    // useSkyDetection (~25% himmel i bild räknas redan som "fri sikt").
    const camera = Math.min(cameraSkyRatio / 0.25, 1);
    const gps = gpsAccuracyToConfidence(gpsAccuracy);
    // Ljus: en riktig AmbientLightSensor-avläsning hade varit direkt lux,
    // men webbläsarstödet är för svagt för att förlita sig på — istället
    // används kamerans egen genomsnittsluminans (redan 0..1) som proxy:
    // ljust ute (även mulet) ger typiskt betydligt högre värde än normal
    // inomhusbelysning.
    const light = ambientLuminance;
    const compass = headingStabilityRef.current;
    const motion = motionRef.current;
    const connection = connectionRef.current;

    const score =
      (camera * WEIGHTS.camera +
        gps * WEIGHTS.gps +
        light * WEIGHTS.light +
        compass * WEIGHTS.compass +
        motion * WEIGHTS.motion +
        connection * WEIGHTS.connection) *
      100;

    return {
      score,
      breakdown: { camera, gps, light, compass, motion, connection },
      tier: tierFor(score),
    };
  }, [cameraSkyRatio, gpsAccuracy, ambientLuminance, headingStabilityRef, motionRef, connectionRef]);
}
