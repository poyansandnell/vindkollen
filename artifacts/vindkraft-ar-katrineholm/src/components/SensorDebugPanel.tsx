import type { ArTrackingTier } from "@/hooks/useArTrackingStability";

interface SensorDebugPanelProps {
  gpsAccuracyM: number | null;
  headingDeg: number | null;
  headingStability: number;
  headingAccuracyDeg: number | null;
  pitchDeg: number | null;
  horizonOffsetDeg: number;
  arTrackingTier: ArTrackingTier;
  frozenForMs: number;
  visibleTurbineCount: number;
  totalTurbineCount: number;
  /** Produktkrav 2: antal laddade verk (samma mängd som skickas till ARScene). */
  loadedTurbineCount: number;
  /** Produktkrav 2: antal verk inom max-renderavstånd, oavsett riktning. */
  withinRangeTurbineCount: number;
  /** Produktkrav 2: antal verk just nu inom kamerans FOV (och inom räckhåll). */
  inFrontOfCameraCount: number;
  /** Produktkrav 2: avstånd (m) till närmaste verk. */
  nearestDistanceM: number | null;
  /** Produktkrav 2: bäring (grader från norr) till närmaste verk. */
  bearingToNearestDeg: number | null;
  /** Produktkrav 2: vinkelskillnad (grader) mellan kompassriktning och närmaste verk. */
  angleDiffToNearestDeg: number | null;
  hideReasons: string[];
  onClose: () => void;
}

const TIER_LABEL: Record<ArTrackingTier, string> = {
  initializing: "Initierar…",
  good: "Bra",
  degraded: "Försämrad (fryst)",
  lost: "Förlorad (tonar ut)",
};

const TIER_COLOR: Record<ArTrackingTier, string> = {
  initializing: "text-white/60",
  good: "text-green-400",
  degraded: "text-yellow-400",
  lost: "text-red-400",
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/5 py-1.5 text-xs">
      <span className="text-white/60">{label}</span>
      <span className="font-mono text-white">{value}</span>
    </div>
  );
}

function fmt(value: number | null, unit: string, digits = 1): string {
  return value === null ? "–" : `${value.toFixed(digits)}${unit}`;
}

/**
 * Dolt/tekniskt debugläge (produktkrav 7) — visar de råa signalerna bakom
 * AR-placeringens stabilitet (`useArTrackingStability`) och kompassen
 * (`useDeviceOrientation`), plus varför verk eventuellt döljs just nu.
 * Öppnas via "🐞 Sensordebug"-togglen i `VisualizationControls`; avsett
 * för felsökning under fältprov, inte för vanliga användare.
 */
export function SensorDebugPanel({
  gpsAccuracyM,
  headingDeg,
  headingStability,
  headingAccuracyDeg,
  pitchDeg,
  horizonOffsetDeg,
  arTrackingTier,
  frozenForMs,
  visibleTurbineCount,
  totalTurbineCount,
  loadedTurbineCount,
  withinRangeTurbineCount,
  inFrontOfCameraCount,
  nearestDistanceM,
  bearingToNearestDeg,
  angleDiffToNearestDeg,
  hideReasons,
  onClose,
}: SensorDebugPanelProps) {
  return (
    <div className="absolute inset-x-0 bottom-0 z-50 max-h-[70dvh] overflow-y-auto rounded-t-3xl border-t border-[#FF8B01]/30 bg-[#0c0b0a]/95 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4 text-white shadow-2xl backdrop-blur-sm">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[#FFB347]">🐞 Sensordebug</h2>
        <button
          onClick={onClose}
          aria-label="Stäng sensordebug"
          className="rounded-full bg-white/10 px-3 py-1 text-xs text-white hover:bg-white/20"
        >
          Stäng
        </button>
      </div>

      <Row label="GPS-precision" value={fmt(gpsAccuracyM, " m")} />
      <Row label="Kompassriktning (gir)" value={fmt(headingDeg, "°", 0)} />
      <Row label="Kompass-stabilitet" value={`${Math.round(headingStability * 100)}%`} />
      <Row label="Kompassens felmarginal" value={fmt(headingAccuracyDeg, "°", 0)} />
      <Row label="Pitch (lutning)" value={fmt(pitchDeg, "°", 0)} />
      <Row label="Horisontoffset (kalibrering)" value={fmt(horizonOffsetDeg, "°", 1)} />
      <div className="flex items-baseline justify-between gap-3 border-b border-white/5 py-1.5 text-xs">
        <span className="text-white/60">AR-spårningsläge</span>
        <span className={`font-mono ${TIER_COLOR[arTrackingTier]}`}>{TIER_LABEL[arTrackingTier]}</span>
      </div>
      {frozenForMs > 0 && <Row label="Frusen/försämrad i" value={`${(frozenForMs / 1000).toFixed(1)} s`} />}
      <Row label="Synliga verk" value={`${visibleTurbineCount} / ${totalTurbineCount}`} />
      <Row label="Laddade verk" value={`${loadedTurbineCount}`} />
      <Row label="Inom renderavstånd" value={`${withinRangeTurbineCount}`} />
      <Row label="Inom kamerans FOV nu" value={`${inFrontOfCameraCount}`} />
      <Row label="Avstånd till närmaste verk" value={fmt(nearestDistanceM, " m", 0)} />
      <Row label="Bäring till närmaste verk" value={fmt(bearingToNearestDeg, "°", 0)} />
      <Row label="Vinkeldiff kamera↔närmaste verk" value={fmt(angleDiffToNearestDeg, "°", 0)} />

      <div className="mt-2">
        <p className="mb-1 text-xs text-white/60">Döljningsanledningar:</p>
        <ul className="list-inside list-disc text-xs text-white/80">
          {hideReasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
