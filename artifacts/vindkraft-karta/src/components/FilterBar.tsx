import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { SlidersHorizontal } from "lucide-react";
import { ALL_STATUSES, statusLabel } from "@/lib/statusMeta";

export interface FilterState {
  statuses: string[];
  showTurbines: boolean;
  showProjectAreas: boolean;
  radiusKm: number;
}

interface FilterBarProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  hasFocusPoint: boolean;
}

export default function FilterBar({ filters, onChange, hasFocusPoint }: FilterBarProps) {
  const toggleStatus = (status: string) => {
    const next = filters.statuses.includes(status)
      ? filters.statuses.filter((s) => s !== status)
      : [...filters.statuses, status];
    onChange({ ...filters, statuses: next });
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        variant={filters.showTurbines ? "default" : "outline"}
        size="sm"
        onClick={() => onChange({ ...filters, showTurbines: !filters.showTurbines })}
        data-testid="button-toggle-turbines"
      >
        Vindkraftverk
      </Button>
      <Button
        variant={filters.showProjectAreas ? "default" : "outline"}
        size="sm"
        onClick={() => onChange({ ...filters, showProjectAreas: !filters.showProjectAreas })}
        data-testid="button-toggle-project-areas"
      >
        Projekteringsområden
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
    </div>
  );
}
