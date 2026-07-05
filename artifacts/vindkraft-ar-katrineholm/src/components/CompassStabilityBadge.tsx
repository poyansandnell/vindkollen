interface CompassStabilityBadgeProps {
  /** 0..100, från `useArTrackingStability`s `compassQualityPercent`. */
  percent: number;
}

// Under denna procent visas hjälptexten "Rör mobilen i en åtta..." — samma
// tröskel som produktkravet specificerar.
const LOW_QUALITY_THRESHOLD = 60;
// Grön status kräver klart bättre än "precis över låg"-gränsen, annars
// skulle badgen studsa mellan gult och grönt vid minsta brus runt 60%.
const HIGH_QUALITY_THRESHOLD = 80;

// Juli 2026-fix (regressionsrapport punkt 5: "kompassstatus har försvunnit
// — 🟢 Stabil / 🟡 Kalibreras / 🔴 Instabil ska tillbaka"): badgen visade
// tidigare BARA procenten (t.ex. "Kompass: 82% stabil") utan någon
// kategorisk textetikett. Lägger nu till den efterfrågade klartextetiketten
// bredvid ikonen/procenten — utan att ta bort procenttalet, som fortfarande
// är den mer exakta signalen (produktkrav 2).
function tierFor(percent: number): { className: string; icon: string; label: string } {
  if (percent >= HIGH_QUALITY_THRESHOLD) return { className: "bg-green-500/20 text-green-200", icon: "🟢", label: "Stabil" };
  if (percent >= LOW_QUALITY_THRESHOLD) return { className: "bg-yellow-500/20 text-yellow-200", icon: "🟡", label: "Kalibreras" };
  return { className: "bg-red-500/20 text-red-200", icon: "🔴", label: "Instabil" };
}

/**
 * Liten alltid-synlig, live-uppdaterad badge som visar hur stabil (INTE hur
 * korrekt riktad — se `useDeviceOrientation.ts`s `headingStabilityRef`-jsdoc)
 * kompassavläsningen är just nu, i klartext procent (produktkrav 2). Färgas
 * grön/gul/röd efter kvalitetströskel, och visar en handlingsanvisning
 * ("Rör mobilen i en åtta...") under 60% eftersom en instabil kompass ofta
 * åtgärdas av just den rörelsen (bryter en tillfällig magnetisk låsning).
 */
export function CompassStabilityBadge({ percent }: CompassStabilityBadgeProps) {
  const { className, icon, label } = tierFor(percent);
  return (
    <div className="flex flex-col items-end gap-1">
      <span
        className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium ${className}`}
      >
        <span aria-hidden>{icon}</span>
        Kompass: {label} ({percent}%)
      </span>
      {percent < LOW_QUALITY_THRESHOLD && (
        <span className="max-w-[9.5rem] text-right text-[10px] leading-tight text-yellow-200/90">
          Rör mobilen i en åtta för bättre riktning
        </span>
      )}
    </div>
  );
}
