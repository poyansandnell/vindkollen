interface LiveDebugStripProps {
  fps: number;
  frameCount: number;
  headingDeg: number | null;
  bearingToNearestDeg: number | null;
  angleDiffToNearestDeg: number | null;
  gpsAccuracyM: number | null;
  headingAccuracyDeg: number | null;
  renderedTurbineCount: number;
  visibleTurbineCount: number;
  /**
   * Produktkrav 6 (juli 2026, ny omgång): fem nya felsökningsfält.
   * `headingAgeMs`/`headingSource` läses från `useDeviceOrientation`s delade
   * frys-/fallback-skydd (produktkrav 4/5) så man direkt kan se ATT och
   * VARFÖR riktningen bytt källa. `worldUpdated`/`arVisibleTurbineCount`/
   * `screenLocked` läses från `ARScene.getDebugStats()` och bevisar (istället
   * för att bara påstå) att verken räknas om i världsrymd varje bildruta
   * (produktkrav 3) — `screenLocked` är alltid `false` per konstruktion.
   */
  headingAgeMs: number | null;
  headingSource: "compass" | "gyro";
  worldUpdated: boolean;
  arVisibleTurbineCount: number;
  screenLocked: boolean;
}

function fmt(value: number | null, unit: string, digits = 0): string {
  return value === null ? "–" : `${value.toFixed(digits)}${unit}`;
}

function yesNo(value: boolean): string {
  return value ? "ja" : "nej";
}

/**
 * Juli 2026-fix (regressionsrapport punkt 8: "en alltid synlig felsöknings-
 * text ska finnas, inte bara den togglebara `SensorDebugPanel`") — en liten,
 * permanent, icke-interaktiv textrad som ALLTID visas under en AR-session
 * (oavsett `showSensorDebug`), så man direkt kan se att renderloopen faktiskt
 * lever (stigande `Bildruta`/rimlig FPS) utan att behöva öppna någon panel.
 * Medvetet monospace/kompakt och `pointer-events-none` så den aldrig kan
 * konkurrera om tryck/interaktion med resten av AR-vyn.
 */
export function LiveDebugStrip({
  fps,
  frameCount,
  headingDeg,
  bearingToNearestDeg,
  angleDiffToNearestDeg,
  gpsAccuracyM,
  headingAccuracyDeg,
  renderedTurbineCount,
  visibleTurbineCount,
  headingAgeMs,
  headingSource,
  worldUpdated,
  arVisibleTurbineCount,
  screenLocked,
}: LiveDebugStripProps) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-[60] flex justify-center px-2 pt-[max(0.25rem,env(safe-area-inset-top))]">
      <div className="max-w-full overflow-x-auto whitespace-nowrap rounded-md bg-black/60 px-2 py-1 font-mono text-[9px] leading-tight text-lime-300/90 backdrop-blur-sm">
        FPS {fps} · Bildruta {frameCount} · Riktning {fmt(headingDeg, "°")} · Bäring {fmt(bearingToNearestDeg, "°")} · Δ{" "}
        {fmt(angleDiffToNearestDeg, "°")} · GPS ±{fmt(gpsAccuracyM, "m")} · Kompass ±{fmt(headingAccuracyDeg, "°")} · Verk{" "}
        {visibleTurbineCount}/{renderedTurbineCount} · Riktningsålder {fmt(headingAgeMs, "ms")} · Källa{" "}
        {headingSource === "compass" ? "kompass" : "gyro"} · Världsuppdatering {yesNo(worldUpdated)} · Synliga verk{" "}
        {arVisibleTurbineCount} · Skärmlåst {yesNo(screenLocked)}
      </div>
    </div>
  );
}
