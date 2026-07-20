import { useState } from "react";
import type { FactorScore, HouseholdTierKey, PlacementScoreResult } from "@/lib/placementScoring";
import { PLACEMENT_DISCLAIMER } from "@/lib/placementScoring";
import { ERICSBERG_AREA_DISCLAIMER } from "@/lib/ericsbergArea";

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

type Severity = "green" | "yellow" | "orange" | "red";

function getSeverity(points: number): Severity {
  if (points <= 0) return "green";
  if (points < 10) return "yellow";
  if (points < 25) return "orange";
  return "red";
}

const SEVERITY_ORDER: Record<Severity, number> = { red: 0, orange: 1, yellow: 2, green: 3 };

/** Mappar hushållsnivå-nyckel till severity + ord för boendepåverkan-faktorn. */
const HOUSEHOLD_TIER_SEVERITY: Record<HouseholdTierKey, { severity: Severity; word: string }> = {
  low: { severity: "green", word: "Låg påverkan" },
  viss: { severity: "yellow", word: "Viss påverkan" },
  high: { severity: "orange", word: "Hög påverkan" },
  veryHigh: { severity: "red", word: "Mycket hög påverkan" },
  critical: { severity: "red", word: "Kritisk påverkan" },
  extreme: { severity: "red", word: "Extrem påverkan" },
};

const SEV_CONFIG = {
  green: {
    bg: "rgba(34, 197, 94, 0.12)",
    borderColor: "#22c55e",
    textColor: "#4ade80",
    icon: "✅",
    word: "Bra",
  },
  yellow: {
    bg: "rgba(234, 179, 8, 0.12)",
    borderColor: "#eab308",
    textColor: "#facc15",
    icon: "⚠️",
    word: "Viss påverkan",
  },
  orange: {
    bg: "rgba(249, 115, 22, 0.14)",
    borderColor: "#f97316",
    textColor: "#fb923c",
    icon: "🟠",
    word: "Hög påverkan",
  },
  red: {
    bg: "rgba(239, 68, 68, 0.15)",
    borderColor: "#ef4444",
    textColor: "#f87171",
    icon: "❌",
    word: "Mycket hög påverkan",
  },
} as const;

// ---------------------------------------------------------------------------
// Factor grouping
// ---------------------------------------------------------------------------

const GROUP_CRITICAL = new Set([
  "householdProximity",
  "householdImpact",
  "urbanProximity",
  "urbanCritical",
]);
const GROUP_ENV = new Set(["nature", "cultural", "water", "noise", "visual", "shadowFlicker"]);

function getGroup(key: string): "critical" | "env" | "plan" {
  if (GROUP_CRITICAL.has(key)) return "critical";
  if (GROUP_ENV.has(key)) return "env";
  return "plan";
}

function sortFactors(factors: FactorScore[]): FactorScore[] {
  return [...factors].sort((a, b) => {
    const sevDiff = SEVERITY_ORDER[getSeverity(a.impactPoints)] - SEVERITY_ORDER[getSeverity(b.impactPoints)];
    if (sevDiff !== 0) return sevDiff;
    return b.impactPoints - a.impactPoints;
  });
}

// ---------------------------------------------------------------------------
// Total score display levels (spec: 0-24 / 25-49 / 50-74 / 75-100)
// ---------------------------------------------------------------------------

function totalScoreSeverity(score: number): Severity {
  if (score < 25) return "green";
  if (score < 50) return "yellow";
  if (score < 75) return "orange";
  return "red";
}

const SCORE_LEVEL_LABELS: Record<Severity, string> = {
  green: "Låg påverkan",
  yellow: "Måttlig påverkan",
  orange: "Hög påverkan",
  red: "Mycket hög påverkan",
};

// ---------------------------------------------------------------------------
// Score gradient bar
// ---------------------------------------------------------------------------

