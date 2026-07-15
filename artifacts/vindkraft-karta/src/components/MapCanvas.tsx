import { useEffect, useMemo, useRef, useState } from "react";
import { Source, Layer, Popup, type MapRef } from "react-map-gl/mapbox";
import type { MapLayerMouseEvent, GeoJSONSource, Expression, Map as MapboxMap } from "mapbox-gl";
import MapboxMapView from "@/lib/mapProvider/MapboxMapView";
import type { MapBounds, MapViewport } from "@/lib/mapProvider/types";
import type { WindTurbine, WindProjectArea } from "@workspace/api-client-react";
import {
  turbinesToGeoJson,
  projectAreasToPointGeoJson,
  projectAreasToPolygonGeoJson,
} from "@/lib/turbineGeojson";
import { statusLabel } from "@/lib/statusMeta";
import {
  useLineOfSightVisibility,
  type SightTarget,
  type SightVisibilityResult,
} from "@/hooks/useLineOfSightVisibility";

export interface MapSelection {
  kind: "turbine" | "projectArea";
  id: number;
}

export interface SightResultsInfo {
  results: Map<string, SightVisibilityResult>;
  computing: boolean;
}

interface MapCanvasProps {
  mapboxToken: string;
  viewport: MapViewport;
  onViewportChange: (viewport: MapViewport) => void;
  onBoundsChange: (bounds: MapBounds) => void;
  turbines: WindTurbine[];
  projectAreas: WindProjectArea[];
  focusPoint?: { lat: number; lng: number } | null;
  onSelect: (selection: MapSelection) => void;
  sightMode: boolean;
  sightObserver?: { lat: number; lng: number } | null;
  onPlaceSightObserver: (point: { lat: number; lng: number }) => void;
  onSightResultsChange: (info: SightResultsInfo) => void;
}

const CLUSTER_LAYER = "turbine-clusters";
const CLUSTER_COUNT_LAYER = "turbine-cluster-count";
const UNCLUSTERED_LAYER = "turbine-unclustered";
const PROJECT_FILL_LAYER = "project-area-fill";
const PROJECT_LINE_LAYER = "project-area-line";
const PROJECT_POINT_LAYER = "project-area-point";

// Distance-tier visibility: 0-20 km prominent, 20-35 km toned down, 35-60+ km muted/regional.
// distanceKm is only present in feature properties when a focus point is set; falls back to
// full prominence (null case) when browsing without a focus point.
const DISTANCE_TIER_OPACITY: Expression = [
  "case",
  ["==", ["get", "distanceKm"], null],
  1,
  ["<", ["get", "distanceKm"], 20],
  1,
  ["<", ["get", "distanceKm"], 35],
  0.6,
  0.32,
];

const DISTANCE_TIER_LINE_OPACITY: Expression = [
  "case",
  ["==", ["get", "distanceKm"], null],
  1,
  ["<", ["get", "distanceKm"], 20],
  1,
  ["<", ["get", "distanceKm"], 35],
  0.7,
  0.4,
];

const DISTANCE_TIER_POINT_RADIUS: Expression = [
  "case",
  ["==", ["get", "distanceKm"], null],
  8,
  ["<", ["get", "distanceKm"], 20],
  8,
  ["<", ["get", "distanceKm"], 35],
  6.5,
  5,
];

const DISTANCE_TIER_TURBINE_RADIUS: Expression = [
  "case",
  ["==", ["get", "distanceKm"], null],
  6,
  ["<", ["get", "distanceKm"], 20],
  6,
  ["<", ["get", "distanceKm"], 35],
  5,
  4,
];

// Line-of-sight ring: highlights the estimated result of a chosen "sight from this spot" check.
// sightStatus is only set on features when a sight observer point is active.
const SIGHT_STROKE_COLOR: Expression = [
  "match",
  ["get", "sightStatus"],
  "visible",
  "#16a34a",
  "obstructed",
  "#78716c",
  "#ffffff",
];

const SIGHT_STROKE_WIDTH: Expression = [
  "match",
  ["get", "sightStatus"],
  "visible",
  3.5,
  "obstructed",
  2,
  1.5,
];

const SIGHT_OPACITY: Expression = ["match", ["get", "sightStatus"], "obstructed", 0.35, 1];

function annotateSightStatus(
  fc: GeoJSON.FeatureCollection,
  results: Map<string, SightVisibilityResult>,
  keyPrefix: "turbine" | "projectArea",
): GeoJSON.FeatureCollection {
  if (results.size === 0) return fc;
  return {
    ...fc,
    features: fc.features.map((feature) => {
      const id = (feature.properties as { id?: number } | null)?.id;
      const result = id !== undefined ? results.get(`${keyPrefix}:${id}`) : undefined;
      return {
        ...feature,
        properties: {
          ...feature.properties,
          sightStatus: result?.status ?? null,
        },
      };
    }),
  };
}

