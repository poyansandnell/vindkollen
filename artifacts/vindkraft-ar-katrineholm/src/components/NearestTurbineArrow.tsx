import { useEffect, useRef, useState } from "react";
import { formatDistance } from "@/lib/geo";

// Måste matcha `ARScene.tsx`s kamera-FOV (`FOV_DEGREES`) — annars skulle
// pilen kunna gömma sig (eller visas i onödan) fel jämfört med vad som
// faktiskt syns i AR-vyn just nu.
const FOV_DEGREES = 65;

// Juli 2026-fix: precis vid start (innan kompassen hunnit "sätta sig", se
// `useDeviceOrientation.ts`s adaptiva utjämning) kan den råa/ännu inte
// utjämnade riktningen råka ligga innanför kamerans synfält av ren slump,
// vilket fick "✓ Du tittar mot närmaste verk"-bekräftelsen (och pilen) att
// dyka upp direkt vid appstart — förvirrande, den ska komma senare, när
// riktningen faktiskt går att lita på. Döljs därför helt tills antingen
// kompassens kvalitet (`compassQualityPercent`, se `useArTrackingStability`)
// når en rimlig nivå, ELLER en maxgräns hunnit gå ut (om kompassen aldrig
// stabiliseras helt ska pilen ändå till slut dyka upp, inte vara dold för
// evigt).
const MIN_SETTLE_COMPASS_QUALITY_PERCENT = 45;
// Juli 2026 regressionsrapport: sänkt från 4000ms — pilen ska "börja rotera
// direkt när telefonen vrids", inte kännas som att den väntar in en
// kalibrering. Kvalitetströskeln ovan (nås oftast på under en sekund) är
// fortfarande den normala vägen ut ur väntan; denna timeout är bara den
// yttersta säkerheten för enheter med en riktigt dålig magnetometer.
const MAX_SETTLE_WAIT_MS = 1200;

function circularDiffDeg(target: number, current: number): number {
  return ((target - current + 540) % 360) - 180;
}

interface NearestTurbineArrowProps {
  /**
   * Produktkrav 5 (juli 2026, ny omgång): läses via `useDeviceOrientation`s
   * delade `getCurrentHeading()`-funktion istället för att pollas direkt ur
   * en egen ref-prop — samma funktion som AR-scenens bäringsjämförelser
   * anropar, så pilen och AR-vyn ALDRIG kan råka bygga på olika riktningar.
   * Läses varje `requestAnimationFrame`-tick (inte prenumererat via
   * re-render) av prestandaskäl.
   */
  getCurrentHeading: () => number | null;
  /** Bäring (grader, 0=norr) från användaren till närmaste verk, eller `null` om GPS-fix saknas. */
  bearingDeg: number | null;
  /** Avstånd i meter till närmaste verk, eller `null` om GPS-fix saknas. */
  distanceM: number | null;
  /** True när kameran bedöms sakna fri sikt (inomhus/vägg) — byter till en förklarande instruktionstext istället för "Vrid mobilen". */
  indoors: boolean;
  /**
   * 0-100, se `useArTrackingStability`s `compassQualityPercent` — används
   * bara för att fördröja den FÖRSTA visningen (se `MIN_SETTLE_COMPASS_QUALITY_PERCENT`
   * ovan) så indikatorn inte hinner visa en falsk "rätt riktning" innan
   * kompassen satt sig. Saknas prop (`undefined`) tolkas som "vänta på
   * timeout" (aldrig redo via kvalitet), inte som 0% — annars skulle en
   * konsument som glömmer skicka prop:en aldrig kunna se pilen förrän
   * `MAX_SETTLE_WAIT_MS`.
   */
  compassQualityPercent?: number;
  /**
   * Juli 2026-fix (produktkrav 2, "endast EN statusruta åt gången"): denna
   * komponent visade tidigare sin egen "✓ Du tittar mot närmaste verk"-
   * bekräftelseruta oberoende av alla andra statusrutor i `Home.tsx`, vilket
   * kunde stapla flera rutor samtidigt. `onTarget`-tillståndet lyfts nu upp
   * hit så `Home.tsx` kan väga in det i EN enda prioriterad statusruta —
   * denna komponent renderar därför numera BARA själva pilen.
   */
  onTargetChange?: (onTarget: boolean) => void;
}

/**
 * Alltid-tillgänglig pil som pekar mot närmaste vindkraftverk, även när det
 * är utanför kamerans synfält, ockluderat, eller användaren är inomhus utan
 * fri sikt (då AR-scenen inte ritar ut några verk alls, se `Home.tsx`s
 * `hideAll`). Bygger bara på GPS-bäring + kompassriktning — helt oberoende
 * av kamerabildens himmel-heuristik, så den fungerar även när den stora
 * inomhus-overlayen täcker skärmen.
 *
 * Juli 2026-fix ("pilen känns fast nere i hörnet, roterar inte med
 * telefonen"): den gamla versionen hade TVÅ separata buggar som tillsammans
 * gjorde pilen kännas låst:
 *  1. Den bytte mellan två FASTA CSS-positioner (`right-3`/`left-3`) istället
 *     för att rotera fritt runt en enda fast punkt — så ett kast förbi ±90°
 *     avvikelse hoppade pilen tvärt till andra sidan skärmen istället för att
 *     svepa dit.
 *  2. Ikonens egen rotation klipptes till ett ±80°-intervall
 *     (`MAX_ARROW_ROTATION_DEG`) istället för att visa den FULLA
 *     `diffDeg`-vinkeln — så en avvikelse på t.ex. 150° visades som samma
 *     ~80° som en avvikelse på 179°, vilket kändes som att pilen "slutade
 *     följa med" ju mer man vred bort.
 *
 * Fixen: EN fast förankringspunkt (höger kant, mitten), och ikonen roterar
 * hela vägen 0–360° i realtid utifrån den råa `diffDeg = bearingDeg -
 * heading`. Rotationen ackumuleras i en ref (`rotationRef`) istället för att
 * sättas direkt till `diffDeg` varje tick — annars skulle CSS `rotate()`
 * ta en visuell "genväg" och snurra åt fel håll/hoppa vid ±180°-omslaget
 * (t.ex. gå från 179° till -179° ser ut som ett minus-358°-hopp om man inte
 * själv väljer den kortaste vägen och lägger till den på en obruten,
 * monotont växande/minskande vinkel).
 */
