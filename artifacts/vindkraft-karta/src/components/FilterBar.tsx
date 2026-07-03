import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { SlidersHorizontal } from "lucide-react";
import { ALL_STATUSES, statusLabel } from "@/lib/statusMeta";

export interface FilterState {
  statuses: string[];
  showTurbines: boolean;
  showOnshoreAreas: boolean;
  showOffshoreAreas: boolean;
  radiusKm: number;
  showBeyondRadius: boolean;
}

interface FilterBarProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  hasFocusPoint: boolean;
}

const QUICK_RADII = [25, 60];

export default function FilterBar({ filters, onChange, hasFocusPoint }: FilterBarProps) {
  const toggleStatus = (status: string) => {
    const next = filters.statuses.includes(status)
      ? filters.statuses.filter((s) => s !== status)
      : [...filters.statuses, status];
    onChange({ ...filters, statuses: next });
  };

  const activeAreaToggles =
    (filters.showOnshoreAreas ? 1 : 0) + (filters.showOffshoreAreas ? 1 : 0);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Button
        variant={filters.showTurbines ? "default" : "outline"}
        size="sm"
        onClick={() => onChange({ ...filters, showTurbines: !filters.showTurbines })}
        data-testid="button-toggle-turbines"
      >
        Vindkraftverk
      </Button>
      <Button
        variant={filters.showOnshoreAreas ? "default" : "outline"}
        size="sm"
        onClick={() => onChange({ ...filters, showOnshoreAreas: !filters.showOnshoreAreas })}
        data-testid="button-toggle-onshore-areas"
      >
        Landbaserade områden
      </Button>
      <Button
        variant={filters.showOffshoreAreas ? "default" : "outline"}
        size="sm"
        onClick={() => onChange({ ...filters, showOffshoreAreas: !filters.showOffshoreAreas })}
        data-testid="button-toggle-offshore-areas"
      >
        Havsbaserade områden
      </Button>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" data-testid="button-open-filters">
            <SlidersHorizontal className="h-4 w-4 mr-1" />
            Filter
            {filters.statuses.length > 0 && filters.statuses.length < ALL_STATUSES.length && (
              <span className="ml-1 rounded-full bg-primary text-primary-foreground text-xs px-1.5">
                {filters.statuses.length}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72" align="start">
          <div className="space-y-3">
            {hasFocusPoint && (
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span>Radie</span>
                  <span className="text-muted-foreground">{filters.radiusKm} km</span>
                </div>
                <Slider
                  min={5}
                  max={100}
                  step={5}
                  value={[filters.radiusKm]}
                  onValueChange={([value]) => onChange({ ...filters, radiusKm: value })}
                  data-testid="slider-radius"
                />
                <div className="flex gap-2 mt-2">
                  {QUICK_RADII.map((km) => (
                    <button
                      key={km}
                      className={`text-xs rounded px-2 py-1 border ${
                        filters.radiusKm === km
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border text-muted-foreground"
                      }`}
                      onClick={() => onChange({ ...filters, radiusKm: km })}
                      data-testid={`button-quick-radius-${km}`}
                    >
                      Endast inom {km} km
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-sm cursor-pointer mt-3">
                  <Checkbox
                    checked={filters.showBeyondRadius}
                    onCheckedChange={(checked) =>
                      onChange({ ...filters, showBeyondRadius: checked === true })
                    }
                    data-testid="checkbox-show-beyond-radius"
                  />
                  Visa även avlägsna projekt (&gt; {filters.radiusKm} km)
                </label>
              </div>
            )}
            <div>
              <div className="text-sm font-medium mb-2">Status</div>
              <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                {ALL_STATUSES.map((status) => (
                  <label
                    key={status}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <Checkbox
                      checked={filters.statuses.includes(status)}
                      onCheckedChange={() => toggleStatus(status)}
                      data-testid={`checkbox-status-${status}`}
                    />
                    {statusLabel(status)}
                  </label>
                ))}
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  className="text-xs text-primary underline"
                  onClick={() => onChange({ ...filters, statuses: [...ALL_STATUSES] })}
                >
                  Välj alla
                </button>
                <button
                  className="text-xs text-primary underline"
                  onClick={() => onChange({ ...filters, statuses: [] })}
                >
                  Rensa
                </button>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {activeAreaToggles === 0 && (
        <span className="text-xs text-muted-foreground">Inga projekteringsområden visas</span>
      )}
    </div>
  );
}
