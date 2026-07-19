import { useEffect, useRef, useState } from "react";
import { FeatureTicker } from "@/components/FeatureTicker";

interface LoadingSequenceProps {
  onComplete: () => void;
  /** Vilket kalibreringssteg som just nu pågår (se `useDeviceOrientation.ts`). */
  calibrationPhase: "flat" | "vertical" | "done";
  /** 0..1 — hur stor del av det AKTUELLA stegets riktningssektorer som redan svepts. */
  calibrationProgress: number;
  /**
   * Sant om kompasskalibrering inte kan genomföras alls (t.ex.
   * `DeviceOrientationEvent` saknas, eller behörigheten nekades) — då hoppar
   * sekvensen förbi kalibreringssteget helt och går direkt till
   * nedräkningen, istället för att fastna på ett steg som aldrig kan bli
   * klart. Det faktiska felet (behörighet nekad etc.) visas ändå av
   * `Home.tsx`s befintliga felhantering efter att den här sekvensen stängts.
   */
  skipCalibration: boolean;
  /** V24: Hoppa över HELA sekvensen (kalibr + checklist) och anropa onComplete direkt. */
  skipEntireSequence?: boolean;
}

// Om en enskild kalibreringsdelfas (liggande/stående) tar ovanligt lång tid
// visas en hjälptext (utan att avbryta väntan) — och som yttersta säkerhet
// (t.ex. en sensor som fastnar helt) går sekvensen ändå vidare efter
// `CALIBRATION_PHASE_MAX_WAIT_MS`, precis som appens övriga sensor-
// watchdogs (se `useCameraStream.ts`/`useGeolocation.ts`).
//
// Juli 2026-fix (regressionsrapport: "renderingen väntar på kalibrering"):
// sänkta kraftigt från 7000/18000ms — denna overlay får ALDRIG vara det som
// får appen att kännas trasig/hängande. `Home.tsx`s `arSessionVisible` beror
// inte längre på att den här sekvensen stängts (rendering/positionering
// pågår redan bakom den), men själva overlayen ska ändå försvinna snabbt så
// användaren snabbt ser den redan levande AR-vyn. Ett explicit
// "Hoppa över"-alternativ finns dessutom synligt direkt (se nedan), inte
// bara efter hjälptexten.
const CALIBRATION_PHASE_HINT_MS = 2000;
const CALIBRATION_PHASE_MAX_WAIT_MS = 5000;
// Kort paus så "Kompass kalibrerad ✓" hinner synas innan nedräkningen tar vid.
const CALIBRATION_DONE_PAUSE_MS = 900;

const COUNTDOWN_STAGES = [
  { secondsLeft: 3, message: "📍 Hämtar GPS-position…" },
  { secondsLeft: 2, message: "🛰️ Beräknar din position…" },
  { secondsLeft: 1, message: "🌍 Placerar vindkraftverk och beräknar AR-scenen…" },
] as const;
const COUNTDOWN_STEP_MS = 1000;

const CHECKLIST_ITEMS = [
  "GPS-position hittad",
  "Kompass kalibrerad",
  "Vindkraftverk placerade",
  "Solposition beräknad",
  "Skuggor skapade",
  "Ljudnivå beräknad",
  "AR-objekt laddade",
];
// 150–300ms per punkt, enligt produktkravet — 220ms ligger mitt i intervallet.
const CHECKLIST_STEP_MS = 220;
const CHECKLIST_DONE_PAUSE_MS = 500;

