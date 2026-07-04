interface LineOfSightStatusProps {
  status: "clear" | "partial" | "indoors";
}

/**
 * Liten alltid-synlig statusbadge (topp-bar) som visar den aktuella,
 * kamera-baserade sikt-bedömningen i klartext — "Fri sikt" / "Delvis
 * skymt" / "Ingen fri sikt" — som ett komplement till (inte en ersättning
 * för) den stora inomhus-overlayen i `Home.tsx` och den ARScene-interna
 * per-pixel-ocklusionen. Ren presentationskomponent, ingen egen logik:
 * `Home.tsx` räknar ut `status` från `useSkyDetection`s `indoors`/
 * `skyRatio`.
 */
const STATUS_CONFIG: Record<LineOfSightStatusProps["status"], { label: string; className: string }> = {
  clear: { label: "Fri sikt", className: "bg-green-500/20 text-green-200" },
  partial: { label: "Delvis skymt", className: "bg-yellow-500/20 text-yellow-200" },
  indoors: { label: "Ingen fri sikt", className: "bg-red-500/20 text-red-200" },
};

export function LineOfSightStatus({ status }: LineOfSightStatusProps) {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium ${config.className}`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {config.label}
    </span>
  );
}
