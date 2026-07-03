import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, X } from "lucide-react";
import { useListBestLocalitiesToTest } from "@workspace/api-client-react";
import { statusLabel } from "@/lib/statusMeta";

interface BestPlacesViewProps {
  onClose: () => void;
  onSelectLocality: (point: { lat: number; lng: number; label: string }) => void;
}

export default function BestPlacesView({ onClose, onSelectLocality }: BestPlacesViewProps) {
  const { data, isLoading } = useListBestLocalitiesToTest({ limit: 50 });

  return (
    <div
      className="absolute inset-0 bg-background z-30 flex flex-col"
      data-testid="panel-best-places"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div>
          <h2 className="font-semibold text-lg">Bästa orter att testa</h2>
          <p className="text-sm text-muted-foreground">
            Orter rankade efter hur mycket vindkraftsutbyggnad som påverkar dem
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-best-places">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        {isLoading && (
          <div className="flex justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        <div className="divide-y">
          {data?.map((ranking) => (
            <button
              key={ranking.locality.id}
              className="w-full text-left px-4 py-3 hover:bg-accent flex items-center gap-4"
              onClick={() =>
                onSelectLocality({
                  lat: ranking.locality.lat,
                  lng: ranking.locality.lng,
                  label: ranking.locality.name,
                })
              }
              data-testid={`row-best-place-${ranking.locality.id}`}
            >
              <div className="text-lg font-bold text-muted-foreground w-8 shrink-0">
                #{ranking.rank}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{ranking.locality.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {ranking.locality.kommun ?? ranking.locality.region}
                  {ranking.dominantStatus ? ` · ${statusLabel(ranking.dominantStatus)}` : ""}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <Badge variant="secondary">Poäng {ranking.impactScore.toFixed(0)}</Badge>
                <span className="text-xs text-muted-foreground">
                  {ranking.turbineCountWithin25Km ?? 0} verk inom 25 km
                </span>
              </div>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