export function NearestTurbineArrow({
  getCurrentHeading,
  bearingDeg,
  distanceM,
  indoors,
  compassQualityPercent,
  onTargetChange,
}: NearestTurbineArrowProps) {
  const [diffDeg, setDiffDeg] = useState<number | null>(null);
  const [rotationDeg, setRotationDeg] = useState(0);
  const [settled, setSettled] = useState(false);

  // Ackumulerad, obruten rotation (kan bli t.ex. 370° eller -25° — inte
  // klippt till 0–360) som `rotate()`-transformen sätts till. Håller
  // egen state utanför React (en ref) eftersom den uppdateras varje
  // animationsruta, inte varje render.
  const rotationRef = useRef(0);
  const hasRotationRef = useRef(false);

  useEffect(() => {
    let rafId: number;

    const tick = () => {
      if (bearingDeg === null) {
        setDiffDeg(null);
        hasRotationRef.current = false;
        rafId = requestAnimationFrame(tick);
        return;
      }

      const heading = getCurrentHeading();
      if (heading === null) {
        setDiffDeg(null);
        hasRotationRef.current = false;
        rafId = requestAnimationFrame(tick);
        return;
      }

      const diff = circularDiffDeg(bearingDeg, heading);
      setDiffDeg(diff);

      // Första giltiga avläsningen: initiera rotationen direkt på `diff`
      // (ingen ackumulering att göra än) så pilen inte behöver "hinna ikapp"
      // från 0° vid start.
      if (!hasRotationRef.current) {
        rotationRef.current = diff;
        hasRotationRef.current = true;
      } else {
        // Kortaste-vägen-delta mot den ACKUMULERADE rotationen (inte mot
        // föregående `diff`) — så vi alltid lägger till en liten, korrekt
        // riktad justering på en obruten vinkel istället för att hoppa
        // tillbaka in i [-180, 180]-intervallet varje tick.
        const current = rotationRef.current;
        const delta = circularDiffDeg(diff, ((current % 360) + 360) % 360);
        rotationRef.current = current + delta;
      }

      setRotationDeg(rotationRef.current);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [bearingDeg, getCurrentHeading]);

  // Se `MAX_SETTLE_WAIT_MS`-kommentaren ovan: en enkel timeout-fallback så
  // indikatorn garanterat dyker upp även om kompasskvaliteten aldrig når
  // tröskeln (t.ex. enhet utan bra magnetometer).
  useEffect(() => {
    if (settled) return;
    const timeoutId = window.setTimeout(() => setSettled(true), MAX_SETTLE_WAIT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [settled]);

  useEffect(() => {
    if (settled) return;
    if (compassQualityPercent !== undefined && compassQualityPercent >= MIN_SETTLE_COMPASS_QUALITY_PERCENT) {
      setSettled(true);
    }
  }, [settled, compassQualityPercent]);

  // Verket syns redan i AR-vyn (inom synfältet, och inte inomhus/utan fri
  // sikt) — rapporteras uppåt så `Home.tsx` kan visa EN enda prioriterad
  // bekräftelseruta (produktkrav 2) istället för att denna komponent visar
  // sin egen, oberoende av alla andra statusrutor. Måste beräknas (och
  // effekten köras) INNAN early-return nedan, annars skulle `onTargetChange`
  // aldrig få chansen att rapportera "false" när `settled`/`diffDeg`
  // tillfälligt blir ogiltiga (t.ex. GPS-fix förloras en stund).
  const onTarget = settled && diffDeg !== null && distanceM !== null && !indoors && Math.abs(diffDeg) <= FOV_DEGREES / 2;

  useEffect(() => {
    onTargetChange?.(onTarget);
  }, [onTarget, onTargetChange]);

  if (!settled || diffDeg === null || distanceM === null) return null;

  return (
    <div
      className={`pointer-events-none absolute right-3 top-1/2 z-50 flex -translate-y-1/2 flex-col items-center gap-1.5 transition-opacity duration-500 ${
        onTarget ? "opacity-0" : "opacity-100"
      }`}
    >
      <div
        className="flex h-11 w-11 items-center justify-center rounded-full bg-[#FF8B01]/90 text-xl text-[#090909] shadow-lg shadow-[#FF8B01]/30"
        style={{ transform: `rotate(${rotationDeg}deg)` }}
      >
        ↑
      </div>
      <div className="max-w-[9.5rem] rounded-xl bg-black/75 px-2.5 py-1.5 text-center text-[11px] text-white shadow-lg">
        <p className="font-semibold text-[#FFB347]">Närmaste verk</p>
        <p>{formatDistance(distanceM)} bort</p>
        <p className="text-white/70">
          {indoors
            ? "Vindkraftverket ligger åt detta håll – gå utomhus eller mot fri sikt för att se det."
            : "Vrid mobilen åt detta håll"}
        </p>
      </div>
    </div>
  );
}
