/**
 * OutdoorConfirmDialog
 *
 * Visas en gång per dag när AR-läget startas, och frågar om användaren
 * befinner sig utomhus. Svaret påverkar:
 *   - ute  → appen körs normalt
 *   - inne → miljötoggle sätts till "inne" (lägre ljudvolym, visuell varning)
 *
 * Skälen till att fråga:
 *   1. AR-verken är designade för utomhusbruk och kan vara förvirrande inomhus.
 *   2. Kompassens noggrannhet sjunker drastiskt inomhus (magnetiska störningar).
 *   3. Kamerabaserad himmel-detektion fungerar inte inomhus.
 *
 * TTL: 12 timmar (localStorage). Kan stängas utan svar (appen fortsätter normalt).
 */

import { useEffect, useState } from "react";

const STORAGE_KEY = "vindkollen:outdoorConfirmedAt";
const TTL_MS = 12 * 60 * 60 * 1000; // 12 timmar

function needsConfirmation(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return true;
    const ts = parseInt(raw, 10);
    return Date.now() - ts > TTL_MS;
  } catch {
    return true;
  }
}

function markConfirmed() {
  try {
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch {}
}

interface Props {
  /** Ska dialogen ens vara möjlig att visas? Sätts till true när AR startat. */
  started: boolean;
  /** Anropas med true (utomhus) eller false (inomhus) när användaren väljer. */
  onEnvironment: (outdoors: boolean) => void;
}

export function OutdoorConfirmDialog({ started, onEnvironment }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!started) return;
    if (needsConfirmation()) setVisible(true);
  }, [started]);

  function handleChoice(outdoors: boolean) {
    markConfirmed();
    setVisible(false);
    onEnvironment(outdoors);
  }

  function handleDismiss() {
    // Räknas som "utomhus" (positivt antagande) om användaren stänger utan att välja.
    markConfirmed();
    setVisible(false);
    onEnvironment(true);
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-end justify-center pb-8 px-4 pointer-events-none">
      <div
        className="w-full max-w-sm rounded-2xl bg-[#0e2a22]/95 border border-white/20 backdrop-blur-md shadow-2xl p-5 pointer-events-auto"
        role="dialog"
        aria-modal="true"
        aria-label="Bekräfta plats"
      >
        {/* Stäng-knapp */}
        <button
          onClick={handleDismiss}
          className="absolute top-3 right-3 text-white/40 hover:text-white/80 text-xl leading-none"
          aria-label="Stäng"
        >
          ×
        </button>

        {/* Ikon + rubrik */}
        <div className="flex items-start gap-3 mb-3">
          <span className="text-3xl select-none">🌿</span>
          <div>
            <h2 className="font-semibold text-white text-base leading-tight">
              Befinner du dig utomhus?
            </h2>
            <p className="text-white/60 text-sm mt-1 leading-snug">
              AR-läget fungerar bäst utomhus. Inomhus kan kompassen vara unoggrann och vindkraftverken
              hamna fel.
            </p>
          </div>
        </div>

        {/* Knappar */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => handleChoice(true)}
            className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 transition py-3 font-semibold text-white text-sm"
          >
            🌳 Ja, jag är utomhus
          </button>
          <button
            onClick={() => handleChoice(false)}
            className="flex-1 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 transition py-3 font-semibold text-white text-sm"
          >
            🏠 Nej, inomhus
          </button>
        </div>
      </div>
    </div>
  );
}
