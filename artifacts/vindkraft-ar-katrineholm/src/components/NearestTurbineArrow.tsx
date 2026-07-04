import { useEffect, useState } from "react";
import { formatDistance } from "@/lib/geo";

// Måste matcha `ARScene.tsx`s kamera-FOV (`FOV_DEGREES`) — annars skulle
// pilen kunna gömma sig (eller visas i onödan) fel jämfört med vad som
// faktiskt syns i AR-vyn just nu.
const FOV_DEGREES = 65;
// Hur ofta pilens riktning uppdateras. Kompassen ändras för långsamt
// (mänsklig handrörelse) för att kräva en full requestAnimationFrame-loop
// — ett enkelt intervall håller UI:t responsivt utan att re-rendera
// `Home.tsx`s stora komponentträd i onödan.
const POLL_INTERVAL_MS = 150;

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
export function NearestTurbineArrow({ headingDegRef, bearingDeg, distanceM, indoors }: NearestTurbineArrowProps) {
  const [diffDeg, setDiffDeg] = useState<number | null>(null);

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

  if (diffDeg === null || distanceM === null) return null;

  // Verket syns redan i AR-vyn (inom synfältet, och inte inomhus/utan fri
  // sikt) — ingen anledning att visa en pil ovanpå det.
  const alreadyOnScreen = !indoors && Math.abs(diffDeg) <= FOV_DEGREES / 2;
  if (alreadyOnScreen) return null;

  const pointsRight = diffDeg > 0;

  return (
    <div
      className={`pointer-events-none absolute top-1/2 z-50 flex -translate-y-1/2 flex-col items-center gap-1.5 ${
        pointsRight ? "right-3" : "left-3"
      }`}
    >
      <div
        className="flex h-11 w-11 items-center justify-center rounded-full bg-[#FF8B01]/90 text-xl text-[#090909] shadow-lg shadow-[#FF8B01]/30"
        style={{ transform: `rotate(${pointsRight ? 90 : -90}deg)` }}
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
