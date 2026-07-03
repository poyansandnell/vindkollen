import type { MapLayerMouseEvent } from "mapbox-gl";
import type mapboxgl from "mapbox-gl";

export interface MapBounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export interface MapViewport {
  latitude: number;
  longitude: number;
  zoom: number;
}

export interface MapProviderProps {
  viewport: MapViewport;
  onViewportChange: (viewport: MapViewport) => void;
  onBoundsChange: (bounds: MapBounds) => void;
  interactiveLayerIds?: string[];
  onMapClick?: (event: MapLayerMouseEvent) => void;
  onMapMouseMove?: (event: MapLayerMouseEvent) => void;
  /** Fired once after the map (and its terrain DEM source) has finished loading. */
  onMapReady?: (map: mapboxgl.Map) => void;
  children?: React.ReactNode;
}
