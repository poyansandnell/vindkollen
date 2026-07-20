interface ArStabilityBadgeProps {
  /**
   * 0..100, från `useArTrackingStability`s `positioningConfidencePercent` —
   * en genuin sammanvägning av GPS-precision, kompass-stabilitet,
   * kompass-precision, gyro-/tiltstabilitet och horisontlåsning. INTE samma
   * tal som styr frysning/uttoning (`debug.combinedQuality`/`tier`) — den
   * smalare säkerhetskritiska signalen förblir oförändrad; denna badge är
   * en bredare, mer ärlig "hur bra är läget just nu"-indikator (produktkrav
   * juli 2026: "AR-stabilitet: 100%" upplevdes missvisande).
   */
  percent: number;
}

// Samma tröskelprincip som `CompassStabilityBadge`/`GpsQualityBadge`.
const HIGH_QUALITY_THRESHOLD = 80;
const LOW_QUALITY_THRESHOLD = 55;

function tierFor(percent: number): { className: string; icon: string } {
  if (percent >= HIGH_QUALITY_THRESHOLD) return { className: "bg-green-500/20 text-green-200", icon: "🟢" };
  if (percent >= LOW_QUALITY_THRESHOLD) return { className: "bg-yellow-500/20 text-yellow-200", icon: "🟡" };
  return { className: "bg-red-500/20 text-red-200", icon: "🔴" };
}

/**
 * Liten alltid-synlig, live-uppdaterad badge som visar den sammanvägda
 * positioneringskonfidensen (se `ArStabilityBadgeProps.percent`s jsdoc) som
 * 0..100% — produktkrav 2 ("AR-stabilitet"). Väger samman FLER signaler än
 * bara GPS/kompass-stabilitet, så en enskild svag signal (t.ex. okalibrerad
 * kompass) syns i procenten även om positionen råkar vara fryst/stabil just
 * nu av andra skäl.
 */
export function ArStabilityBadge({ percent: rawPercent }: ArStabilityBadgeProps) {
  const percent = Math.round(Math.min(Math.max(rawPercent, 0), 100));
  const { className, icon } = tierFor(percent);
  return (
    <span
      className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${className}`}
    >
      <span aria-hidden>{icon}</span>
      AR: {percent}%
    </span>
  );
}
