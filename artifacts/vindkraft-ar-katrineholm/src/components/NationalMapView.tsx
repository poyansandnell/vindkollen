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

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: SWEDEN_CENTER,
      zoom: SWEDEN_ZOOM,
      minZoom: 3,
      maxZoom: 14,
      attributionControl: false,
      pitchWithRotate: false,
      dragRotate: false,
    });
    mapRef.current = map;

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

    // ResizeObserver so the map fills its flex container correctly.
    // On iOS WKWebView the initial layout often isn't committed when MapLibre
    // first queries the canvas size, resulting in a 0×0 (black) canvas.
    // Calling resize() once immediately and again after a short delay ensures
    // the canvas picks up the real container dimensions regardless of timing.
    const ro = new ResizeObserver(() => { map.resize(); });
    if (containerRef.current) ro.observe(containerRef.current);
    // First forced resize — handles the common case where the flex container
    // already has its correct size by the time we register the observer but
    // MapLibre hasn't queried it yet.
    map.resize();
    // Second forced resize after a tick — catches slower WKWebView layouts
    // where the container height is still 0 at synchronous call time.
    const resizeTimerId = setTimeout(() => { map.resize(); }, 150);

    map.on('load', () => {
      // GeoJSON source with MapLibre clustering (handles thousands of markers natively)
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: buildGeoJSON(filteredProjectsRef.current),
        cluster: true,
        clusterMaxZoom: 8,
        clusterRadius: 55,
      });

      // Cluster circles — orange/amber, size reflects count
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

      // Cluster count text
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

      // Individual project markers — color by status
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

      // Project name labels — only at medium+ zoom
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

      mapReadyRef.current = true;

      // ── Click handlers ──────────────────────────────────────────────────────

      // Cluster → expand zoom
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

      // Individual point → select project
      map.on('click', 'unclustered-point', e => {
        const feature = e.features?.[0];
        if (!feature?.properties) return;
        const projectId = String(feature.properties.id as string);
        const p = projectsRef.current.find(x => String(x.id) === projectId) ?? null;
        setSelectedProject(prev => (prev && String(prev.id) === projectId ? null : p));
      });

      // Empty area → deselect
      map.on('click', e => {
        const hits = map.queryRenderedFeatures(e.point, { layers: ['clusters', 'unclustered-point'] });
        if (!hits.length) setSelectedProject(null);
      });

      // Cursor pointer on hover
      map.on('mouseenter', 'clusters', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'clusters', () => { map.getCanvas().style.cursor = ''; });
      map.on('mouseenter', 'unclustered-point', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'unclustered-point', () => { map.getCanvas().style.cursor = ''; });
    });

    return () => {
      clearTimeout(resizeTimerId);
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

        {/* Återcentrera-knapp */}
        <button
          onClick={() => mapRef.current?.flyTo({ center: SWEDEN_CENTER, zoom: SWEDEN_ZOOM })}
          className="absolute right-3 top-3 z-10 h-9 w-9 rounded-full bg-black/60 text-lg text-white shadow-lg backdrop-blur hover:bg-black/80"
          aria-label="Centrera Sverige"
          title="Centrera Sverige"
        >
          ⊙
        </button>

        {/* Diagnostik-overlay */}
        {loadState === 'ok' && dataSource === 'bundled' && (
          <div className="absolute bottom-8 left-2 right-2 z-10 mx-auto max-w-[90%] rounded-lg bg-black/70 px-3 py-1.5 text-center text-[10px] text-white/50 backdrop-blur">
            Pilotdataset · {projects.length} projekt · full nationell data kommer i nästa version
          </div>
        )}
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
