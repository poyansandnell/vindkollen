interface GpsQualityBadgeProps {
  /** 0..1, från `useArTrackingStability`s `debug.gpsQuality`. */
  quality: number;
  /** Meter, från `debug.gpsAccuracyM` — visas som stöd ("±12 m"), null innan första GPS-fix. */
  accuracyM: number | null;
}

// Samma tröskelprincip som `CompassStabilityBadge` — tre kategoriska nivåer
// ("bra"/"medel"/"dålig") istället för procent, eftersom GPS-precision i
// meter är mindre intuitiv för användaren än en enkel kvalitetsetikett
// (produktkrav 2: "GPS/kompass/AR-stabilitet" ska alla synas live).
const GOOD_THRESHOLD = 0.7;
const MEDIUM_THRESHOLD = 0.35;

function tierFor(quality: number): { label: string; className: string; icon: string } {
  if (quality >= GOOD_THRESHOLD) return { label: "bra", className: "bg-green-500/20 text-green-200", icon: "🟢" };
  if (quality >= MEDIUM_THRESHOLD) return { label: "medel", className: "bg-yellow-500/20 text-yellow-200", icon: "🟡" };
  return { label: "dålig", className: "bg-red-500/20 text-red-200", icon: "🔴" };
}

/**
 * Liten alltid-synlig, live-uppdaterad badge som visar GPS-precisionen som
 * en kategorisk nivå ("GPS: bra/medel/dålig") — produktkrav 2. Kompletterar
 * `CompassStabilityBadge` (kompass) och `ArStabilityBadge` (kombinerad
 * AR-tracking-kvalitet).
 */
export function GpsQualityBadge({ quality, accuracyM }: GpsQualityBadgeProps) {
  const { label, className, icon } = tierFor(quality);
  return (
    <span
      className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${className}`}
    >
      <span aria-hidden>{icon}</span>
      GPS: {label}
      {accuracyM !== null && <span className="text-[10px] opacity-75">(±{Math.round(accuracyM)} m)</span>}
    </span>
  );
}
