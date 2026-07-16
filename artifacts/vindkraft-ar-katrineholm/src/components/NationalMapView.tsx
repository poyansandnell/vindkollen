/**
 * NationalMapView — MapLibre GL-baserad Sverigeöversikt med kluster, statusfilter
 * och projektkort. Ersätter den CSS-transform-baserade NationalView.
 *
 * Tiles: ESRI World Imagery (satellitbild, ingen API-nyckel).
 * Kluster: MapLibres inbyggda GeoJSON-kluster — inga individuella DOM-markörer.
 */
import maplibregl from 'maplibre-gl';
import type { GeoJSONSource, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BUNDLED_PROJECTS, type ApiProjectArea } from '@/lib/bundledProjects';
import { apiUrl } from '@/lib/apiUrl';
import { isNative } from '@/lib/capacitorBridge';

// ─── Status helpers ──────────────────────────────────────────────────────────

function projectStatusColor(status: string): string {
  if (status === 'operational') return '#22c55e';
  if (status === 'cancelled') return '#94a3b8';
  if (status === 'permitted' || status === 'under_construction') return '#eab308';
  return '#FF8B01';
}

function statusLabel(status: string): string {
  const m: Record<string, string> = {
    planned: 'Planerat', proposed: 'Föreslaget', consultation: 'Samråd',
    permitted: 'Beviljat', under_construction: 'Under byggnation',
    operational: 'Driftsatt', cancelled: 'Avbrutet',
  };
  return m[status] ?? status;
}

// ─── Filter ───────────────────────────────────────────────────────────────────

export type FilterMode = 'aktuella' | 'planerade' | 'pågående' | 'befintliga' | 'alla';

const FILTER_LABELS: Record<FilterMode, string> = {
  aktuella: 'Aktuella', planerade: 'Planerade', pågående: 'Pågående',
  befintliga: 'Befintliga', alla: 'Alla',
};

function getFilterStatuses(mode: FilterMode): string[] | null {
  if (mode === 'alla') return null;
  if (mode === 'planerade') return ['planned', 'proposed', 'consultation'];
  if (mode === 'pågående') return ['permitted', 'under_construction'];
  if (mode === 'befintliga') return ['operational'];
  return ['planned', 'proposed', 'consultation', 'permitted', 'under_construction'];
}

// ─── Map style (ESRI satellite, ingen API-nyckel) ────────────────────────────

const MAP_STYLE: StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    satellite: {
      type: 'raster',
      // Absolute HTTPS — works from both capacitor://localhost and http contexts.
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: '© Esri',
      maxzoom: 18,
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0a0a0a' } },
    { id: 'satellite', type: 'raster', source: 'satellite' },
  ],
};

// ─── Fallback style (OpenStreetMap raster) ────────────────────────────────────
// Aktiveras automatiskt om ESRI-stilen ger ett MapLibre error-event.
// Inga glyph-beroende textlager — fungerar utan tillgång till font-CDN.

const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
      maxzoom: 19,
    },
  },
  layers: [
    { id: 'osm-bg', type: 'background', paint: { 'background-color': '#1a1a2e' } },
    { id: 'osm-tiles', type: 'raster', source: 'osm' },
  ],
};

// ─── Runtime diagnostics ─────────────────────────────────────────────────────

interface DiagState {
  webGLSupported: boolean;
  mapCreated: boolean;
  containerW: number;
  containerH: number;
  styleLoaded: boolean;
  sourceAdded: boolean;
  layerAdded: boolean;
  canvasW: number;
  canvasH: number;
  lastError: string | null;
  webGLContextLost: boolean;
  usingFallback: boolean;
  log: string[]; // newest first, max 25
}

const DIAG_INIT: DiagState = {
  webGLSupported: false,
  mapCreated: false,
  containerW: 0,
  containerH: 0,
  styleLoaded: false,
  sourceAdded: false,
  layerAdded: false,
  canvasW: 0,
  canvasH: 0,
  lastError: null,
  webGLContextLost: false,
  usingFallback: false,
  log: [],
};

