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
//
// Juli 2026-fix (produktkrav 1, ny omgång): etiketterna bytta till
// "bra"/"okej"/"svag" — samma tre trösklar/färger som tidigare, bara
// textetiketten ändrad, eftersom felsökningsraden numera ENDAST ska visa
// "Kompass: bra/okej/svag" istället för den tidigare fristående
// kalibreringsbanderollen ("Kalibrerar visning – rör mobilen i en åtta"),
// som tagits bort helt (se `Home.tsx`).
function tierFor(percent: number): { className: string; icon: string; label: string } {
  if (percent >= HIGH_QUALITY_THRESHOLD) return { className: "bg-green-500/20 text-green-200", icon: "🟢", label: "bra" };
  if (percent >= LOW_QUALITY_THRESHOLD) return { className: "bg-yellow-500/20 text-yellow-200", icon: "🟡", label: "okej" };
  return { className: "bg-red-500/20 text-red-200", icon: "🔴", label: "svag" };
}

/**
 * Liten alltid-synlig, live-uppdaterad badge som visar hur stabil (INTE hur
 * korrekt riktad — se `useDeviceOrientation.ts`s `headingStabilityRef`-jsdoc)
 * kompassavläsningen är just nu, i klartext procent (produktkrav 2). Färgas
 * grön/gul/röd efter kvalitetströskel.
 *
 * Juli 2026-fix (produktkrav 1, ny omgång): den tidigare separata
 * handlingsanvisningen ("Rör mobilen i en åtta...") under badgen är
 * borttagen — felsöknings-/statusraden ska nu ENDAST visa
 * "Kompass: bra/okej/svag", inget extra hjälptextrad bredvid den.
 */
export function CompassStabilityBadge({ percent }: CompassStabilityBadgeProps) {
  const { className, icon, label } = tierFor(percent);
  return (
    <span
      className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium ${className}`}
    >
      <span aria-hidden>{icon}</span>
      Kompass: {label}
    </span>
  );
}
