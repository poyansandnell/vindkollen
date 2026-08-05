import { useState } from "react";
import {
  NOISE_IMPACT_DISCLAIMER,
  NOISE_IMPACT_LEVEL_COLORS,
  NOISE_IMPACT_LEVEL_LABELS,
  NOISE_IMPACT_SCIENCE_CONTEXT,
  type NoiseImpactResult,
} from "@/lib/noiseImpact";

/**
 * Expanderbar ruta med aktuell forskningskontext om infraljud och buller.
 * Visar texten i stycken baserat på dubbla radbrytningar i NOISE_IMPACT_SCIENCE_CONTEXT.
 */
function ScienceContextBox() {
  const [open, setOpen] = useState(false);
  const paragraphs = NOISE_IMPACT_SCIENCE_CONTEXT.split("\n\n");
  const title = paragraphs[0];
  const body = paragraphs.slice(1);
  return (
    <div className="mt-2 rounded-xl border border-blue-400/20 bg-blue-900/20 p-2.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left text-[10px] font-semibold text-blue-300"
      >
        <span>ℹ️ {title}</span>
        <span className="shrink-0 text-white/40">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {body.map((p) => (
            <p key={p} className="text-[10px] leading-relaxed text-white/60">
              {p}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Kompakt, alltid synlig badge med sammanvägd infraljud-/bullerpåverkan
 * (grön/gul/röd). Tryck för att öppna/stänga den större panelen med
 * detaljerad förklaring + den lugna informationsrutan.
 */
export function NoiseImpactBadge({
  result,
  expanded,
  onToggle,
}: {
  result: NoiseImpactResult;
  expanded: boolean;
  onToggle: () => void;
}) {
  const colors = NOISE_IMPACT_LEVEL_COLORS[result.level];
  return (
    <button
      onClick={onToggle}
      aria-pressed={expanded}
      aria-label="Bullerpåverkan"
      className={`pointer-events-auto flex items-center gap-1 rounded-full bg-black/40 px-2 py-1 text-[10px] font-medium backdrop-blur-sm transition ${expanded ? "ring-1 ring-white/40" : ""}`}
    >
      <span className={colors.text}>{colors.emoji} Buller</span>
    </button>
  );
}

/**
 * Panelen startar kompakt (bara nivå + färg + en "Visa mer"-knapp) och
 * expanderas först på användarens begäran till de detaljerade skälen +
 * den lugna informationsrutan — mindre skärmyta upptagen av
 * standardvyn, enligt användartestningens feedback. Disclaimer-texten är
 * oförändrad ordagrant, se `NOISE_IMPACT_DISCLAIMER` i `lib/noiseImpact.ts`.
 */
export function NoiseImpactPanel({
  result,
  onClose,
}: {
  result: NoiseImpactResult;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const colors = NOISE_IMPACT_LEVEL_COLORS[result.level];

  return (
    <div
      className={`pointer-events-auto w-full rounded-2xl border ${colors.border} ${colors.bg} p-3.5 text-white shadow-xl backdrop-blur-sm`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold tracking-wide text-[#FFB347]">🔊 Buller & störning</p>
        <button
          onClick={onClose}
          aria-label="Dölj bullerpanel"
          className="flex shrink-0 items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-white/25 active:bg-white/30"
        >
          ✕ Dölj
        </button>
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className={`text-lg font-bold ${colors.text}`}>{colors.emoji}</span>
          <span className={`text-sm font-semibold ${colors.text}`}>{NOISE_IMPACT_LEVEL_LABELS[result.level]}</span>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/85 transition hover:bg-white/20"
        >
          {expanded ? "Visa mindre" : "Visa mer"}
        </button>
      </div>

      {expanded && (
        <>
          <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-white/75">
            {result.reasons.map((reason) => (
              <li key={reason}>· {reason}</li>
            ))}
          </ul>

          <p className="mt-2.5 rounded-xl bg-black/25 p-2.5 text-[10px] leading-relaxed text-white/60">
            {NOISE_IMPACT_DISCLAIMER}
          </p>

          {/* Forskningskontext — vad forskningen faktiskt säger om infraljud */}
          <ScienceContextBox />
        </>
      )}
    </div>
  );
}