function CalibrationStep({
  active,
  done,
  rotateClass,
  label,
  instruction,
  progress,
}: {
  active: boolean;
  done: boolean;
  rotateClass: string;
  label: string;
  instruction: string;
  progress: number;
}) {
  return (
    <div
      className={`rounded-xl border p-3 text-left transition-colors ${
        active ? "border-[#4DA6FF]/40 bg-[#4DA6FF]/5" : done ? "border-white/10 bg-white/5" : "border-white/5 opacity-40"
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center text-2xl ${rotateClass} ${
            active ? "animate-spin [animation-duration:2.2s]" : ""
          }`}
          aria-hidden="true"
        >
          📱
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-white">{label}</p>
          <p className="text-xs text-white/60">{instruction}</p>
        </div>
        <span className={done ? "text-lg text-[#4DA6FF]" : "text-lg text-white/20"} aria-hidden="true">
          {done ? "✅" : "⬜️"}
        </span>
      </div>
      {active && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-[#4DA6FF] transition-all duration-200 ease-linear"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function LoadingSequence({
  onComplete,
  calibrationPhase,
  calibrationProgress,
  skipCalibration,
  skipEntireSequence = false,
}: LoadingSequenceProps) {
  const [uiPhase, setUiPhase] = useState<"calibration" | "countdown" | "checklist">(
    skipCalibration ? "countdown" : "calibration",
  );
  const [countdownIndex, setCountdownIndex] = useState(0);
  const [checkedCount, setCheckedCount] = useState(0);
  const [showCalibrationHint, setShowCalibrationHint] = useState(false);
  const calibrationPhaseEnteredAtRef = useRef(Date.now());

  // V24: Hoppa över hela sekvensen omedelbart om skipEntireSequence=true.
  // Används vid återbesök (hasOnboarded=true i Home.tsx) så att laddnings-
  // overlayen aldrig visas igen. onComplete() triggar handleLoadingSequenceComplete
  // som sätter arStartedAtMs (force-visible-timern) precis som vanligt.
  useEffect(() => {
    if (skipEntireSequence) onComplete();
  }, [skipEntireSequence, onComplete]);

  // Nollställ hjälptexten och tidsstämpeln varje gång kalibreringen går in
  // i ett nytt delsteg (liggande -> stående), så maxväntetiden räknas per
  // steg och inte ackumulerat över hela kalibreringen.
  useEffect(() => {
    calibrationPhaseEnteredAtRef.current = Date.now();
    setShowCalibrationHint(false);
  }, [calibrationPhase]);

  // Kalibreringsfasen: gå vidare till nedräkningen så fort BÅDA delstegen är
  // klara (`calibrationPhase === "done"`), efter en kort paus så "Kompass
  // kalibrerad ✓" hinner synas. Annars (fortfarande "flat"/"vertical")
  // bevakas en hjälptext + en yttersta maxväntetid per delsteg, så en enhet
  // utan fungerande/tillgänglig kompass ändå tar sig vidare.
  useEffect(() => {
    if (uiPhase !== "calibration") return;

    if (calibrationPhase === "done") {
      const id = window.setTimeout(() => setUiPhase("countdown"), CALIBRATION_DONE_PAUSE_MS);
      return () => window.clearTimeout(id);
    }

    const id = window.setInterval(() => {
      const elapsed = Date.now() - calibrationPhaseEnteredAtRef.current;
      if (elapsed >= CALIBRATION_PHASE_HINT_MS) setShowCalibrationHint(true);
      if (elapsed >= CALIBRATION_PHASE_MAX_WAIT_MS) {
        window.clearInterval(id);
        setUiPhase("countdown");
      }
    }, 300);
    return () => window.clearInterval(id);
  }, [uiPhase, calibrationPhase]);

  // Nedräkningsfasen: fast 3-2-1, ~1s per steg, sedan vidare till checklistan.
  useEffect(() => {
    if (uiPhase !== "countdown") return;
    if (countdownIndex >= COUNTDOWN_STAGES.length) {
      setUiPhase("checklist");
      return;
    }
    const id = window.setTimeout(() => setCountdownIndex((i) => i + 1), COUNTDOWN_STEP_MS);
    return () => window.clearTimeout(id);
  }, [uiPhase, countdownIndex]);

  // Checklistefasen: bocka av punkter var 150–300ms, avsluta hela sekvensen
  // (onComplete) sist av allt — Home.tsx:s befintliga `ready`-baserade
  // väntar-overlay tar därefter vid om den riktiga GPS/kompass/kamera-
  // statusen inte redan hunnit bli klar, exakt som innan.
  useEffect(() => {
    if (uiPhase !== "checklist") return;
    if (checkedCount >= CHECKLIST_ITEMS.length) {
      const id = window.setTimeout(onComplete, CHECKLIST_DONE_PAUSE_MS);
      return () => window.clearTimeout(id);
    }
    const id = window.setTimeout(() => setCheckedCount((c) => c + 1), CHECKLIST_STEP_MS);
    return () => window.clearTimeout(id);
  }, [uiPhase, checkedCount, onComplete]);

  const countdownStage = COUNTDOWN_STAGES[Math.min(countdownIndex, COUNTDOWN_STAGES.length - 1)];

  return (
    // Juli 2026-fix (regressionsrapport: "renderingen väntar på
    // kalibrering"/"UI ligger ovanpå varandra"): höjt från z-40 till z-[70] —
    // MÅSTE ligga strikt ovanför ALLA AR-HUD-element (topp-/bottenraden
    // z-45, pilen/målbekräftelsen z-50) eftersom `Home.tsx`s `arSessionVisible`
    // inte längre väntar in att den här sekvensen stängs. AR-scenen (kamera,
    // turbiner, HUD) renderas alltså redan LIVE bakom denna overlay hela
    // tiden — ett lägre z-index skulle låta HUD:en blöda igenom ovanpå
    // kalibreringsskärmen precis som den ursprungliga bug-rapporten (som
    // ledde till `!showLoadingSequence`-spärren) beskrev.
    <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-[#090909] px-6 text-center text-white">
      {uiPhase === "calibration" && (
        <div className="mx-auto w-full max-w-md">
          <p className="text-xs font-medium uppercase tracking-wide text-[#FFB347]">Katrineholm FRAMÅT</p>
          <h1 className="mt-1 text-2xl font-bold leading-tight text-white">Kalibrera kompassen</h1>
          <p className="mt-3 text-sm text-white/70">
            För bästa precision behöver telefonens kompass kalibreras innan AR startar.
          </p>

          <div className="mt-6 space-y-3">
            <CalibrationStep
              active={calibrationPhase === "flat"}
              done={calibrationPhase !== "flat"}
              rotateClass="rotate-90"
              label="1. Liggande telefon"
              instruction="Vrid telefonen långsamt liggande."
              progress={calibrationPhase === "flat" ? calibrationProgress : 1}
            />
            <CalibrationStep
              active={calibrationPhase === "vertical"}
              done={calibrationPhase === "done"}
              rotateClass=""
              label="2. Stående telefon"
              instruction="Vrid nu telefonen stående."
              progress={calibrationPhase === "vertical" ? calibrationProgress : calibrationPhase === "done" ? 1 : 0}
            />
          </div>

          <p className="mt-5 min-h-[1.25rem] text-sm font-semibold text-[#4DA6FF]" aria-live="polite">
            {calibrationPhase === "done" ? "Kompass kalibrerad ✓" : "\u00a0"}
          </p>

          {showCalibrationHint && calibrationPhase !== "done" && (
            <p className="mt-1 text-[11px] text-white/40" aria-live="polite">
              Tar det lång tid? Se till att telefonen inte ligger nära metall eller elektronik, och fortsätt vrida den.
            </p>
          )}

          {/* Juli 2026-fix (regressionsrapport punkt 1: "renderingen får
              aldrig blockeras av kalibrering"): tidigare dök detta knapp
              FÖRST upp efter `CALIBRATION_PHASE_HINT_MS` — under tiden hade
              användaren inget sätt att hoppa förbi kalibreringsskärmen alls.
              Synlig direkt nu, hela kalibreringsfasen igenom, så vem som
              helst kan hoppa till den redan levande AR-vyn omedelbart. */}
          {calibrationPhase !== "done" && (
            <button
              onClick={() => setUiPhase("countdown")}
              className="mt-3 rounded-full border border-white/20 bg-white/5 px-4 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10"
            >
              Hoppa över →
            </button>
          )}
        </div>
      )}

      {uiPhase === "countdown" && (
        <div className="mx-auto w-full max-w-md">
          <p className="text-xs font-medium uppercase tracking-wide text-[#FFB347]">Katrineholm FRAMÅT</p>
          <h1 className="mt-1 text-2xl font-bold leading-tight text-white">Vindkraftsparken</h1>

          <div className="mx-auto mt-6 flex h-20 w-20 items-center justify-center rounded-full border-4 border-[#FF8B01]/25">
            <span className="text-3xl font-black text-[#FF8B01]" aria-live="polite">
              {countdownStage.secondsLeft}
            </span>
          </div>

          <p className="mt-5 min-h-[3rem] text-sm font-medium leading-relaxed text-white/90" aria-live="polite">
            {countdownStage.message}
          </p>

          <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-[#FF8B01] transition-all duration-500 ease-linear"
              style={{ width: `${(countdownIndex / COUNTDOWN_STAGES.length) * 100}%` }}
            />
          </div>
        </div>
      )}

      {uiPhase === "checklist" && (
        <div className="mx-auto w-full max-w-md">
          <p className="text-xs font-medium uppercase tracking-wide text-[#FFB347]">Katrineholm FRAMÅT</p>
          <h1 className="mt-1 text-2xl font-bold leading-tight text-white">Vindkraftsparken</h1>
          <p className="mt-5 text-sm font-medium text-white/90" aria-live="polite">
            {checkedCount >= CHECKLIST_ITEMS.length ? "✅ Visualiseringen är redo. Startar AR…" : "Färdigställer visualiseringen…"}
          </p>

          <ul className="mt-6 space-y-2 text-left">
            {CHECKLIST_ITEMS.map((item, i) => {
              const checked = i < checkedCount;
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
      )}

      {/*
        Snabbt rullande funktionslista över hela startsekvensen, så
        väntetiden fylls med information om vad appen faktiskt kan istället
        för att kännas overksam.
      */}
      <FeatureTicker />
    </div>
  );
}