export default function MapCanvas({
  mapboxToken,
  viewport,
  onViewportChange,
  onBoundsChange,
  turbines,
  projectAreas,
  focusPoint,
  onSelect,
  sightMode,
  sightObserver,
  onPlaceSightObserver,
  onSightResultsChange,
}: MapCanvasProps) {
  const mapRef = useRef<MapRef>(null);
  const [mapInstance, setMapInstance] = useState<MapboxMap | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{
    lng: number;
    lat: number;
    name: string;
    status: string;
  } | null>(null);

  const sightTargets = useMemo<SightTarget[]>(() => {
    const turbineTargets = turbines
      .filter((t) => typeof t.lat === "number" && typeof t.lng === "number")
      .map((t) => ({
        key: `turbine:${t.id}`,
        lat: t.lat as number,
        lng: t.lng as number,
        heightM: t.totalHeightM ?? null,
      }));
    const areaTargets = projectAreas
      .filter((a) => typeof a.centerLat === "number" && typeof a.centerLng === "number")
      .map((a) => ({
        key: `projectArea:${a.id}`,
        lat: a.centerLat as number,
        lng: a.centerLng as number,
        heightM: a.heightMaxM ?? null,
      }));
    return [...turbineTargets, ...areaTargets];
  }, [turbines, projectAreas]);

  const { results: sightResults, computing: sightComputing } = useLineOfSightVisibility(
    mapInstance,
    sightObserver ?? null,
    sightTargets,
  );

  useEffect(() => {
    onSightResultsChange({ results: sightResults, computing: sightComputing });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sightResults, sightComputing]);

  const turbineGeojson = useMemo(
    () => annotateSightStatus(turbinesToGeoJson(turbines), sightResults, "turbine"),
    [turbines, sightResults],
  );
  const projectPolygonGeojson = useMemo(
    () => projectAreasToPolygonGeoJson(projectAreas),
    [projectAreas],
  );
  const projectPointGeojson = useMemo(
    () =>
      annotateSightStatus(
        projectAreasToPointGeoJson(projectAreas.filter((a) => !a.polygon)),
        sightResults,
        "projectArea",
      ),
    [projectAreas, sightResults],
  );

  const interactiveLayerIds = [
    CLUSTER_LAYER,
    UNCLUSTERED_LAYER,
    PROJECT_FILL_LAYER,
    PROJECT_POINT_LAYER,
  ];

  const handleClick = (event: MapLayerMouseEvent) => {
    if (sightMode) {
      onPlaceSightObserver({ lat: event.lngLat.lat, lng: event.lngLat.lng });
      return;
    }

    const feature = event.features?.[0];
    if (!feature) return;
    const layerId = feature.layer?.id;

    if (layerId === CLUSTER_LAYER) {
      const clusterId = feature.properties?.cluster_id;
      const source = mapRef.current?.getMap().getSource("turbines") as GeoJSONSource | undefined;
      if (source && clusterId !== undefined) {
        source.getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err || !mapRef.current) return;
          mapRef.current.getMap().easeTo({
            center: (feature.geometry as GeoJSON.Point).coordinates as [number, number],
            zoom: zoom ?? viewport.zoom + 2,
          });
        });
      }
      return;
    }

    const props = feature.properties as { id: number; kind: "turbine" | "projectArea" };
    if (props?.id !== undefined) {
      onSelect({ kind: props.kind, id: props.id });
    }
  };

  const handleMouseMove = (event: MapLayerMouseEvent) => {
    const feature = event.features?.[0];
    if (!feature || feature.layer?.id === CLUSTER_LAYER) {
      setHoverInfo(null);
      return;
    }
    const [lng, lat] =
      feature.geometry.type === "Point"
        ? (feature.geometry.coordinates as [number, number])
        : [event.lngLat.lng, event.lngLat.lat];
    const props = feature.properties as { name: string; status: string };
    setHoverInfo({ lng, lat, name: props.name, status: props.status });
  };

  return (
    <MapboxMapView
      ref={mapRef}
      mapboxToken={mapboxToken}
      viewport={viewport}
      onViewportChange={onViewportChange}
      onBoundsChange={onBoundsChange}
      interactiveLayerIds={interactiveLayerIds}
      onMapClick={handleClick}
      onMapMouseMove={handleMouseMove}
      onMapReady={setMapInstance}
    >
      <Source
        id="turbines"
        type="geojson"
        data={turbineGeojson}
        cluster
        clusterMaxZoom={12}
        clusterRadius={45}
      >
        <Layer
          id={CLUSTER_LAYER}
          type="circle"
          filter={["has", "point_count"]}
          paint={{
            "circle-color": [
              "step",
              ["get", "point_count"],
              "#60a5fa",
              25,
              "#3b82f6",
              100,
              "#1d4ed8",
            ],
            "circle-radius": ["step", ["get", "point_count"], 14, 25, 20, 100, 28],
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          }}
        />
        <Layer
          id={CLUSTER_COUNT_LAYER}
          type="symbol"
          filter={["has", "point_count"]}
          layout={{
            "text-field": ["get", "point_count_abbreviated"],
            "text-size": 12,
          }}
          paint={{ "text-color": "#ffffff" }}
        />
        <Layer
          id={UNCLUSTERED_LAYER}
          type="circle"
          filter={["!", ["has", "point_count"]]}
          paint={{
            "circle-color": ["get", "color"],
            "circle-radius": DISTANCE_TIER_TURBINE_RADIUS,
            "circle-opacity": ["*", DISTANCE_TIER_OPACITY, SIGHT_OPACITY],
            "circle-stroke-width": SIGHT_STROKE_WIDTH,
            "circle-stroke-color": SIGHT_STROKE_COLOR,
            "circle-stroke-opacity": DISTANCE_TIER_OPACITY,
          }}
        />
      </Source>

      <Source id="project-areas-polygons" type="geojson" data={projectPolygonGeojson}>
        <Layer
          id={PROJECT_FILL_LAYER}
          type="fill"
          paint={{
            "fill-color": ["get", "color"],
            "fill-opacity": [
              "case",
              ["==", ["get", "distanceKm"], null],
              0.25,
              ["<", ["get", "distanceKm"], 20],
              0.25,
              ["<", ["get", "distanceKm"], 35],
              0.16,
              0.08,
            ],
          }}
        />
        <Layer
          id={PROJECT_LINE_LAYER}
          type="line"
          paint={{
            "line-color": ["get", "color"],
            "line-width": 2,
            "line-opacity": DISTANCE_TIER_LINE_OPACITY,
          }}
        />
      </Source>

      <Source id="project-areas-points" type="geojson" data={projectPointGeojson}>
        <Layer
          id={PROJECT_POINT_LAYER}
          type="circle"
          paint={{
            "circle-color": ["get", "color"],
            "circle-radius": DISTANCE_TIER_POINT_RADIUS,
            "circle-stroke-width": SIGHT_STROKE_WIDTH,
            "circle-stroke-color": SIGHT_STROKE_COLOR,
            "circle-opacity": [
              "*",
              [
                "case",
                ["==", ["get", "distanceKm"], null],
                0.85,
                ["<", ["get", "distanceKm"], 20],
                0.85,
                ["<", ["get", "distanceKm"], 35],
                0.55,
                0.3,
              ],
              SIGHT_OPACITY,
            ],
          }}
        />
      </Source>

      {focusPoint && (
        <Source
          id="focus-point"
          type="geojson"
          data={{
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: [focusPoint.lng, focusPoint.lat] },
                properties: {},
              },
            ],
          }}
        >
          <Layer
            id="focus-point-layer"
            type="circle"
            paint={{
              "circle-color": "#ef4444",
              "circle-radius": 9,
              "circle-stroke-width": 3,
              "circle-stroke-color": "#ffffff",
            }}
          />
        </Source>
      )}

      {sightObserver && (
        <Source
          id="sight-observer"
          type="geojson"
          data={{
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: [sightObserver.lng, sightObserver.lat] },
                properties: {},
              },
            ],
          }}
        >
          <Layer
            id="sight-observer-layer"
            type="circle"
            paint={{
              "circle-color": "#7c3aed",
              "circle-radius": 10,
              "circle-stroke-width": 3,
              "circle-stroke-color": "#ffffff",
            }}
          />
        </Source>
      )}

      {hoverInfo && (
        <Popup
          longitude={hoverInfo.lng}
          latitude={hoverInfo.lat}
          closeButton={false}
          closeOnClick={false}
          offset={12}
          anchor="bottom"
        >
          <div className="text-sm">
            <div className="font-semibold">{hoverInfo.name}</div>
            <div className="text-muted-foreground">{statusLabel(hoverInfo.status)}</div>
          </div>
        </Popup>
      )}

      <div className="absolute bottom-8 right-3 z-10 flex flex-col overflow-hidden rounded-md shadow-md border border-border/60">
        <button
          aria-label="Zooma in"
          onClick={() => mapRef.current?.getMap().zoomIn({ duration: 250 })}
          className="flex h-8 w-8 items-center justify-center bg-background text-lg font-bold text-foreground hover:bg-muted leading-none select-none border-b border-border/60"
        >
          +
        </button>
        <button
          aria-label="Zooma ut"
          onClick={() => mapRef.current?.getMap().zoomOut({ duration: 250 })}
          className="flex h-8 w-8 items-center justify-center bg-background text-lg font-bold text-foreground hover:bg-muted leading-none select-none"
        >
          −
        </button>
      </div>
    </MapboxMapView>
  );
}
