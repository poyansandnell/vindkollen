import { useMemo, useRef, useState } from "react";
import { Source, Layer, Popup, type MapRef } from "react-map-gl/mapbox";
import type { MapLayerMouseEvent, GeoJSONSource } from "mapbox-gl";
import MapboxMapView from "@/lib/mapProvider/MapboxMapView";
import type { MapBounds, MapViewport } from "@/lib/mapProvider/types";
import type { WindTurbine, WindProjectArea } from "@workspace/api-client-react";
import {
  turbinesToGeoJson,
  projectAreasToPointGeoJson,
  projectAreasToPolygonGeoJson,
} from "@/lib/turbineGeojson";
import { statusLabel } from "@/lib/statusMeta";

export interface MapSelection {
  kind: "turbine" | "projectArea";
  id: number;
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
}

const CLUSTER_LAYER = "turbine-clusters";
const CLUSTER_COUNT_LAYER = "turbine-cluster-count";
const UNCLUSTERED_LAYER = "turbine-unclustered";
const PROJECT_FILL_LAYER = "project-area-fill";
const PROJECT_LINE_LAYER = "project-area-line";
const PROJECT_POINT_LAYER = "project-area-point";

export default function MapCanvas({
  mapboxToken,
  viewport,
  onViewportChange,
  onBoundsChange,
  turbines,
  projectAreas,
  focusPoint,
  onSelect,
}: MapCanvasProps) {
  const mapRef = useRef<MapRef>(null);
  const [hoverInfo, setHoverInfo] = useState<{
    lng: number;
    lat: number;
    name: string;
    status: string;
  } | null>(null);

  const turbineGeojson = useMemo(() => turbinesToGeoJson(turbines), [turbines]);
  const projectPolygonGeojson = useMemo(
    () => projectAreasToPolygonGeoJson(projectAreas),
    [projectAreas],
  );
  const projectPointGeojson = useMemo(
    () => projectAreasToPointGeoJson(projectAreas.filter((a) => !a.polygon)),
    [projectAreas],
  );

  const interactiveLayerIds = [
    CLUSTER_LAYER,
    UNCLUSTERED_LAYER,
    PROJECT_FILL_LAYER,
    PROJECT_POINT_LAYER,
  ];

  const handleClick = (event: MapLayerMouseEvent) => {
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
            "circle-radius": 6,
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#ffffff",
          }}
        />
      </Source>

      <Source id="project-areas-polygons" type="geojson" data={projectPolygonGeojson}>
        <Layer
          id={PROJECT_FILL_LAYER}
          type="fill"
          paint={{ "fill-color": ["get", "color"], "fill-opacity": 0.25 }}
        />
        <Layer
          id={PROJECT_LINE_LAYER}
          type="line"
          paint={{ "line-color": ["get", "color"], "line-width": 2 }}
        />
      </Source>

      <Source id="project-areas-points" type="geojson" data={projectPointGeojson}>
        <Layer
          id={PROJECT_POINT_LAYER}
          type="circle"
          paint={{
            "circle-color": ["get", "color"],
            "circle-radius": 8,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
            "circle-opacity": 0.85,
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
    </MapboxMapView>
  );
}
