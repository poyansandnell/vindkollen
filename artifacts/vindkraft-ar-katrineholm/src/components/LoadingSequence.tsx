import { useCallback, useEffect, useRef, useState } from "react";

interface LoadingSequenceProps {
  onComplete: () => void;
  /** 0..1 — hur stor del av åtta-rörelsens riktningssektorer som redan svepts. */
  calibrationProgress: number;
  /** Sant när tillräckligt många sektorer svepts (se `useDeviceOrientation.ts`). */
  calibrationComplete: boolean;
}

// Varje steg visas i ~1 sekund (sista steget, "0 sekunder", visas något
// kortare eftersom det bara är en avslutande bekräftelse innan AR-vyn tar
// över) — förutom kompass-steget (index `COMPASS_STAGE_INDEX`), som INTE
// avancerar på en blind timer: användaren måste faktiskt utföra
// åtta-rörelsen (se `useDeviceOrientation.ts`s sektorspårning) innan appen
// går vidare, annars skulle "kalibrera kompassen" bara vara en instruktion
// ingen är tvingad att följa. `durationMs` för det steget fungerar istället
// som en MINSTA visningstid (så meddelandet hinner läsas även om
// kalibreringen råkar bli klar direkt) — se `CALIBRATION_MAX_WAIT_MS` för
// den övre gränsen om sensorn aldrig ger tillräckligt varierande avläsningar
// (t.ex. saknad kompass/testmiljö utan sensorer).
// `checkedUpTo` anger hur många punkter i checklistan (se `CHECKLIST_ITEMS`
// nedan) som ska vara avbockade MEDAN detta steg visas, dvs. resultatet av
// föregående steg.
const COMPASS_STAGE_INDEX = 1;
const CALIBRATION_MAX_WAIT_MS = 10000;

const STAGES = [
  { secondsLeft: 5, message: "📍 Hämtar din GPS-position…", checkedUpTo: 0, durationMs: 1000 },
  {
    secondsLeft: 4,
    message: "🧭 Kalibrera kompassen — rör telefonen i en åtta-rörelse några gånger",
    checkedUpTo: 1,
    durationMs: 1800,
  },
  {
    secondsLeft: 3,
    message: "🌍 Placerar ut 29 vindkraftverk på sina verkliga koordinater…",
    checkedUpTo: 2,
    durationMs: 1000,
  },
  { secondsLeft: 2, message: "☀️ Beräknar sol, skuggor, ljudnivå och perspektiv…", checkedUpTo: 3, durationMs: 1000 },
  {
    secondsLeft: 1,
    message: "🎧 Laddar AR-visualisering, rotoranimationer och hinderljus…",
    checkedUpTo: 6,
    durationMs: 1000,
  },
  { secondsLeft: 0, message: "✅ Visualiseringen är redo. Startar AR…", checkedUpTo: 7, durationMs: 600 },
] as const;

const CHECKLIST_ITEMS = [
  "GPS-position hittad",
  "Kompass kalibrerad",
  "Vindkraftverk placerade",
  "Solposition beräknad",
  "Skuggor och skuggflimmer skapade",
  "Ljudnivå beräknad",
  "AR-objekt laddade",
];

export function LoadingSequence({ onComplete, calibrationProgress, calibrationComplete }: LoadingSequenceProps) {
  const [stageIndex, setStageIndex] = useState(0);
  const stageEnteredAtRef = useRef(Date.now());

  const advance = useCallback(() => {
    setStageIndex((i) => {
      if (i >= STAGES.length - 1) {
        onComplete();
        return i;
      }
      return i + 1;
    });
  }, [onComplete]);

  useEffect(() => {
    stageEnteredAtRef.current = Date.now();
  }, [stageIndex]);

  useEffect(() => {
    if (stageIndex !== COMPASS_STAGE_INDEX) {
      const stage = STAGES[stageIndex];
      const id = window.setTimeout(advance, stage.durationMs);
      return () => window.clearTimeout(id);
    }

    // Kompass-steget: kontrollera periodiskt om BÅDE minsta visningstiden
    // gått OCH kalibreringen faktiskt är klar (`calibrationComplete`),
    // annars fortsätt vänta — dock aldrig längre än `CALIBRATION_MAX_WAIT_MS`,
    // så en telefon utan fungerande kompasssensor (eller en testmiljö helt
    // utan sensorer) inte fastnar här för alltid.
    const minDisplayMs = STAGES[COMPASS_STAGE_INDEX].durationMs;
    const id = window.setInterval(() => {
      const elapsed = Date.now() - stageEnteredAtRef.current;
      const minTimeReached = elapsed >= minDisplayMs;
      if ((calibrationComplete && minTimeReached) || elapsed >= CALIBRATION_MAX_WAIT_MS) {
        window.clearInterval(id);
        advance();
      }
    }, 150);
    return () => window.clearInterval(id);
  }, [stageIndex, calibrationComplete, advance]);

  const stage = STAGES[stageIndex];
  const isCalibrating = stageIndex === COMPASS_STAGE_INDEX;

  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-[#090909] px-6 text-center text-white">
      <div className="mx-auto w-full max-w-md">
        <p className="text-xs font-medium uppercase tracking-wide text-[#FFB347]">Katrineholm FRAMÅT</p>
        <h1 className="mt-1 text-2xl font-bold leading-tight text-white">Vindkraftsparken</h1>

        <div className="mx-auto mt-6 flex h-20 w-20 items-center justify-center rounded-full border-4 border-[#FF8B01]/25">
          <span className="text-3xl font-black text-[#FF8B01]" aria-live="polite">
            {stage.secondsLeft}
          </span>
        </div>

        <p className="mt-5 min-h-[3rem] text-sm font-medium leading-relaxed text-white/90" aria-live="polite">
          {stage.message}
        </p>

        {/*
          Under kompass-steget visas ett levande kalibreringsförlopp (hur
          stor del av åtta-rörelsen som registrerats) istället för/utöver
          den vanliga sekundräkningen, så användaren ser att appen faktiskt
          väntar på en riktig rörelse — inte bara en godtycklig paus.
        */}
        {isCalibrating && (
          <div className="mt-3">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-[#4DA6FF] transition-all duration-200 ease-linear"
                style={{ width: `${Math.round(calibrationProgress * 100)}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-white/40" aria-live="polite">
              {calibrationComplete
                ? "Kompassen kalibrerad ✓"
                : `Kalibrering: ${Math.round(calibrationProgress * 100)}%`}
            </p>
          </div>
        )}

        <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-[#FF8B01] transition-all duration-500 ease-linear"
            style={{ width: `${((5 - stage.secondsLeft) / 5) * 100}%` }}
          />
        </div>

        <ul className="mt-6 space-y-2 text-left">
          {CHECKLIST_ITEMS.map((item, i) => {
            const checked = i < stage.checkedUpTo || (i === 1 && calibrationComplete);
            return (
              <li
                key={item}
                className={`flex items-center gap-2 text-sm transition-colors duration-300 ${
                  checked ? "text-white" : "text-white/30"
                }`}
              >
                <span className={checked ? "text-[#FF8B01]" : "text-white/20"}>{checked ? "✅" : "⬜️"}</span>
                <span>{item}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
