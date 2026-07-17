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

/**
 * Normaliserar Vindbrukskollens svenska statusvärden till interna engelska värden
 * som matchar getFilterStatuses() och projectStatusColor().
 * API returnerar t.ex. "aktuellt", "samrad", "uppfort" — inte "planned", "operational".
 */
function normalizeStatus(raw: string): string {
  const MAP: Record<string, string> = {
    aktuellt: 'planned',
    inledande_undersokning: 'proposed',
    samrad: 'consultation',
    ansokan_inlamnad: 'consultation',
    andringsansokan: 'permitted',
    beviljat: 'permitted',
    uppfort: 'operational',
    inte_aktuellt: 'cancelled',
    avslaget: 'cancelled',
  };
  return MAP[raw.toLowerCase().replace(/\s/g, '_')] ?? raw;
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

// ─── API / data-source diagnostics ───────────────────────────────────────────

interface ApiDiagState {
  native: boolean;
  buildId: string;
  apiBase: string;
  apiFullUrl: string;
  apiHttpStatus: number | null;
  apiProjectCount: number;
  lastApiError: string | null;
  apiSource: 'bundled' | 'fetching' | 'live' | 'error';
  /** Pipeline-räknare för att spåra var projekt försvinner */
  rawCount: number;
  normalizedCount: number;
  validCoordsCount: number;
}

const API_DIAG_INIT: ApiDiagState = {
  native: false,
  buildId: '',
  apiBase: '',
  apiFullUrl: '',
  apiHttpStatus: null,
  apiProjectCount: 0,
  lastApiError: null,
  apiSource: 'bundled',
  rawCount: 0,
  normalizedCount: 0,
  validCoordsCount: 0,
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
  const [loadState, setLoadState] = useState<'loading' | 'bundled-loading-live' | 'live' | 'live-error'>('loading');
  const [dataSource, setDataSource] = useState<'bundled' | 'api'>('bundled');
  const [selectedProject, setSelectedProject] = useState<ApiProjectArea | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>('alla');
  const [diag, setDiag] = useState<DiagState>({ ...DIAG_INIT });
  const [diagExpanded, setDiagExpanded] = useState(false);
  const [apiDiag, setApiDiag] = useState<ApiDiagState>({ ...API_DIAG_INIT });

  // ── Räknaranimation — räknar snabbt upp verk under laddning ─────────────────
  const [animatedCount, setAnimatedCount] = useState(0);

  // ── Load projects ───────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const native = isNative();
    const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? '';
    const buildId = (import.meta.env.VITE_BUILD_ID as string | undefined) ?? 'dev';
    const apiPath = '/api/wind/project-areas?minLat=55&maxLat=70&minLng=10&maxLng=25';
    // Native-appen körs från capacitor://localhost — relativa URL:er fungerar inte.
    // apiUrl() sätter absolut bas om VITE_API_BASE_URL är definierad, annars relativ.
    const url = apiUrl(apiPath);

    // 1. Visa bundlad data omedelbart
    const bundled = BUNDLED_PROJECTS.filter(
      p => typeof p.centerLat === 'number' && typeof p.centerLng === 'number'
    );
    setProjects(bundled);
    setLoadState('bundled-loading-live');
    setDataSource('bundled');
    setApiDiag({
      native,
      buildId,
      apiBase,
      apiFullUrl: url,
      apiHttpStatus: null,
      apiProjectCount: bundled.length,
      lastApiError: null,
      apiSource: 'fetching',
      rawCount: 0,
      normalizedCount: 0,
      validCoordsCount: 0,
    });

    if (native && !apiBase) {
      // Relativa URL:er fungerar inte i Capacitor — logga tydligt men försök ändå,
      // så att felet syns i diagnostikpanelen på iPhone.
      const warn = 'VITE_API_BASE_URL saknas i native-bygget — relativ URL fungerar inte i Capacitor';
      console.warn('[NationalMap]', warn, { url, native });
      setApiDiag(prev => ({ ...prev, lastApiError: warn }));
    }

    // 2. Hämta live-data
    console.info('[NationalMap] Hämtar projekt', { native, apiBase, url, buildId, bundledCount: bundled.length });

    let httpStatus: number | null = null;
    fetch(url)
      .then(r => {
        httpStatus = r.status;
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setApiDiag(prev => ({ ...prev, apiHttpStatus: r.status }));
        return r.json() as Promise<ApiProjectArea[]>;
      })
      .then(data => {
        if (cancelled) return;

        // ── Pipeline med explicita räknare för diagnostik ──────────────────
        const raw = Array.isArray(data) ? data : [];
        const rawCount = raw.length;

        // Normalisera Vindbrukskollens svenska statusvärden → engelska interna
        const normalized = raw.map(p => ({ ...p, status: normalizeStatus(p.status) }));
        const normalizedCount = normalized.length;

        // Filtrera bort poster utan giltiga koordinater
        const ok = normalized.filter(
          p => typeof p.centerLat === 'number' && typeof p.centerLng === 'number'
        );
        const validCoordsCount = ok.length;

        console.info('[NationalMap] Live-data hämtad', {
          url, rawCount, normalizedCount, validCoordsCount, native,
        });
        setApiDiag(prev => ({
          ...prev,
          apiHttpStatus: prev.apiHttpStatus ?? 200,
          apiProjectCount: validCoordsCount,
          apiSource: validCoordsCount > 0 ? 'live' : 'error',
          rawCount,
          normalizedCount,
          validCoordsCount,
          lastApiError: validCoordsCount === 0
            ? `API svarade OK (${rawCount} poster) men 0 hade giltiga koordinater`
            : null,
        }));
        if (ok.length > 0) {
          setProjects(ok);
          setDataSource('api');
          setLoadState('live');
        } else {
          setLoadState('live-error');
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[NationalMap] Projekt-API misslyckades', {
          url,
          error,
          native,
          httpStatus,
          apiBase,
        });
        setLoadState('live-error');
        setApiDiag(prev => ({
          ...prev,
          apiHttpStatus: httpStatus,
          apiSource: 'error',
          lastApiError: msg,
        }));
      });

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

  // ── Räknaranimation — räknar snabbt upp verk när data laddats ───────────────
  useEffect(() => {
    if (turbineTotal === 0) { setAnimatedCount(0); return; }
    setAnimatedCount(0);
    const duration = 1200; // ms
    const steps = Math.min(turbineTotal, 80);
    const interval = duration / steps;
    let current = 0;
    const id = setInterval(() => {
      current += Math.ceil(turbineTotal / steps);
      if (current >= turbineTotal) {
        setAnimatedCount(turbineTotal);
        clearInterval(id);
      } else {
        setAnimatedCount(current);
      }
    }, interval);
    return () => clearInterval(id);
  }, [turbineTotal]);

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

    // Defer map initialization until the container has a positive height.
    // On iOS Capacitor, WKWebView flex layout may not resolve at mount time,
    // causing getBoundingClientRect() to return height=0 and MapLibre to create
    // an invisible 0-height canvas that cannot be properly resized afterwards.
    let cancelled = false;
    let rafId: number | null = null;
    const disposers: Array<() => void> = [];

    const doInit = () => {
      if (cancelled) return;
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        // Not laid out yet — update diagnostics and retry next animation frame
        setDiag(prev => ({
          ...prev,
          webGLSupported: true,
          containerW: rect.width,
          containerH: rect.height,
        }));
        rafId = requestAnimationFrame(doInit);
        return;
      }
      addLog(`Container: ${rect.width.toFixed(0)}×${rect.height.toFixed(0)}`, {
        webGLSupported: true,
        containerW: rect.width,
        containerH: rect.height,
      });

    // 2. Create map with primary (ESRI satellite) style
    let map!: maplibregl.Map;
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

    map.on('error', (ev) => {
      console.error('[NationalMap] EDITOR MAP ERROR', (ev as { error?: Error }).error ?? ev);
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

    // ── Helper: add project GeoJSON source + layers + click handlers ──────────
    // Called once after initial load AND again if we switch to the fallback style.
    let layersAdded = false;
    function addProjectLayers() {
      if (layersAdded) return;
      layersAdded = true;

      // Use bundled projects as eager fallback — filteredProjectsRef may still be []
      // when the load event fires because React state updates haven't yet propagated
      // through a re-render (the projects effect and ref-sync effect run after paint).
      const initData = filteredProjectsRef.current.length > 0
        ? filteredProjectsRef.current
        : BUNDLED_PROJECTS.filter(p => typeof p.centerLat === 'number' && typeof p.centerLng === 'number');
      const geoJson = buildGeoJSON(initData);
      console.info('[NationalMap] GeoJSON features:', geoJson.features.length, '(', initData.length, 'proj)');
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: geoJson,
        cluster: true,
        clusterMaxZoom: 8,
        clusterRadius: 12,
      });
      addLog(`Source "${SOURCE_ID}" added (${geoJson.features.length} features)`, { sourceAdded: true });

      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': ['step', ['get', 'point_count'], '#FF8B01', 10, '#FFB347', 30, '#FF6B00'],
          'circle-radius': ['step', ['get', 'point_count'], 9, 25, 11, 100, 13, 500, 15, 1000, 17],
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
          'text-size': 11,
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
            'permitted', '#FF8B01',
            'under_construction', '#FF8B01',
            'planned', '#3B82F6',
            'proposed', '#3B82F6',
            'consultation', '#3B82F6',
            '#94a3b8',
          ],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2.5, 7, 4, 10, 6],
          'circle-stroke-width': 1.5,
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

      // fitBounds to Sweden after layers are ready — more reliable than center+zoom
      // in the Map() constructor on iOS where the canvas may not have its final size yet.
      map.fitBounds(
        [[10.5, 55.2], [24.2, 69.1]] as [[number, number], [number, number]],
        { padding: 20, maxZoom: 6, duration: 0, animate: false },
      );

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

    // Only switch to fallback on STYLE-LEVEL errors, not individual tile failures.
    // Tile errors (ev.sourceId is set) are common on iOS/Capacitor due to ATS/CORS
    // restrictions on arcgisonline.com — logging them is enough, switching style
    // would destroy the project layers unnecessarily.
    let fallbackSwitched = false;
    map.on('error', e => {
      const ev = e as unknown as { sourceId?: string; error?: { message?: string } | unknown };
      const msg = (ev.error as { message?: string } | undefined)?.message ?? String(ev.error ?? 'unknown');
      if (ev.sourceId) {
        // Tile / source-data error — normal on iOS, keep current style
        addLog(`Tile error (${ev.sourceId}): ${msg.slice(0, 80)}`);
        return;
      }
      addLog(`STYLE ERROR: ${msg}`, { lastError: msg });
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

    const updateContainerDims = () => {
      const r = container.getBoundingClientRect();
      setDiag(prev => ({ ...prev, containerW: r.width, containerH: r.height }));
    };

    const ro = new ResizeObserver(() => {
      if (cancelled) return;
      map.resize();
      requestAnimationFrame(() => { if (!cancelled) map.resize(); });
      updateCanvasSize();
      updateContainerDims();
    });
    ro.observe(container);

    map.resize();
    requestAnimationFrame(() => { if (!cancelled) map.resize(); });
    updateContainerDims();
    const t1 = setTimeout(() => { if (!cancelled) { map.resize(); updateCanvasSize(); updateContainerDims(); addLog('resize @150ms'); } }, 150);
    const t2 = setTimeout(() => { if (!cancelled) { map.resize(); updateCanvasSize(); updateContainerDims(); addLog('resize @500ms'); } }, 500);
    const t3 = setTimeout(() => { if (!cancelled) { map.resize(); updateCanvasSize(); updateContainerDims(); addLog('resize @1500ms'); } }, 1500);

    disposers.push(
      () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); },
      () => { ro.disconnect(); },
      () => { mapReadyRef.current = false; try { map.remove(); } catch {} mapRef.current = null; },
    );
    }; // end doInit

    rafId = requestAnimationFrame(doInit);

    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      disposers.forEach(fn => fn());
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
      console.info('[NationalMap] MapLibre source updated with', filteredProjects.length, 'live projects');
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
    <div className="nm-page">
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
              : loadState === 'bundled-loading-live'
                ? `${filteredProjects.length} projekt · hämtar live…`
                : `${filteredProjects.length} projekt${turbineTotal > 0 ? ` · ${turbineTotal} verk` : ''}`}
          </h1>
          {/* Räknaranimation — visas under laddning och strax efter */}
          {animatedCount > 0 && animatedCount < turbineTotal && (
            <div className="mt-0.5 flex items-center gap-1.5">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[#FF8B01] transition-all duration-75"
                  style={{ width: `${(animatedCount / turbineTotal) * 100}%` }}
                />
              </div>
              <span className="shrink-0 tabular-nums text-[10px] text-[#FFB347]">
                {animatedCount.toLocaleString('sv-SE')} verk
              </span>
            </div>
          )}
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

      {/* MapLibre GL-karta */}
      <div className="nm-viewport">
        {/* Kartbehållare — MapLibre monteras här */}
        <div ref={containerRef} className="nm-canvas" />

        {/* Återcentrera-knapp */}
        <button
          onClick={() => mapRef.current?.flyTo({ center: SWEDEN_CENTER, zoom: SWEDEN_ZOOM })}
          className="absolute right-3 top-10 z-10 h-9 w-9 rounded-full bg-black/60 text-lg text-white shadow-lg backdrop-blur hover:bg-black/80"
          aria-label="Centrera Sverige"
          title="Centrera Sverige"
        >
          ⊙
        </button>

        {/* MapLibre runtime diagnostics — visas endast i dev-builds (import.meta.env.DEV) */}
        {import.meta.env.DEV && <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-50">
        <div className="nm-diag pointer-events-auto text-[10px] font-mono text-white/90">
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

          {/* API / data-source diagnostics */}
          <div className="border-b border-white/10 px-2 py-1">
            <div className="mb-0.5 text-[8px] font-bold uppercase text-[#FFB347]/80">API & Datakälla</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[9px]">
              <span className={apiDiag.native ? 'text-[#FFB347]' : 'text-white/60'}>
                Native: {apiDiag.native ? 'ja (Capacitor)' : 'nej (webb)'}
              </span>
              <span className="text-white/60">
                Build: {apiDiag.buildId || '…'}
              </span>
              <span className="col-span-2 break-all text-white/50">
                API-bas: {apiDiag.apiBase || '(relativ)'}
              </span>
              <span className="col-span-2 break-all text-white/50">
                URL: {apiDiag.apiFullUrl || '…'}
              </span>
              <span className={
                apiDiag.apiHttpStatus === 200 ? 'text-green-400'
                : apiDiag.apiHttpStatus != null ? 'text-red-400'
                : 'text-yellow-400'
              }>
                HTTP: {apiDiag.apiHttpStatus ?? '…'}
              </span>
              <span className={
                apiDiag.apiSource === 'live' ? 'text-green-400'
                : apiDiag.apiSource === 'error' ? 'text-red-400'
                : apiDiag.apiSource === 'fetching' ? 'text-yellow-400'
                : 'text-white/50'
              }>
                Källa: {apiDiag.apiSource} · {apiDiag.apiProjectCount} proj
              </span>
              {apiDiag.rawCount > 0 && (
                <span className="col-span-2 text-white/50">
                  Raw: {apiDiag.rawCount} → Norm: {apiDiag.normalizedCount} → Coords: {apiDiag.validCoordsCount}
                </span>
              )}
            </div>
            {apiDiag.lastApiError && (
              <div className="mt-0.5 break-all text-[9px] text-red-400">
                ⚠ {apiDiag.lastApiError}
              </div>
            )}
          </div>

          {/* MapLibre status grid */}
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

          {/* Map error */}
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
        </div>}{/* /nm-diag + DEV-gate */}
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
            {loadState === 'loading' || loadState === 'bundled-loading-live' ? (
              <p className="text-sm text-white/50">
                {loadState === 'bundled-loading-live'
                  ? 'Visar pilotdataset – hämtar live-data…'
                  : 'Laddar projekt…'}
              </p>
            ) : (
              <>
                {loadState === 'live-error' && (
                  <p className="mb-1 text-[11px] text-yellow-400/90">
                    ⚠️ Live-data kunde inte hämtas — pilotdataset visas
                  </p>
                )}
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