// ─── GeoJSON ──────────────────────────────────────────────────────────────────

interface ProjectFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    id: string;
    name: string;
    status: string;
    kommun: string;
    turbineCountMin: number;
    turbineCountMax: number;
  };
}

function buildGeoJSON(projects: ApiProjectArea[]): { type: 'FeatureCollection'; features: ProjectFeature[] } {
  return {
    type: 'FeatureCollection',
    features: projects
      .filter(p => typeof p.centerLat === 'number' && typeof p.centerLng === 'number')
      .map(p => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.centerLng!, p.centerLat!] },
        properties: {
          id: String(p.id),
          name: p.name,
          status: p.status,
          kommun: p.kommun ?? '',
          turbineCountMin: p.turbineCountPlannedMin ?? 0,
          turbineCountMax: p.turbineCountPlannedMax ?? p.turbineCountPlannedMin ?? 0,
        },
      })),
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SWEDEN_CENTER: [number, number] = [15.5, 62.5];
const SWEDEN_ZOOM = 4.5;
const SOURCE_ID = 'projects';

// ─── Component ───────────────────────────────────────────────────────────────

export function NationalMapView({
  onEnterEditor,
  onBack,
}: {
  onEnterEditor: (project: ApiProjectArea) => void;
  onBack: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapReadyRef = useRef(false);

  // Refs for stale-closure-safe access inside map event handlers
  const projectsRef = useRef<ApiProjectArea[]>([]);
  const filteredProjectsRef = useRef<ApiProjectArea[]>([]);

  const [projects, setProjects] = useState<ApiProjectArea[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [dataSource, setDataSource] = useState<'bundled' | 'api'>('bundled');
  const [selectedProject, setSelectedProject] = useState<ApiProjectArea | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>('aktuella');
  const [diag, setDiag] = useState<DiagState>({ ...DIAG_INIT });
  const [diagExpanded, setDiagExpanded] = useState(true);

  // ── Load projects ───────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const bundled = BUNDLED_PROJECTS.filter(
      p => typeof p.centerLat === 'number' && typeof p.centerLng === 'number'
    );
    setProjects(bundled);
    setLoadState('ok');
    setDataSource('bundled');

    const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? '';
    if (isNative() && !apiBase) return;

    const url = apiUrl('/api/wind/project-areas?minLat=55&maxLat=70&minLng=10&maxLng=25');
    fetch(url)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<ApiProjectArea[]>; })
      .then(data => {
        if (cancelled) return;
        const ok = (Array.isArray(data) ? data : []).filter(
          p => typeof p.centerLat === 'number' && typeof p.centerLng === 'number'
        );
        if (ok.length > 0) { setProjects(ok); setDataSource('api'); }
      })
      .catch(() => { /* bundled data still shown */ });

    return () => { cancelled = true; };
  }, []);

  // Keep ref in sync with state
  useEffect(() => { projectsRef.current = projects; }, [projects]);

  // ── Filtered projects ───────────────────────────────────────────────────────
  const filteredProjects = useMemo(() => {
    const allowed = getFilterStatuses(filterMode);
    return projects.filter(p => allowed === null || allowed.includes(p.status));
  }, [projects, filterMode]);

  useEffect(() => { filteredProjectsRef.current = filteredProjects; }, [filteredProjects]);

  // ── Turbine count total for display ────────────────────────────────────────
  const turbineTotal = useMemo(
    () => filteredProjects.reduce((s, p) => s + (p.turbineCountPlannedMin ?? 0), 0),
    [filteredProjects]
  );

  // ── Init MapLibre GL ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const ts = () => new Date().toISOString().slice(11, 23);
    const addLog = (msg: string, patch?: Partial<Omit<DiagState, 'log'>>) => {
      setDiag(prev => ({
        ...prev,
        ...(patch ?? {}),
        log: [`${ts()} ${msg}`, ...prev.log].slice(0, 25),
      }));
    };

    // 1. WebGL support check — maplibregl.supported() removed in v5; use canvas probe
    const webGLSupported = (() => {
      try {
        const c = document.createElement('canvas');
        return !!(c.getContext('webgl2') ?? c.getContext('webgl') ?? c.getContext('experimental-webgl'));
      } catch { return false; }
    })();
    if (!webGLSupported) {
      addLog('WebGL NOT supported on this device — cannot create map', {
        webGLSupported: false,
        lastError: 'WebGL not supported',
      });
      return;
    }

    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    addLog(`Container: ${rect.width.toFixed(0)}×${rect.height.toFixed(0)}`, {
      webGLSupported: true,
      containerW: rect.width,
      containerH: rect.height,
    });

    // 2. Create map with primary (ESRI satellite) style
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container,
        style: MAP_STYLE,
        center: SWEDEN_CENTER,
        zoom: SWEDEN_ZOOM,
        minZoom: 3,
        maxZoom: 14,
        attributionControl: false,
        pitchWithRotate: false,
        dragRotate: false,
      });
    } catch (err) {
      addLog(`Map() threw: ${String(err)}`, { lastError: String(err), mapCreated: false });
      return;
    }
    mapRef.current = map;
    addLog('Map() created · style=ESRI satellite', { mapCreated: true });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

    // ── Helper: add project GeoJSON source + layers + click handlers ──────────
    // Called once after initial load AND again if we switch to the fallback style.
    let layersAdded = false;
    function addProjectLayers() {
      if (layersAdded) return;
      layersAdded = true;

      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: buildGeoJSON(filteredProjectsRef.current),
        cluster: true,
        clusterMaxZoom: 8,
        clusterRadius: 55,
      });
      addLog(`Source "${SOURCE_ID}" added (${filteredProjectsRef.current.length} proj)`, { sourceAdded: true });

      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': ['step', ['get', 'point_count'], '#FF8B01', 10, '#FFB347', 30, '#FF6B00'],
          'circle-radius': ['step', ['get', 'point_count'], 18, 10, 24, 30, 30],
          'circle-opacity': 0.9,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#090909',
        },
      });
      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
          'text-size': 12,
        },
        paint: { 'text-color': '#090909' },
      });
      map.addLayer({
        id: 'unclustered-point',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['match', ['get', 'status'],
            'operational', '#22c55e',
            'cancelled', '#94a3b8',
            'permitted', '#eab308',
            'under_construction', '#eab308',
            '#FF8B01',
          ],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 6, 10, 9],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#090909',
          'circle-opacity': 0.95,
        },
      });
      map.addLayer({
        id: 'project-label',
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        minzoom: 7,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
          'text-size': 11,
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
          'text-max-width': 8,
        },
        paint: {
          'text-color': ['match', ['get', 'status'],
            'operational', '#22c55e',
            'cancelled', '#94a3b8',
            'permitted', '#eab308',
            'under_construction', '#eab308',
            '#FF8B01',
          ],
          'text-halo-color': '#090909',
          'text-halo-width': 1.5,
        },
      });
      addLog('Layers added (clusters · points · labels)', { layerAdded: true });

      mapReadyRef.current = true;

      map.on('click', 'clusters', e => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
        if (!features.length) return;
        const clusterId = features[0].properties.cluster_id as number;
        const geom = features[0].geometry as { type: 'Point'; coordinates: [number, number] };
        (map.getSource(SOURCE_ID) as GeoJSONSource)
          .getClusterExpansionZoom(clusterId)
          .then(zoom => { map.easeTo({ center: geom.coordinates, zoom: zoom + 0.5 }); })
          .catch(() => {});
      });
      map.on('click', 'unclustered-point', e => {
        const feature = e.features?.[0];
        if (!feature?.properties) return;
        const projectId = String(feature.properties.id as string);
        const p = projectsRef.current.find(x => String(x.id) === projectId) ?? null;
        setSelectedProject(prev => (prev && String(prev.id) === projectId ? null : p));
      });
      map.on('click', e => {
        const hits = map.queryRenderedFeatures(e.point, { layers: ['clusters', 'unclustered-point'] });
        if (!hits.length) setSelectedProject(null);
      });
      map.on('mouseenter', 'clusters', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'clusters', () => { map.getCanvas().style.cursor = ''; });
      map.on('mouseenter', 'unclustered-point', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'unclustered-point', () => { map.getCanvas().style.cursor = ''; });
    }

    // 3. Event listeners — log everything to the diagnostic panel
    let styleLoadCount = 0;
    map.on('style.load', () => {
      styleLoadCount++;
      const canvas = map.getCanvas();
      addLog(
        `style.load #${styleLoadCount} · canvas ${canvas.width}×${canvas.height}`,
        { styleLoaded: true, canvasW: canvas.width, canvasH: canvas.height },
      );
      // style.load #2+ = we just switched to the fallback style — re-add layers
      if (styleLoadCount > 1) {
        layersAdded = false;
        mapReadyRef.current = false;
        addProjectLayers();
        map.resize();
      }
    });

    map.on('load', () => {
      const canvas = map.getCanvas();
      addLog(`load event · canvas ${canvas.width}×${canvas.height}`, {
        canvasW: canvas.width,
        canvasH: canvas.height,
      });
      addProjectLayers();
      map.resize();
    });

    map.on('sourcedata', e => {
      const src = (e as unknown as { sourceId?: string; isSourceLoaded?: boolean });
      addLog(`sourcedata: ${src.sourceId ?? '?'} loaded=${String(src.isSourceLoaded ?? '?')}`);
    });

    map.on('data', e => {
      const d = (e as unknown as { dataType?: string; sourceId?: string });
      if (d.dataType && d.dataType !== 'other') {
        addLog(`data: type=${d.dataType}${d.sourceId ? ` src=${d.sourceId}` : ''}`);
      }
    });

    // Automatic fallback on first error — but only switch once
    let fallbackSwitched = false;
    map.on('error', e => {
      const msg = (e as unknown as { error?: { message?: string } }).error?.message
        ?? String((e as unknown as { error?: unknown }).error ?? 'unknown error');
      addLog(`ERROR: ${msg}`, { lastError: msg });
      if (!fallbackSwitched) {
        fallbackSwitched = true;
        addLog('→ switching to OSM fallback style', { usingFallback: true });
        try { map.setStyle(FALLBACK_STYLE); } catch (err2) {
          addLog(`setStyle(fallback) threw: ${String(err2)}`);
        }
      }
    });

    map.on('webglcontextlost', () => {
      addLog('webglcontextlost!', { webGLContextLost: true });
    });
    map.on('webglcontextrestored', () => {
      addLog('webglcontextrestored', { webGLContextLost: false });
    });

    // 4. Resize cascade — iOS WKWebView often has container size=0 at Map() time
    const updateCanvasSize = () => {
      const r = container.getBoundingClientRect();
      const c = map.getCanvas();
      setDiag(prev => ({
        ...prev,
        containerW: r.width,
        containerH: r.height,
        canvasW: c.width,
        canvasH: c.height,
      }));
    };

    const ro = new ResizeObserver(() => { map.resize(); updateCanvasSize(); });
    ro.observe(container);

    map.resize();          // immediate — catches already-laid-out containers
    const t1 = setTimeout(() => { map.resize(); updateCanvasSize(); addLog('resize @150ms'); }, 150);
    const t2 = setTimeout(() => { map.resize(); updateCanvasSize(); addLog('resize @500ms'); }, 500);
    const t3 = setTimeout(() => { map.resize(); updateCanvasSize(); addLog('resize @1500ms'); }, 1500);

    return () => {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
      ro.disconnect();
      mapReadyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []); // mount-only

  // ── Update source data when filtered projects change ──────────────────────
  useEffect(() => {
    filteredProjectsRef.current = filteredProjects;
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    try {
      (map.getSource(SOURCE_ID) as GeoJSONSource | undefined)
        ?.setData(buildGeoJSON(filteredProjects) as Parameters<GeoJSONSource['setData']>[0]);
    } catch { /* map may be mid-init */ }
  }, [filteredProjects]);

  // ── Sync selectedProject when projects list refreshes ────────────────────
  useEffect(() => {
    if (!selectedProject) return;
    const updated = projects.find(p => String(p.id) === String(selectedProject.id));
    if (!updated) setSelectedProject(null);
    else if (updated !== selectedProject) setSelectedProject(updated);
  }, [projects]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[#090909] text-white">
      {/* Sidhuvud */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 pt-[max(env(safe-area-inset-top),12px)]">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#FFB347]">
            Vindkraft i Sverige{' '}
            <span className="font-normal normal-case text-white/40">
              {dataSource === 'bundled' ? '· pilotdataset' : '· live'}
            </span>
          </p>
          <h1 className="text-sm font-bold text-white">
            {loadState === 'loading'
              ? 'Laddar projekt…'
              : `${filteredProjects.length} projekt${turbineTotal > 0 ? ` · ${turbineTotal} verk` : ''}`}
          </h1>
        </div>
        <button
          onClick={onBack}
          className="rounded-full bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20"
        >
          ← Tillbaka
        </button>
      </div>

      {/* Statusfilter-pills */}
      <div className="flex gap-2 overflow-x-auto border-b border-white/10 px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {(['aktuella', 'planerade', 'pågående', 'befintliga', 'alla'] as FilterMode[]).map(mode => (
          <button
            key={mode}
            onClick={() => setFilterMode(mode)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filterMode === mode
                ? 'bg-[#FF8B01] text-[#090909]'
                : 'bg-white/10 text-white hover:bg-white/20'
            }`}
          >
            {FILTER_LABELS[mode]}
          </button>
        ))}
      </div>

      {/* MapLibre GL-karta — fyllde sin flex-1-behållare */}
      <div className="relative min-h-0 flex-1">
        {/* Kartbehållare — MapLibre monteras här */}
        <div ref={containerRef} className="absolute inset-0" />

        {/* TEST 11 debug badge — permanent tills kartan fungerar på iPhone */}
        <div className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2 rounded-full bg-[#FF8B01] px-4 py-1 text-[11px] font-bold text-[#090909] shadow-lg">
          TEST 11 MAP DEBUG
        </div>

        {/* Återcentrera-knapp */}
        <button
          onClick={() => mapRef.current?.flyTo({ center: SWEDEN_CENTER, zoom: SWEDEN_ZOOM })}
          className="absolute right-3 top-10 z-10 h-9 w-9 rounded-full bg-black/60 text-lg text-white shadow-lg backdrop-blur hover:bg-black/80"
          aria-label="Centrera Sverige"
          title="Centrera Sverige"
        >
          ⊙
        </button>

        {/* MapLibre runtime diagnostics — visas alltid på skärmen (för felsökning på iOS) */}
        <div className="absolute bottom-0 left-0 right-0 z-20 max-h-[55%] overflow-y-auto bg-black/85 text-[10px] font-mono text-white/90 backdrop-blur-sm">
          {/* Header row */}
          <div className="flex items-center justify-between border-b border-white/20 px-2 py-1">
            <span className="font-bold text-[#FFB347]">MapLibre diagnostik</span>
            <button
              onClick={() => setDiagExpanded(v => !v)}
              className="rounded px-1.5 py-0.5 text-white/50 hover:bg-white/10"
            >
              {diagExpanded ? '▴ Dölj' : '▾ Visa'}
            </button>
          </div>

          {/* Status grid */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 px-2 py-1 text-[9px]">
            <span className={diag.webGLSupported ? 'text-green-400' : 'text-red-400'}>
              WebGL: {diag.webGLSupported ? '✓' : '✗ NOT SUPPORTED'}
            </span>
            <span className={diag.mapCreated ? 'text-green-400' : 'text-yellow-400'}>
              Map created: {diag.mapCreated ? '✓' : '…'}
            </span>
            <span className={diag.containerW > 0 ? 'text-green-400' : 'text-red-400'}>
              Container: {diag.containerW.toFixed(0)}×{diag.containerH.toFixed(0)}
            </span>
            <span className={diag.canvasW > 0 ? 'text-green-400' : 'text-red-400'}>
              Canvas: {diag.canvasW}×{diag.canvasH}
            </span>
            <span className={diag.styleLoaded ? 'text-green-400' : 'text-yellow-400'}>
              style.load: {diag.styleLoaded ? '✓' : '…'}
            </span>
            <span className={diag.sourceAdded ? 'text-green-400' : 'text-yellow-400'}>
              Source: {diag.sourceAdded ? '✓' : '…'}
            </span>
            <span className={diag.layerAdded ? 'text-green-400' : 'text-yellow-400'}>
              Layers: {diag.layerAdded ? '✓' : '…'}
            </span>
            <span className={diag.webGLContextLost ? 'text-red-400' : 'text-white/40'}>
              Context: {diag.webGLContextLost ? '✗ LOST' : 'ok'}
            </span>
            {diag.usingFallback && (
              <span className="col-span-2 text-yellow-400">⚠️ OSM fallback aktiv</span>
            )}
          </div>

          {/* Error */}
          {diag.lastError && (
            <div className="border-t border-red-500/30 bg-red-900/40 px-2 py-1">
              <span className="font-bold text-red-400">FEL: </span>
              <span className="text-red-300">{diag.lastError}</span>
            </div>
          )}

          {/* Event log */}
          {diagExpanded && diag.log.length > 0 && (
            <div className="border-t border-white/10 px-2 py-1">
              {diag.log.map((entry, i) => (
                <div
                  key={i}
                  className={entry.includes('ERROR') ? 'text-red-400' : entry.includes('→') ? 'text-yellow-400' : 'text-white/60'}
                >
                  {entry}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Projektkort */}
      <div className="bg-[#090909] px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-4">
        {selectedProject ? (
          <div className="rounded-2xl border border-white/10 bg-[#131313] p-4">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#FFB347]">
                  {selectedProject.kommun ?? ''}
                </p>
                <h2 className="mt-0.5 text-base font-bold leading-tight text-white">
                  {selectedProject.name}
                </h2>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-white/60">
                  {selectedProject.turbineCountPlannedMin != null && (
                    <span>
                      {selectedProject.turbineCountPlannedMin}
                      {selectedProject.turbineCountPlannedMax &&
                        selectedProject.turbineCountPlannedMax !== selectedProject.turbineCountPlannedMin &&
                        `–${selectedProject.turbineCountPlannedMax}`}{' '}
                      {selectedProject.status === 'operational' ? 'befintliga verk' : 'planerade verk'}
                    </span>
                  )}
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: projectStatusColor(selectedProject.status) + '25',
                      color: projectStatusColor(selectedProject.status),
                    }}
                  >
                    {statusLabel(selectedProject.status)}
                  </span>
                </p>
              </div>
              <button
                onClick={() => setSelectedProject(null)}
                className="shrink-0 rounded-full bg-white/10 p-1.5 text-white/50 hover:bg-white/20 hover:text-white"
              >
                ✕
              </button>
            </div>
            <button
              onClick={() => onEnterEditor(selectedProject)}
              className="w-full rounded-full bg-[#FF8B01] py-3 text-sm font-bold text-[#090909] shadow-lg shadow-[#FF8B01]/20 transition hover:bg-[#FFB347] active:bg-[#FF8B01]"
            >
              📐 Öppna projektet
            </button>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-[#131313] px-4 py-3 text-center">
            {loadState === 'loading' ? (
              <p className="text-sm text-white/50">Laddar projekt…</p>
            ) : (
              <>
                <p className="text-sm text-white/50">Tryck på ett projekt på kartan</p>
                <p className="mt-1 text-[10px] text-white/30">
                  {filteredProjects.length} projekt · {turbineTotal} verk ·{' '}
                  {dataSource === 'bundled'
                    ? `pilotdataset (${projects.length} av alla)`
                    : `live (${projects.length} projekt)`}
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
