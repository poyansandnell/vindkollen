import type { ArTrackingTier } from "@/hooks/useArTrackingStability";

interface SensorDebugPanelProps {
  gpsAccuracyM: number | null;
  headingDeg: number | null;
  headingStability: number;
  headingAccuracyDeg: number | null;
  pitchDeg: number | null;
  horizonOffsetDeg: number;
  /** Produktkrav ("Heading updates/sec"): antal orienterings-event senaste sekunden. */
  headingUpdatesPerSecond: number;
  /** Produktkrav ("Last update: Nms"): ms sedan senaste orienterings-event, `null` innan första. */
  lastHeadingUpdateAgeMs: number | null;
  /** Produktkrav: sant när VARKEN gir ELLER pitch/roll rört sig alls trots att event fortfarande kommer in. */
  headingValuesFrozen: boolean;
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
  /** Juli 2026-produktkrav: beräknad ljudnivå (dBA) som volymen ska följa. */
  audioTargetDba: number | null;
  /** Juli 2026-produktkrav: mål-volym (0..1), innan EMA-utjämning. */
  audioTargetVolume: number | null;
  /** Juli 2026-produktkrav: faktiskt applicerad, EMA-utjämnad volym (0..1). */
  audioActualVolume: number | null;
  /** Juli 2026-produktkrav: text som beskriver ljudets utsignal/routing. */
  audioSource: string;
  /**
   * Juli 2026-fix (TREDJE kritiska buggrapporten, punkt 1): tvingar ARScene
   * att alltid rita en gul markör (mark→nav) + röd sfär vid det
   * geometriskt närmaste verkets riktiga världsposition, oavsett
   * ocklusion/himmelsmask/frustum/vinkel — se `ARScene`s `debugForceNearest`-prop.
   */
  debugForceNearest: boolean;
  onToggleDebugForceNearest: () => void;
  /**
   * Juli 2026-fix (TREDJE kritiska buggrapporten, punkt 3): stänger av ALL
   * ocklusion/himmelsmask/AI-segmentering samtidigt (fullständig opacitet
   * på alla verk) för att isolera grundorsaken — se `ARScene`s
   * `disableOcclusion`-prop.
   */
  disableOcclusion: boolean;
  onToggleDisableOcclusion: () => void;
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
  headingUpdatesPerSecond,
  lastHeadingUpdateAgeMs,
  headingValuesFrozen,
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
  audioTargetDba,
  audioTargetVolume,
  audioActualVolume,
  audioSource,
  debugForceNearest,
  onToggleDebugForceNearest,
  disableOcclusion,
  onToggleDisableOcclusion,
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
      <Row label="Heading" value={fmt(headingDeg, "°", 1)} />
      <Row label="Heading updates/sec" value={`${headingUpdatesPerSecond}`} />
      <Row label="Last update" value={lastHeadingUpdateAgeMs === null ? "–" : `${Math.round(lastHeadingUpdateAgeMs)} ms`} />
      {headingValuesFrozen && (
        <div className="flex items-baseline justify-between gap-3 border-b border-white/5 py-1.5 text-xs">
          <span className="text-white/60">Sensorvärden</span>
          <span className="font-mono text-red-400">Fastnade — återansluter…</span>
        </div>
      )}
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

      <div className="mt-2 mb-1 border-t border-white/10 pt-2">
        <p className="mb-1 text-xs text-white/60">🔊 Ljud (juli 2026-fix):</p>
      </div>
      <Row label="dBA (mål)" value={fmt(audioTargetDba, " dBA", 1)} />
      <Row label="Målvolym" value={audioTargetVolume === null ? "–" : `${Math.round(audioTargetVolume * 100)}%`} />
      <Row
        label="Faktisk volym (EMA-utjämnad)"
        value={audioActualVolume === null ? "–" : `${Math.round(audioActualVolume * 100)}%`}
      />
      <div className="flex items-baseline justify-between gap-3 border-b border-white/5 py-1.5 text-xs">
        <span className="text-white/60">Ljudkälla</span>
        <span className="max-w-[60%] text-right font-mono text-white">{audioSource}</span>
      </div>

      <div className="mt-2">
        <p className="mb-1 text-xs text-white/60">Döljningsanledningar:</p>
        <ul className="list-inside list-disc text-xs text-white/80">
          {hideReasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>

      {/* Juli 2026-fix (TREDJE kritiska buggrapporten, punkt 1 & 3): rena
          felsökningsomkopplare, oberoende av alla produktinställningar ovan —
          se resp. props jsdoc i SensorDebugPanelProps. */}
      <div className="mt-3 border-t border-white/10 pt-2">
        <p className="mb-2 text-xs text-white/60">🛠️ Felsökningslägen:</p>
        <div className="flex items-center justify-between gap-3 border-b border-white/5 py-1.5 text-xs">
          <span className="text-white/60">Tvinga markör på närmaste verk</span>
          <button
            onClick={onToggleDebugForceNearest}
            aria-pressed={debugForceNearest}
            className={`rounded-full px-3 py-1 font-mono text-xs ${
              debugForceNearest ? "bg-yellow-400 text-black" : "bg-white/10 text-white hover:bg-white/20"
            }`}
          >
            {debugForceNearest ? "PÅ" : "AV"}
          </button>
        </div>
        <div className="flex items-center justify-between gap-3 border-b border-white/5 py-1.5 text-xs">
          <span className="text-white/60">Stäng av ocklusion/AI-segmentering</span>
          <button
            onClick={onToggleDisableOcclusion}
            aria-pressed={disableOcclusion}
            className={`rounded-full px-3 py-1 font-mono text-xs ${
              disableOcclusion ? "bg-yellow-400 text-black" : "bg-white/10 text-white hover:bg-white/20"
            }`}
          >
            {disableOcclusion ? "PÅ" : "AV"}
          </button>
        </div>
      </div>
    </div>
  );
}
