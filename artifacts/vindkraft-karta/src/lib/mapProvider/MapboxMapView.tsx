import { forwardRef, useEffect, useState } from "react";
import Map, { type MapRef } from "react-map-gl/mapbox";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { MapProviderProps } from "./types";

interface MapboxMapViewProps extends MapProviderProps {
  mapboxToken: string;
}

const MapboxMapView = forwardRef<MapRef, MapboxMapViewProps>(function MapboxMapView(
  {
    mapboxToken,
    viewport,
    onViewportChange,
    onBoundsChange,
    interactiveLayerIds,
    onMapClick,
    onMapMouseMove,
    onMapReady,
    children,
  },
  ref,
) {
  const emitBounds = (map: mapboxgl.Map) => {
    const bounds = map.getBounds();
    if (bounds) {
      onBoundsChange({
        minLat: bounds.getSouth(),
        minLng: bounds.getWest(),
        maxLat: bounds.getNorth(),
        maxLng: bounds.getEast(),
      });
    }
  };

  // Loads a bare-earth elevation source and enables terrain so map.queryTerrainElevation() can be
  // used for the line-of-sight visibility check (see useLineOfSightVisibility). Exaggeration is
  // left at real-world scale (1) so it has no visible effect on the flat, top-down map view.
  const setupTerrain = (map: mapboxgl.Map) => {
    if (!map.getSource("mapbox-dem")) {
      map.addSource("mapbox-dem", {
        type: "raster-dem",
        url: "mapbox://mapbox.mapbox-terrain-dem-v1",
        tileSize: 512,
        maxzoom: 14,
      });
    }
    map.setTerrain({ source: "mapbox-dem", exaggeration: 1 });
  };

  const [webglSupported, setWebglSupported] = useState(true);

  useEffect(() => {
    setWebglSupported(mapboxgl.supported({ failIfMajorPerformanceCaveat: false }));
  }, []);

  if (!webglSupported) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-slate-100 p-6 text-center text-slate-600">
        <p className="font-medium">Kartan kunde inte laddas</p>
        <p className="text-sm">
          Din webbläsare eller enhet stödjer inte WebGL, som krävs för att visa kartan. Prova en
          annan webbläsare (t.ex. Chrome eller Safari) eller enhet.
        </p>
      </div>
    );
  }

  return (
    <Map
      ref={ref}
      mapboxAccessToken={mapboxToken}
      initialViewState={viewport}
      mapStyle="mapbox://styles/mapbox/light-v11"
      style={{ width: "100%", height: "100%" }}
      interactiveLayerIds={interactiveLayerIds}
      scrollZoom={true}
      onClick={onMapClick}
      onMouseMove={onMapMouseMove}
      onMoveEnd={(evt) => {
        const map = evt.target;
        const center = map.getCenter();
        onViewportChange({ latitude: center.lat, longitude: center.lng, zoom: map.getZoom() });
        emitBounds(map);
      }}
      onLoad={(evt) => {
        const map = evt.target;
        emitBounds(map);
        setupTerrain(map);
        onMapReady?.(map);
      }}
    >
      {children}
    </Map>
  );
});

export default MapboxMapView;