function ScoreBar({ score }: { score: number }) {
  const pct = Math.min(Math.max(score, 0), 100);
  return (
    <div className="relative mt-2 h-2 w-full overflow-hidden rounded-full"
      style={{ background: "linear-gradient(to right, #22c55e 0%, #eab308 33%, #f97316 66%, #ef4444 100%)" }}>
      <div
        className="absolute inset-y-0 right-0 rounded-r-full"
        style={{ width: `${100 - pct}%`, background: "rgba(9,9,9,0.65)" }}
      />
      <div
        className="absolute top-1/2 h-3.5 w-[3px] -translate-y-1/2 rounded-full bg-white shadow-md"
        style={{ left: `calc(${pct}% - 1.5px)` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual factor row
// ---------------------------------------------------------------------------

function FactorRow({
  factor,
  severityOverride,
}: {
  factor: FactorScore;
  severityOverride?: { severity: Severity; word: string };
}) {
  const [open, setOpen] = useState(false);
  const sev = severityOverride?.severity ?? getSeverity(factor.impactPoints);
  const c = SEV_CONFIG[sev];
  const word = severityOverride?.word ?? c.word;
  const ptsStr = factor.impactPoints === 0 ? "0.0" : `+${factor.impactPoints.toFixed(1)}`;

  return (
    <button
      onClick={() => setOpen((v) => !v)}
      className="w-full rounded-lg border-l-[3px] px-3 py-2.5 text-left transition-colors hover:brightness-110 active:brightness-95"
      style={{ background: c.bg, borderLeftColor: c.borderColor }}
    >
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5 shrink-0 text-base leading-none" aria-hidden="true">{c.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-medium leading-snug text-white/90">{factor.label}</p>
          <p className="mt-0.5 text-[11px] leading-none" style={{ color: c.textColor }}>
            {word}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="tabular-nums text-xs font-semibold" style={{ color: c.textColor }}>
            {ptsStr}
          </span>
          <span className="text-[10px] text-white/30">{open ? "▲" : "▼"}</span>
        </div>
      </div>
      {open && (
        <p className="mt-2 border-t border-white/10 pt-2 text-[11px] leading-relaxed text-white/55">
          {factor.note}
        </p>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Factor group section
// ---------------------------------------------------------------------------

function FactorGroup({
  title,
  factors,
  factorOverrides,
}: {
  title: string;
  factors: FactorScore[];
  factorOverrides?: Map<string, { severity: Severity; word: string }>;
}) {
  if (factors.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="pt-1 text-[10px] uppercase tracking-widest text-white/35">{title}</p>
      {sortFactors(factors).map((f) => (
        <FactorRow key={f.key} factor={f} severityOverride={factorOverrides?.get(f.key)} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

function Legend() {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
      {(["green", "yellow", "orange", "red"] as Severity[]).map((sev) => {
        const c = SEV_CONFIG[sev];
        return (
          <div key={sev} className="flex items-center gap-1.5 text-[12px]">
            <span className="leading-none" aria-hidden="true">{c.icon}</span>
            <span style={{ color: c.textColor }}>{c.word}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stats boxes (shown when details are open)
// ---------------------------------------------------------------------------

function StatsGrid({ result }: { result: PlacementScoreResult }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div className="rounded-lg bg-white/5 px-2.5 py-2">
        <p className="text-[10px] uppercase tracking-wide text-white/40">Berörda hushåll</p>
        <p className="text-sm font-semibold text-white">{result.householdsAffected}</p>
      </div>
      <div className="rounded-lg bg-white/5 px-2.5 py-2">
        <p className="text-[10px] uppercase tracking-wide text-white/40">Berörda invånare</p>
        <p className="text-sm font-semibold text-white">{result.inhabitantsAffected}</p>
      </div>
      <div className="rounded-lg bg-white/5 px-2.5 py-2">
        <p className="text-[10px] uppercase tracking-wide text-white/40">Snittavstånd närmaste verk</p>
        <p className="text-sm font-semibold text-white">
          {result.avgNearestHouseholdDistanceM !== null
            ? `${(result.avgNearestHouseholdDistanceM / 1000).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} km`
            : "–"}
        </p>
      </div>
      <div className="rounded-lg bg-white/5 px-2.5 py-2">
        <p className="text-[10px] uppercase tracking-wide text-white/40">Påverkansindex</p>
        <p className="text-sm font-semibold text-white">{result.impactIndex}/100</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel component
// ---------------------------------------------------------------------------

interface PlacementScorePanelProps {
  result: PlacementScoreResult;
  minimized: boolean;
  onToggleMinimized: () => void;
  /** Om false filtreras Ericsberg-specifika faktorer och disclaimers bort */
  showEricsbergFeatures?: boolean;
  /** Sann medan platskontext (orter/skyddsområden) laddas — döljer faktorlistan */
  loading?: boolean;
}

export function PlacementScorePanel({ result, minimized, onToggleMinimized, showEricsbergFeatures = true, loading = false }: PlacementScorePanelProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);

  const visibleFactors = showEricsbergFeatures
    ? result.factors
    : result.factors.filter((f) => f.key !== "outsideBoundary");

  // `result.totalScore` har redan minimigolvet från hushållsnivå inbakat (se
  // `scorePlacement()`) och exkluderar aldrig `outsideBoundary` i nationellt
  // läge (faktorn läggs inte till när `ctx` är satt). Tryggt att alltid använda.
  const score = Math.round(result.totalScore);
  const totalSev = totalScoreSeverity(score);
  const totalC = SEV_CONFIG[totalSev];

  // Severity-override för boendepåverkan-faktorn — styr färg/ord baserat på
  // hushållsnivå snarare än enbart faktorpoängen.
  const householdOverride = HOUSEHOLD_TIER_SEVERITY[result.householdTierKey];
  const criticalOverrides = new Map<string, { severity: Severity; word: string }>([
    ["householdImpact", householdOverride],
  ]);

  const top3 = visibleFactors
    .filter((f) => f.impactPoints > 0)
    .sort((a, b) => b.impactPoints - a.impactPoints)
    .slice(0, 3);

  const criticalFactors = visibleFactors.filter((f) => getGroup(f.key) === "critical");
  const envFactors = visibleFactors.filter((f) => getGroup(f.key) === "env");
  const planFactors = visibleFactors.filter((f) => getGroup(f.key) === "plan");

  return (
    <div
      className={`border-t border-white/10 bg-[#0d0d0d] transition-[max-height] duration-300 ease-in-out ${
        minimized ? "max-h-[4.5rem] overflow-hidden" : "max-h-[46dvh] overflow-y-auto lg:max-h-[30dvh]"
      }`}
    >
      <div className="px-4 py-3 space-y-3">

        {/* ── Summary header ── */}
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              <p className="text-[10px] uppercase tracking-widest text-white/40">Placeringens påverkan</p>
              <span className="text-[10px] text-white/20">·</span>
              <p className="text-[10px] text-white/25">Högre poäng = sämre</p>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-2xl font-bold tabular-nums leading-none" style={{ color: totalC.textColor }}>
                {score}
              </span>
              <span className="text-sm text-white/35">/ 100</span>
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                style={{ background: totalC.bg, color: totalC.textColor }}
              >
                {totalC.icon} {SCORE_LEVEL_LABELS[totalSev]}
              </span>
            </div>
            <ScoreBar score={score} />
          </div>
          <button
            onClick={onToggleMinimized}
            title={minimized ? "Visa panelen" : "Minimera panelen"}
            className="shrink-0 rounded-full border border-white/20 bg-white/5 px-2.5 py-2 text-xs text-white/60 hover:bg-white/10"
          >
            {minimized ? "▲" : "▼"}
          </button>
        </div>

        {/* ── Loading state ── */}
        {loading && (
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-xs text-white/50">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
            Hämtar platsdata (orter, naturskydd)…
          </div>
        )}

        {/* ── Top-3 problems ── */}
        {!loading && top3.length > 0 && (
          <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
            <p className="mb-1.5 text-[10px] uppercase tracking-widest text-white/35">Största problemen</p>
            <ul className="space-y-1">
              {top3.map((f) => {
                const c = SEV_CONFIG[getSeverity(f.impactPoints)];
                return (
                  <li key={f.key} className="flex items-center gap-1.5 text-xs">
                    <span className="leading-none" aria-hidden="true">{c.icon}</span>
                    <span className="min-w-0 flex-1 truncate text-white/80">{f.label}</span>
                    <span
                      className="shrink-0 tabular-nums text-[11px] font-semibold"
                      style={{ color: c.textColor }}
                    >
                      +{f.impactPoints.toFixed(1)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* ── Expand / legend controls ── */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDetailsOpen((v) => !v)}
            className="flex-1 rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-left text-xs text-white/65 hover:bg-white/10"
          >
            {detailsOpen ? "Dölj faktorer ▲" : "Visa alla faktorer ▼"}
          </button>
          <button
            onClick={() => setLegendOpen((v) => !v)}
            className="shrink-0 rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/45 hover:bg-white/10"
          >
            {legendOpen ? "Dölj legend ▲" : "Vad betyder färgerna? ▼"}
          </button>
        </div>

        {/* ── Legend ── */}
        {legendOpen && <Legend />}

        {/* ── Factor groups ── */}
        {detailsOpen && (
          <div className="space-y-4">
            <FactorGroup title="Kritiska problem" factors={criticalFactors} factorOverrides={criticalOverrides} />
            <FactorGroup title="Miljö och omgivning" factors={envFactors} />
            <FactorGroup title="Planering och regelverk" factors={planFactors} />
            <StatsGrid result={result} />
            <div className="space-y-1.5 pb-1">
              <p className="text-[11px] leading-relaxed text-white/35">{PLACEMENT_DISCLAIMER}</p>
              {showEricsbergFeatures && (
                <p className="text-[11px] leading-relaxed text-white/35">{ERICSBERG_AREA_DISCLAIMER}</p>
              )}
              <p className="text-[11px] text-white/25">
                Poängen är en illustrativ uppskattning och inte en officiell tillståndsbedömning.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
