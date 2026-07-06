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
  /**
   * Sjunde kritiska buggrapporten (punkt 3, sensorfusion): sant när
   * gyroskopet (`devicemotion`s `rotationRate`) faktiskt bidrar till hur
   * snabbt en verklig vridning litas på, INTE bara ren kompass-utjämning.
   * Helt separat koncept från `headingSource` ovan (som bara gäller det
   * BEFINTLIGA nödfallback-läget vid en frusen girriktning).
   */
  motionFusionActive: boolean;
  worldUpdated: boolean;
  arVisibleTurbineCount: number;
  screenLocked: boolean;
  /**
   * Juli 2026-fix (SJÄTTE kritiska buggrapporten, punkt 4): produktkravets
   * "Rendering mode: Direkt AR / Stabiliserar / World locked" och
   * "Synliga verk: antal" — läses direkt från `ARScene.getDebugStats()`s
   * `renderMode`/`trueVisibleTurbineCount` (se dess jsdoc), inte från de
   * äldre vinkel-/FOV-baserade talen ovan.
   */
  renderMode: "direct" | "stabilizing" | "world-locked";
  trueVisibleTurbineCount: number;
  /** Avstånd (m) till närmaste verk — produktkravets "Närmaste verk: avstånd + bearing". */
  nearestDistanceM: number | null;
  /**
   * Juli 2026-fix (produktfeedback, ny omgång: "flytta den gröna texten
   * högst upp och flytta ner allt annat"): remsan ligger nu ALLTID överst
   * (precis under `env(safe-area-inset-top)`), och `Home.tsx` mäter i
   * stället DENNA remsans egen höjd via `measureRef` för att skjuta ner
   * topp-baren (logga/badges/knappar) och statusbannern under den — dvs.
   * motsatt riktning mot den tidigare lösningen (som mätte topp-baren och
   * placerade remsan under DEN). `measureRef` sätts på det inre,
   * faktiskt synliga textkortet (inte den yttre `absolute`-positionerade
   * behållaren, som alltid har höjd 0 för en `ResizeObserver` eftersom
   * `position: absolute` tar bort den ur normala flödet).
   */
  measureRef?: React.RefObject<HTMLDivElement | null>;
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
 *
 * Juli 2026-fix (ny omgång): en tidigare fix gated raden bakom
 * `showSensorDebug` efter klagomål på "text i vägen", men användaren saknade
 * sedan den alltid-synliga statusinfon och bad att få tillbaka den, bara
 * mindre. Raden är därför åter ovillkorad, men typsnittsstorlek/padding är
 * sänkt ytterligare (se `text-[6.5px]`/`px-1 py-px` i JSX nedan) jämfört med
 * den ursprungliga versionen, så den tar synligt mindre plats.
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
  motionFusionActive,
  worldUpdated,
  arVisibleTurbineCount,
  screenLocked,
  renderMode,
  trueVisibleTurbineCount,
  nearestDistanceM,
  measureRef,
}: LiveDebugStripProps) {
  const renderModeLabel: Record<"direct" | "stabilizing" | "world-locked", string> = {
    direct: "Direkt AR",
    stabilizing: "Stabiliserar",
    "world-locked": "World locked",
  };
  // Juli 2026-fix (produktfeedback, ny omgång): remsan ligger nu alltid
  // överst, precis under den säkra zonen — `Home.tsx` skjuter i stället ner
  // allt ANNAT (topp-bar, statusbanner) baserat på den här remsans mätta
  // höjd (se `measureRef`s jsdoc i interfacet ovan).
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-[60] flex justify-center px-2"
      style={{ top: "max(0.25rem,env(safe-area-inset-top))" }}
    >
      <div
        ref={measureRef}
        className="max-w-[90vw] flex-wrap rounded bg-black/35 px-1 py-px font-mono text-[6.5px] leading-[1.15] text-lime-300/70 backdrop-blur-sm"
      >
        FPS {fps} · Bildruta {frameCount} · Riktning {fmt(headingDeg, "°")} · Bäring {fmt(bearingToNearestDeg, "°")} · Δ{" "}
        {fmt(angleDiffToNearestDeg, "°")} · GPS ±{fmt(gpsAccuracyM, "m")} · Kompass ±{fmt(headingAccuracyDeg, "°")} · Verk{" "}
        {visibleTurbineCount}/{renderedTurbineCount} · Riktningsålder {fmt(headingAgeMs, "ms")} · Källa{" "}
        {headingSource === "compass" ? "kompass" : "gyro"} · Sensorfusion{" "}
        {motionFusionActive ? "gyro+kompass" : "endast kompass"} · Världsuppdatering {yesNo(worldUpdated)} · Synliga verk{" "}
        {arVisibleTurbineCount} · Skärmlåst {yesNo(screenLocked)} · Rendering mode {renderModeLabel[renderMode]} ·{" "}
        Synliga verk (faktiskt) {trueVisibleTurbineCount} · Närmaste verk {fmt(nearestDistanceM, "m")}/
        {fmt(bearingToNearestDeg, "°")}
      </div>
    </div>
  );
}
