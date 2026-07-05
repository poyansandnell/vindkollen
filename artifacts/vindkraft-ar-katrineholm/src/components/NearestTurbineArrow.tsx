import { useEffect, useState } from "react";
import { formatDistance } from "@/lib/geo";

// Måste matcha `ARScene.tsx`s kamera-FOV (`FOV_DEGREES`) — annars skulle
// pilen kunna gömma sig (eller visas i onödan) fel jämfört med vad som
// faktiskt syns i AR-vyn just nu.
const FOV_DEGREES = 65;
// Hur ofta pilens riktning uppdateras. Sänkt (juli 2026 regressionsrapport,
// produktkrav "pilen ska uppdateras 30-60 ggr/s") från 80ms (~12/s) till
// 20ms (~50/s) — 80ms upplevdes fortfarande som att pilen "bara beräknades
// en gång" jämfört med den 30-60Hz-uppdaterade AR-scenen runt omkring den.
// Fortfarande ett enkelt intervall (inte requestAnimationFrame) eftersom
// mänsklig handrörelse ändå inte kräver bildruteexakt uppdatering, och
// undviker att re-rendera `Home.tsx`s stora komponentträd i onödan — men
// tätt nog att kännas lika responsiv som scenen.
const POLL_INTERVAL_MS = 20;
// Vinkeln pilen roterar per grad avvikelse utanför synfältet — ger en
// proportionell (inte bara binär vänster/höger) rotation, så pilen tydligt
// "följer med" när man vrider mobilen mot målet istället för att bara peka
// i en fast ±90°-vinkel oavsett hur nära man redan pekar rätt.
const MAX_ARROW_ROTATION_DEG = 80;

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
   * Pollas här (inte prenumererat via re-render) av samma prestandaskäl som
   * tidigare.
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
 * Pollar `headingDegRef` med ett enkelt `setInterval` (inte varje
 * sensor-event) eftersom pilens rotation bara behöver kännas responsiv för
 * ett öga, inte vara bildrutexakt — och undviker att trigga en re-render av
 * hela `Home.tsx` för varje kompassavläsning.
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
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (bearingDeg === null) {
      setDiffDeg(null);
      return;
    }
    const update = () => {
      const heading = getCurrentHeading();
      setDiffDeg(heading === null ? null : circularDiffDeg(bearingDeg, heading));
    };
    update();
    const id = window.setInterval(update, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
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

  const pointsRight = diffDeg > 0;
  // Proportionell rotation: nära 0° avvikelse (nästan i mål) ger en liten
  // vinkel, nära/över 180° (målet nästan bakom en) ger den maximala
  // vinkeln — så pilen synligt "svänger med" i realtid istället för att
  // hoppa mellan två fasta lägen (produktkrav: "tydligt rotera åt rätt håll").
  const rotationDeg =
    (pointsRight ? 1 : -1) * (10 + (MAX_ARROW_ROTATION_DEG - 10) * Math.min(1, Math.abs(diffDeg) / 180));

  return (
    <div
      className={`pointer-events-none absolute top-1/2 z-50 flex -translate-y-1/2 flex-col items-center gap-1.5 transition-opacity duration-500 ${
        pointsRight ? "right-3" : "left-3"
      } ${onTarget ? "opacity-0" : "opacity-100"}`}
    >
      <div
        className="flex h-11 w-11 items-center justify-center rounded-full bg-[#FF8B01]/90 text-xl text-[#090909] shadow-lg shadow-[#FF8B01]/30 transition-transform duration-150 ease-out"
        style={{ transform: `rotate(${rotationDeg}deg)` }}
      >
        ➜
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
