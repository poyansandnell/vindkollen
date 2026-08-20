import { forwardRef, useEffect, useState } from "react";
import Map, { type MapRef } from "react-map-gl/mapbox";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { MapProviderProps } from "./types";

interface MapboxMapViewProps extends MapProviderProps {
  mapboxToken: string;
}

function detectInAppBrowser(ua: string = navigator.userAgent): string | null {
  const u = ua.toLowerCase();
  if (u.includes("fban") || u.includes("fbav") || u.includes("fb_iab")) return "Facebook";
  if (u.includes("messenger")) return "Messenger";
  if (u.includes("instagram")) return "Instagram";
  if (u.includes("tiktok") || u.includes("musical_ly")) return "TikTok";
  if (u.includes("snapchat")) return "Snapchat";
  if (u.includes("line/")) return "LINE";
  if (u.includes("micromessenger")) return "WeChat";
  if (u.includes("linkedinapp")) return "LinkedIn";
  if (u.includes("pinterest")) return "Pinterest";
  if (u.includes("twitter")) return "X/Twitter";
  return null;
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
    onMapUnavailable,
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
  const [mapError, setMapError] = useState(false);
  const [inAppApp, setInAppApp] = useState<string | null>(null);

  useEffect(() => {
    const supported = mapboxgl.supported({ failIfMajorPerformanceCaveat: false });
    setWebglSupported(supported);
    if (!supported) {
      setInAppApp(detectInAppBrowser());
    }
  }, []);

  if (!webglSupported) {
    return <MapFallback reason="webgl" inAppApp={inAppApp} onMapUnavailable={onMapUnavailable} />;
  }

  if (mapError) {
    return (
      <MapFallback
        reason="error"
        inAppApp={detectInAppBrowser()}
        onMapUnavailable={onMapUnavailable}
      />
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
      onError={(evt) => {
        // Only surface unrecoverable load-time errors (style/source errors that
        // leave the map blank). Tile-fetch errors during normal browsing are
        // transient and handled silently by Mapbox GL itself.
        const err = (evt as { error?: { status?: number; message?: string } }).error;
        const status = err?.status;
        // 401/403 = bad token, 0 = offline / CSP block; treat these as fatal.
        if (status === 401 || status === 403 || status === 0) {
          setMapError(true);
        }
      }}
    >
      {children}
    </Map>
  );
});

export default MapboxMapView;

type FallbackReason = "webgl" | "error";

function MapFallback({
  reason,
  inAppApp,
  onMapUnavailable,
}: {
  reason: FallbackReason;
  inAppApp: string | null;
  onMapUnavailable?: () => void;
}) {
  const [linkCopied, setLinkCopied] = useState(false);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setLinkCopied(true);
    } catch {
      /* ignore — clipboard access not always available */
    }
  };

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-slate-100 p-6 text-center text-slate-700">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-200 text-3xl">
        🗺️
      </div>

      <div className="space-y-1">
        <p className="text-base font-semibold text-slate-800">Kartan kunde inte laddas</p>
        {reason === "webgl" ? (
          <p className="text-sm text-slate-600">
            Din webbläsare eller enhet stödjer inte WebGL, som krävs för att visa kartan.
          </p>
        ) : (
          <p className="text-sm text-slate-600">
            Kartan misslyckades att starta. Det kan bero på ett nätverksfel eller en
            tillfällig störning.
          </p>
        )}
      </div>

      {/* In-app browser: targeted guidance */}
      {inAppApp ? (
        <div className="w-full max-w-xs rounded-xl border border-slate-300 bg-white p-4 text-left shadow-sm">
          <p className="text-sm font-medium text-slate-800">
            📱 Du öppnade kartan i {inAppApp}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Inbyggda webbläsare i appar som {inAppApp} stödjer ofta inte kartor av den
            här typen. Öppna länken direkt i Chrome eller Safari för att kartan ska
            fungera.
          </p>
          <button
            onClick={handleCopyLink}
            className="mt-3 w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700 active:bg-blue-800"
          >
            {linkCopied ? "✅ Länken kopierad!" : "🔗 Kopiera länk"}
          </button>
          {linkCopied && (
            <p className="mt-2 text-center text-xs text-slate-500">
              Öppna Chrome eller Safari och klistra in länken.
            </p>
          )}
        </div>
      ) : (
        /* Generic device/browser guidance */
        <div className="w-full max-w-xs rounded-xl border border-slate-300 bg-white p-4 text-left shadow-sm">
          <p className="text-sm font-medium text-slate-800">Vad kan du göra?</p>
          <ul className="mt-2 space-y-1.5 text-xs text-slate-600">
            <li>• Prova att öppna sidan i <strong>Chrome</strong> eller <strong>Safari</strong></li>
            <li>• Uppdatera din webbläsare till senaste versionen</li>
            {reason === "error" && (
              <li>
                •{" "}
                <button
                  onClick={() => window.location.reload()}
                  className="font-medium text-blue-600 underline underline-offset-2"
                >
                  Ladda om sidan
                </button>{" "}
                och försök igen
              </li>
            )}
          </ul>
        </div>
      )}

      <p className="max-w-xs text-xs text-slate-400">
        Kartan kräver WebGL – ett modernt grafikstöd som finns i de flesta aktuella
        webbläsare.
      </p>

      {onMapUnavailable && (
        <button
          onClick={onMapUnavailable}
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-300 transition hover:bg-slate-50"
        >
          Bläddra bland vindkraftsorter
        </button>
      )}
    </div>
  );
}
