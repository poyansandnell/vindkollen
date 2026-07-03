import { useEffect, useState } from "react";

interface LoadingSequenceProps {
  onComplete: () => void;
}

// Varje steg visas i ~1 sekund (sista steget, "0 sekunder", visas något
// kortare eftersom det bara är en avslutande bekräftelse innan AR-vyn tar
// över) — totalt ca 5 sekunder, enligt kravet "räkna ner från 5 till 0".
// `checkedUpTo` anger hur många punkter i checklistan (se `CHECKLIST_ITEMS`
// nedan) som ska vara avbockade MEDAN detta steg visas, dvs. resultatet av
// föregående steg.
const STAGES = [
  { secondsLeft: 5, message: "📍 Hämtar din GPS-position…", checkedUpTo: 0, durationMs: 1000 },
  { secondsLeft: 4, message: "🧭 Kalibrerar kompass och kamerans riktning…", checkedUpTo: 1, durationMs: 1000 },
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

export function LoadingSequence({ onComplete }: LoadingSequenceProps) {
  const [stageIndex, setStageIndex] = useState(0);

  useEffect(() => {
    const stage = STAGES[stageIndex];
    const id = window.setTimeout(() => {
      if (stageIndex >= STAGES.length - 1) {
        onComplete();
      } else {
        setStageIndex((i) => i + 1);
      }
    }, stage.durationMs);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageIndex]);

  const stage = STAGES[stageIndex];

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

        <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-[#FF8B01] transition-all duration-500 ease-linear"
            style={{ width: `${((5 - stage.secondsLeft) / 5) * 100}%` }}
          />
        </div>

        <ul className="mt-6 space-y-2 text-left">
          {CHECKLIST_ITEMS.map((item, i) => {
            const checked = i < stage.checkedUpTo;
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
