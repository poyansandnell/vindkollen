import { useEffect, useMemo, useState } from "react";
import { Loader2, ListOrdered, Crosshair } from "lucide-react";
import { Button } from "@/components/ui/button";
import MapCanvas, { type MapSelection, type SightResultsInfo } from "@/components/MapCanvas";
import SearchBox from "@/components/SearchBox";
import FilterBar, { type FilterState } from "@/components/FilterBar";
import DetailPanel from "@/components/DetailPanel";
import BestPlacesView from "@/components/BestPlacesView";
import SightLinePanel, { type SightSummary } from "@/components/SightLinePanel";
import InstallPrompt from "@/components/InstallPrompt";
import { WifiOff } from "lucide-react";
import { useGeolocation, type GeoPoint } from "@/hooks/useGeolocation";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
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
const EMPTY_TURBINES: WindTurbine[] = [];
const EMPTY_PROJECT_AREAS: WindProjectArea[] = [];

export default function Home() {
  const [mapboxToken, setMapboxToken] = useState<string | null | undefined>(undefined);
  const [viewport, setViewport] = useState<MapViewport>(SWEDEN_VIEWPORT);
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [focusPoint, setFocusPoint] = useState<GeoPoint | null>(null);
  const [flyToken, setFlyToken] = useState(0);
  const [selection, setSelection] = useState<MapSelection | null>(null);
  const [showBestPlaces, setShowBestPlaces] = useState(false);
  const [sightMode, setSightMode] = useState(false);
  const [sightObserver, setSightObserver] = useState<GeoPoint | null>(null);
  const [sightResultsInfo, setSightResultsInfo] = useState<SightResultsInfo>({
    results: new Map(),
    computing: false,
  });
  const [filters, setFilters] = useState<FilterState>({
    statuses: ACTIVE_STATUSES,
    showTurbines: true,
    showOnshoreAreas: true,
    showOffshoreAreas: true,
    radiusKm: 60,
    showBeyondRadius: false,
  });

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getMapboxToken().then((token) => {
        if (!cancelled) setMapboxToken(token);
      });
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const handleLocated = (point: GeoPoint) => {
    setFocusPoint(point);
    setViewport({ latitude: point.lat, longitude: point.lng, zoom: RADIUS_ZOOM });
    setFlyToken((n) => n + 1);
    setSelection(null);
  };

  const { locating, error: locateError, locate } = useGeolocation(handleLocated);

  const handleToggleSightMode = () => {
    if (sightMode) {
      setSightMode(false);
      return;
    }
    setSightObserver(null);
    setSelection(null);
    setSightMode(true);
  };

  const handlePlaceSightObserver = (point: { lat: number; lng: number }) => {
    setSightObserver(point);
    setSightMode(false);
    setSelection(null);
  };

  const statusParam = filters.statuses.length > 0 ? filters.statuses.join(",") : "__none__";

  const NATIONWIDE_RADIUS_KM = 1500;
  // Above this bounding-box span (degrees), we're zoomed out to roughly a
  // whole-country view. Full project-area polygons for thousands of areas at
  // that zoom is several MB of JSON and can hang/crash the map on mobile, so
  // we ask the server to omit polygon geometry ("summary" detail) until the
  // user zooms in far enough to actually see area outlines.
  const WIDE_VIEW_SPAN_DEG = 3;

  const isWideView = useMemo(() => {
    if (focusPoint) {
      return filters.showBeyondRadius;
    }
    if (bounds) {
      return (
        bounds.maxLat - bounds.minLat > WIDE_VIEW_SPAN_DEG ||
        bounds.maxLng - bounds.minLng > WIDE_VIEW_SPAN_DEG
      );
    }
    return false;
  }, [focusPoint, bounds, filters.showBeyondRadius]);

  const queryParams = useMemo(() => {
    if (focusPoint) {
      return {
        lat: focusPoint.lat,
        lng: focusPoint.lng,
        radiusKm: filters.showBeyondRadius ? NATIONWIDE_RADIUS_KM : filters.radiusKm,
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
  }, [focusPoint, bounds, statusParam, filters.radiusKm, filters.showBeyondRadius]);

  const projectAreasQueryParams = useMemo(() => {
    if (!queryParams) return undefined;
    return { ...queryParams, detail: isWideView ? ("summary" as const) : ("full" as const) };
  }, [queryParams, isWideView]);

  const turbinesQuery = useListWindTurbines(queryParams, {
    query: { enabled: filters.showTurbines && !!queryParams } as UseQueryOptions<WindTurbine[]>,
  });
  const showAnyAreas = filters.showOnshoreAreas || filters.showOffshoreAreas;
  const projectAreasQuery = useListWindProjectAreas(projectAreasQueryParams, {
    query: {
      enabled: showAnyAreas && !!projectAreasQueryParams,
    } as UseQueryOptions<WindProjectArea[]>,
  });

  const turbines = useMemo<WindTurbine[]>(
    () => (filters.showTurbines ? (turbinesQuery.data ?? EMPTY_TURBINES) : EMPTY_TURBINES),
    [filters.showTurbines, turbinesQuery.data],
  );
  const projectAreas = useMemo<WindProjectArea[]>(
    () =>
      showAnyAreas
        ? (projectAreasQuery.data ?? EMPTY_PROJECT_AREAS).filter((a) =>
            a.category === "offshore" ? filters.showOffshoreAreas : filters.showOnshoreAreas,
          )
        : EMPTY_PROJECT_AREAS,
    [
      showAnyAreas,
      projectAreasQuery.data,
      filters.showOffshoreAreas,
      filters.showOnshoreAreas,
    ],
  );
  const isFetching = turbinesQuery.isFetching || projectAreasQuery.isFetching;
  const isOnline = useOnlineStatus();
  const hasCachedData = turbines.length > 0 || projectAreas.length > 0;
  const showOfflineBanner = !isOnline && (hasCachedData || turbinesQuery.isError || projectAreasQuery.isError);

  const sightSummary = useMemo<SightSummary | null>(() => {
    if (!sightObserver) return null;
    let visible = 0;
    let obstructed = 0;
    let unknown = 0;
    const visibleList: SightSummary["visibleList"] = [];

    sightResultsInfo.results.forEach((result, key) => {
      if (result.status === "visible") visible += 1;
      else if (result.status === "obstructed") obstructed += 1;
      else unknown += 1;

      if (result.status === "visible") {
        const [kind, idStr] = key.split(":") as ["turbine" | "projectArea", string];
        const id = Number(idStr);
        const name =
          kind === "turbine"
            ? turbines.find((t) => t.id === id)?.name
            : projectAreas.find((a) => a.id === id)?.name;
        if (name) visibleList.push({ key, name, distanceKm: result.distanceKm, kind });
      }
    });

    visibleList.sort((a, b) => a.distanceKm - b.distanceKm);

    return { visible, obstructed, unknown, computing: sightResultsInfo.computing, visibleList };
  }, [sightObserver, sightResultsInfo, turbines, projectAreas]);

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
        <div className="flex flex-col items-center gap-4 max-w-sm text-center">
          <p className="text-muted-foreground">
            Kartan kunde inte aktiveras. Kontrollera att servern är igång och att Mapbox-token är
            konfigurerad.
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              setMapboxToken(undefined);
              getMapboxToken().then(setMapboxToken);
            }}
          >
            Försök igen
          </Button>
        </div>
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
        sightMode={sightMode}
        sightObserver={sightObserver}
        onPlaceSightObserver={handlePlaceSightObserver}
        onSightResultsChange={setSightResultsInfo}
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
          <Button
            variant={sightMode ? "default" : "secondary"}
            size="sm"
            className="shrink-0 shadow-sm"
            onClick={handleToggleSightMode}
            data-testid="button-toggle-sight-mode"
          >
            <Crosshair className="h-4 w-4 mr-1" />
            {sightMode ? "Klicka på kartan…" : "Sikt från plats"}
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

      {showOfflineBanner && (
        <div
          className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 bg-amber-500/95 text-amber-950 text-xs font-medium rounded-full px-3 py-1.5 shadow-sm"
          data-testid="banner-offline"
        >
          <WifiOff className="h-3.5 w-3.5" />
          {hasCachedData ? "Ingen anslutning – visar sparad data" : "Ingen anslutning"}
        </div>
      )}

      <div className="absolute bottom-3 left-3 z-10 flex flex-col items-start gap-2">
        {focusPoint && (
          <div className="bg-background/95 rounded-md px-3 py-2 shadow-sm text-sm">
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

        {sightSummary && (
          <SightLinePanel
            summary={sightSummary}
            onClear={() => {
              setSightObserver(null);
              setSightMode(false);
            }}
            onReselect={() => {
              setSightObserver(null);
              setSelection(null);
              setSightMode(true);
            }}
          />
        )}
      </div>

      {selection && (
        <DetailPanel selection={selection} onClose={() => setSelection(null)} focusPoint={focusPoint} turbines={turbines} />
      )}

      {showBestPlaces && (
        <BestPlacesView
          onClose={() => setShowBestPlaces(false)}
          onSelectLocality={(point) => {
            handleLocated(point);
            setShowBestPlaces(false);
          }}
        />
      )}

      <InstallPrompt />
    </div>
  );
}
