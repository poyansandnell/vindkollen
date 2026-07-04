import { useEffect, useState } from "react";
import { formatDistance } from "@/lib/geo";

// Måste matcha `ARScene.tsx`s kamera-FOV (`FOV_DEGREES`) — annars skulle
// pilen kunna gömma sig (eller visas i onödan) fel jämfört med vad som
// faktiskt syns i AR-vyn just nu.
const FOV_DEGREES = 65;
// Hur ofta pilens riktning uppdateras. Sänkt (juli 2026, produktkrav "pilen
// ska tydligt rotera åt rätt håll") från 150ms till 80ms — 150ms kändes
// märkbart hackigt/eftersläpande när man vred mobilen snabbt, trots att
// kompassen i sig hinner ändras betydligt oftare. Fortfarande ett enkelt
// intervall (inte requestAnimationFrame) eftersom mänsklig handrörelse ändå
// inte kräver bildruteexakt uppdatering, och undviker att re-rendera
// `Home.tsx`s stora komponentträd i onödan.
const POLL_INTERVAL_MS = 80;
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
const MAX_SETTLE_WAIT_MS = 4000;

function circularDiffDeg(target: number, current: number): number {
  return ((target - current + 540) % 360) - 180;
}

interface NearestTurbineArrowProps {
  /** Muteras varje sensoravläsning av `useDeviceOrientation` — pollas här istället för att prenumereras på via re-render. */
  headingDegRef: React.MutableRefObject<number | null>;
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
  headingDegRef,
  bearingDeg,
  distanceM,
  indoors,
  compassQualityPercent,
}: NearestTurbineArrowProps) {
  const [diffDeg, setDiffDeg] = useState<number | null>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (bearingDeg === null) {
      setDiffDeg(null);
      return;
    }
    const update = () => {
      const heading = headingDegRef.current;
      setDiffDeg(heading === null ? null : circularDiffDeg(bearingDeg, heading));
    };
    update();
    const id = window.setInterval(update, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [bearingDeg, headingDegRef]);

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

  if (!settled || diffDeg === null || distanceM === null) return null;

  // Verket syns redan i AR-vyn (inom synfältet, och inte inomhus/utan fri
  // sikt) — då tonas pilen ner och byts mot en bekräftelsetext istället för
  // att bara försvinna tvärt (produktkrav: pilen ska tona ner/bytas till
  // text, inte hoppa till att helt sakna feedback).
  const onTarget = !indoors && Math.abs(diffDeg) <= FOV_DEGREES / 2;
  const pointsRight = diffDeg > 0;
  // Proportionell rotation: nära 0° avvikelse (nästan i mål) ger en liten
  // vinkel, nära/över 180° (målet nästan bakom en) ger den maximala
  // vinkeln — så pilen synligt "svänger med" i realtid istället för att
  // hoppa mellan två fasta lägen (produktkrav: "tydligt rotera åt rätt håll").
  const rotationDeg =
    (pointsRight ? 1 : -1) * (10 + (MAX_ARROW_ROTATION_DEG - 10) * Math.min(1, Math.abs(diffDeg) / 180));

  return (
    <>
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

      {/* Bekräftelsetext när mobilen redan pekar rätt — tonas in/ut med
          samma övergång som pilen ovan så växlingen känns mjuk, inte som
          att indikatorn plötsligt bara är där eller borta.
          Juli 2026-fix: flyttad längre ner (från `top-24`/6rem) eftersom
          `Home.tsx`s topp-bar med statusmärken (kompass/sikt/dBA/infraljud)
          plus en eventuell radbrytning ("Vindljud aktivt"/"Nattläge"-taggar)
          ofta blir högre än 6rem, vilket gjorde att bekräftelsen hamnade
          FRAMFÖR (ovanpå) de märkena. Placeras nu tydligt under hela den
          zonen istället. */}
      <div
        className={`pointer-events-none absolute left-1/2 top-[calc(env(safe-area-inset-top)+9.5rem)] z-50 -translate-x-1/2 transition-opacity duration-500 ${
          onTarget ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="rounded-full bg-emerald-500/90 px-4 py-1.5 text-center text-xs font-semibold text-[#062b17] shadow-lg">
          ✓ Du tittar mot närmaste verk ({formatDistance(distanceM)})
        </div>
      </div>
    </>
  );
}
