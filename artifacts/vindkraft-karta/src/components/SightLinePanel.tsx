import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface SightVisibleItem {
  key: string;
  name: string;
  distanceKm: number;
  kind: "turbine" | "projectArea";
}

export interface SightSummary {
  visible: number;
  obstructed: number;
  unknown: number;
  computing: boolean;
  visibleList: SightVisibleItem[];
}

interface SightLinePanelProps {
  summary: SightSummary;
  onClear: () => void;
  onReselect: () => void;
}

const VISIBLE_LIST_LIMIT = 12;

export default function SightLinePanel({ summary, onClear, onReselect }: SightLinePanelProps) {
  const { visible, obstructed, unknown, computing, visibleList } = summary;
  const shown = visibleList.slice(0, VISIBLE_LIST_LIMIT);
  const remaining = visibleList.length - shown.length;

  return (
    <div
      className="bg-background/95 rounded-md px-3 py-2 shadow-sm text-sm max-w-xs"
      data-testid="panel-sight-line"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium flex items-center gap-1.5">
          📐 Sikt från vald plats
          {computing && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        <button
          className="text-muted-foreground hover:text-foreground shrink-0"
          onClick={onClear}
          data-testid="button-clear-sight"
          aria-label="Stäng siktkontroll"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        <span className="text-green-600 font-medium">🟢 {visible} synliga</span>
        <span className="text-stone-500 font-medium">⚪ {obstructed} skymda</span>
        {unknown > 0 && <span className="text-muted-foreground">❔ {unknown} okänt</span>}
      </div>

      {shown.length > 0 && (
        <ul className="mt-2 max-h-40 overflow-y-auto space-y-0.5 pr-1">
          {shown.map((item) => (
            <li key={item.key} className="flex justify-between text-xs gap-2">
              <span className="truncate">{item.name}</span>
              <span className="text-muted-foreground shrink-0">{item.distanceKm.toFixed(1)} km</span>
            </li>
          ))}
          {remaining > 0 && (
            <li className="text-xs text-muted-foreground">+ {remaining} till</li>
          )}
        </ul>
      )}

      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        Uppskattning baserad på höjddata och luftlinje (inkl. jordkrökning). Tar inte hänsyn till
        skog, byggnader eller andra hinder – se det som en fingervisning, inte en garanti.
      </p>

      <Button
        variant="outline"
        size="sm"
        className="mt-2 w-full"
        onClick={onReselect}
        data-testid="button-reselect-sight"
      >
        Välj en annan plats
      </Button>
    </div>
  );
}
