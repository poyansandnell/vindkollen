interface ArStabilityBadgeProps {
  /** 0..1, från `useArTrackingStability`s `debug.combinedQuality` (svagaste av GPS/kompass). */
  quality: number;
}

// Samma tröskelprincip som `CompassStabilityBadge`/`GpsQualityBadge`.
const HIGH_QUALITY_THRESHOLD = 0.8;
const LOW_QUALITY_THRESHOLD = 0.55;

function tierFor(percent: number): { className: string; icon: string } {
  if (percent >= HIGH_QUALITY_THRESHOLD * 100) return { className: "bg-green-500/20 text-green-200", icon: "🟢" };
  if (percent >= LOW_QUALITY_THRESHOLD * 100) return { className: "bg-yellow-500/20 text-yellow-200", icon: "🟡" };
  return { className: "bg-red-500/20 text-red-200", icon: "🔴" };
}

/**
 * Liten alltid-synlig, live-uppdaterad badge som visar den KOMBINERADE
 * AR-trackingkvaliteten (svagaste av GPS/kompass, se `useArTrackingStability`s
 * `combinedQuality`) som 0..100% — produktkrav 2 ("AR-stabilitet"). Samma
 * signal som styr om placeringen fryses (`tier`/`freeze`), så användaren kan
 * koppla ihop en låg procentsats med varför verken just nu inte flyttar sig.
 */
export function ArStabilityBadge({ quality }: ArStabilityBadgeProps) {
  const percent = Math.round(Math.min(Math.max(quality, 0), 1) * 100);
  const { className, icon } = tierFor(percent);
  return (
    <span
      className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium ${className}`}
    >
      <span aria-hidden>{icon}</span>
      AR-stabilitet: {percent}%
    </span>
  );
}
