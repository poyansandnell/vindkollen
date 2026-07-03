import { useEffect, useMemo, useState } from "react";
import { Loader2, ListOrdered } from "lucide-react";
import { Button } from "@/components/ui/button";
import MapCanvas, { type MapSelection } from "@/components/MapCanvas";
import SearchBox from "@/components/SearchBox";
import FilterBar, { type FilterState } from "@/components/FilterBar";
import DetailPanel from "@/components/DetailPanel";
import BestPlacesView from "@/components/BestPlacesView";
import { useGeolocation, type GeoPoint } from "@/hooks/useGeolocation";
import { getMapboxToken } from "@/lib/config";
import type { MapBounds, MapViewport } from "@/lib/mapProvider/types";
import { ACTIVE_STATUSES } from "@/lib/statusMeta";
import {
  useListWindTurbines,
  useListWindProjectAreas,
  type WindTurbine,
  type WindProjectArea,
} from "@workspace/api-client-react";
import type { UseQueryOptions } from "@tanstack/react-query";

const SWEDEN_VIEWPORT: MapViewport = { latitude: 62.5, longitude: 15.5, zoom: 4.3 };
const RADIUS_ZOOM = 10;

export default function Home() {
  const [mapboxToken, setMapboxToken] = useState<string | null | undefined>(undefined);
  const [viewport, setViewport] = useState<MapViewport>(SWEDEN_VIEWPORT);
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [focusPoint, setFocusPoint] = useState<GeoPoint | null>(null);
  const [flyToken, setFlyToken] = useState(0);
  const [selection, setSelection] = useState<MapSelection | null>(null);
  const [showBestPlaces, setShowBestPlaces] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    statuses: ACTIVE_STATUSES,
    showTurbines: true,
    showProjectAreas: true,
    radiusKm: 60,
  });

  useEffect(() => {
    getMapboxToken().then(setMapboxToken);
  }, []);

  const handleLocated = (point: GeoPoint) => {
    setFocusPoint(point);
    setViewport({ latitude: point.lat, longitude: point.lng, zoom: RADIUS_ZOOM });
    setFlyToken((n) => n + 1);
    setSelection(null);
  };

  const { locating, error: locateError, locate } = useGeolocation(handleLocated);

  const statusParam = filters.statuses.length > 0 ? filters.statuses.join(",") : "__none__";

  const queryParams = useMemo(() => {
    if (focusPoint) {
      return {
        lat: focusPoint.lat,
        lng: focusPoint.lng,
        radiusKm: filters.radiusKm,
        statuses: statusParam,
        limit: 5000,
      };
    }
    if (bounds) {
      return {
        minLat: bounds.minLat,
        minLng: bounds.minLng,
        maxLat: bounds.maxLat,
        maxLng: bounds.maxLng,
        statuses: statusParam,
        limit: 5000,
      };
    }
    return undefined;
  }, [focusPoint, bounds, statusParam, filters.radiusKm]);

  const turbinesQuery = useListWindTurbines(queryParams, {
    query: { enabled: filters.showTurbines && !!queryParams } as UseQueryOptions<WindTurbine[]>,
  });
  const projectAreasQuery = useListWindProjectAreas(queryParams, {
    query: {
      enabled: filters.showProjectAreas && !!queryParams,
    } as UseQueryOptions<WindProjectArea[]>,
  });

  const turbines = filters.showTurbines ? (turbinesQuery.data ?? []) : [];
  const projectAreas = filters.showProjectAreas ? (projectAreasQuery.data ?? []) : [];
  const isFetching = turbinesQuery.isFetching || projectAreasQuery.isFetching;

  if (mapboxToken === undefined) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!mapboxToken) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background px-4">
        <p className="text-center text-muted-foreground max-w-sm">
          Ingen Mapbox-token är konfigurerad på servern. Kontakta administratören för att aktivera
          kartan.
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-full overflow-hidden bg-background">
      <MapCanvas
        key={flyToken}
        mapboxToken={mapboxToken}
        viewport={viewport}
        onViewportChange={setViewport}
        onBoundsChange={setBounds}
        turbines={turbines}
        projectAreas={projectAreas}
        focusPoint={focusPoint}
        onSelect={setSelection}
      />

      <div className="absolute top-3 left-3 right-3 sm:right-auto flex flex-col gap-2 z-10">
        <div className="flex items-center gap-2">
          <SearchBox
            mapboxToken={mapboxToken}
            onSelectLocation={(point) => handleLocated(point)}
            onLocateMe={locate}
            locating={locating}
          />
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0 shadow-sm"
            onClick={() => setShowBestPlaces(true)}
            data-testid="button-open-best-places"
          >
            <ListOrdered className="h-4 w-4 mr-1" />
            Bästa orter
          </Button>
        </div>
        <FilterBar filters={filters} onChange={setFilters} hasFocusPoint={!!focusPoint} />
        {locateError && (
          <div className="text-xs bg-destructive/10 text-destructive rounded px-2 py-1 max-w-xs">
            {locateError}
          </div>
        )}
      </div>

      {isFetching && (
        <div className="absolute top-3 right-3 z-10 bg-background/90 rounded-full p-2 shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}

      {focusPoint && (
        <div className="absolute bottom-3 left-3 z-10 bg-background/95 rounded-md px-3 py-2 shadow-sm text-sm">
          <span className="font-medium">{focusPoint.label ?? "Vald plats"}</span>
          <button
            className="ml-2 text-xs text-primary underline"
            onClick={() => {
              setFocusPoint(null);
              setViewport(SWEDEN_VIEWPORT);
              setFlyToken((n) => n + 1);
            }}
            data-testid="button-clear-focus"
          >
            Rensa
          </button>
        </div>
      )}

      {selection && <DetailPanel selection={selection} onClose={() => setSelection(null)} />}

      {showBestPlaces && (
        <BestPlacesView
          onClose={() => setShowBestPlaces(false)}
          onSelectLocality={(point) => {
            handleLocated(point);
            setShowBestPlaces(false);
          }}
        />
      )}
    </div>
  );
}
