import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { apiUrl } from "@/lib/apiUrl";
import { consumeFreshPlaceraFlag, isNative, openSverigekartan } from "@/lib/capacitorBridge";
import { PlacementMap } from "@/components/PlacementMap";
import { PlacementScorePanel } from "@/components/PlacementScorePanel";
import {
  PLACEMENT_LEVEL_COLORS,
  scorePlacement,
  type LocationContext,
  type PlacedTurbine,
} from "@/lib/placementScoring";
import {
  boundaryToGeoJson,
  getActiveBoundary,
  hasCustomBoundary,
  resetCustomBoundary,
  setCustomBoundary,
  type LatLon,
} from "@/lib/ericsbergArea";
import { lon2tileX, lat2tileY, ESRI_WORLD_IMAGERY_URL } from "@/lib/webMercatorTiles";
import { BUNDLED_PROJECTS, type ApiProjectArea } from "@/lib/bundledProjects";

const SAVED_KEY = "vindkraft-ar-katrineholm:savedPlacements";
const AR_HANDOFF_KEY = "vindkraft-ar-katrineholm:customPlacement";
const EDIT_HANDOFF_KEY = "vindkraft:editHandoff";

// ─── API-typer och hjälpfunktioner för nationellt projektläge ─────────────
// ApiProjectArea importeras från @/lib/bundledProjects — delas med bundlade projekt.

/** Konverterar API GeoJSON Polygon/MultiPolygon till LatLon[] för gränseditorn. */
function apiPolygonToLatLon(polygon: ApiProjectArea["polygon"]): LatLon[] | null {
  if (!polygon?.coordinates) return null;
  const { type, coordinates } = polygon;
  let ring: unknown[];
  if (type === "Polygon" && Array.isArray(coordinates)) {
    ring = (coordinates as unknown[][])[0];
  } else if (type === "MultiPolygon" && Array.isArray(coordinates)) {
    ring = ((coordinates as unknown[][][])[0])[0];
  } else {
    return null;
  }
  if (!Array.isArray(ring) || ring.length < 3) return null;
  return (ring as [number, number][]).map(([lon, lat]) => ({ lat, lon }));
}

/** Status → markörfärg. orange = planerat/samråd, gul = beviljat/byggnation, grön = driftsatt, grå = avbrutet. */
function projectStatusColor(status: string): string {
  if (status === "operational") return "#22c55e";
  if (status === "cancelled") return "#94a3b8";
  if (status === "permitted" || status === "under_construction") return "#eab308";
  return "#FF8B01"; // planned / proposed / consultation
}

/** Statusvärde → svensk etikett för visning. */
function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    planned: "Planerat",
    proposed: "Föreslaget",
    consultation: "Samråd",
    permitted: "Beviljat",
    under_construction: "Under byggnation",
    operational: "Driftsatt",
    cancelled: "Avbrutet",
  };
  return labels[status] ?? status;
}

// ─── NationalView ──────────────────────────────────────────────────────────
// Sverigeöversikt med interaktiv karta (pan/zoom/pinch/dubbeltryck) och
// statusfilter. Visar bundlade + API-hämtade projekt som klickbara markörer.
//
// Zoom 5 → 3×4 ESRI-plattor täcker Sverige (lon 0-33.75°E, lat ~55-69°N):
//   x: 16 (0°), 17 (11.25°), 18 (22.5°)
//   y:  7 (≈69°N),  8 (≈66°N),  9 (≈61°N), 10 (≈55°N)
const NATIONAL_ZOOM = 5;
const NATIONAL_X1 = 16,
  NATIONAL_X2 = 18;
const NATIONAL_Y1 = 7,
  NATIONAL_Y2 = 10;

type FilterMode = "aktuella" | "planerade" | "pågående" | "befintliga" | "alla";

const FILTER_LABELS: Record<FilterMode, string> = {
  aktuella: "Aktuella",
  planerade: "Planerade",
  pågående: "Pågående",
  befintliga: "Befintliga",
  alla: "Alla",
};

function getFilterStatuses(mode: FilterMode): string[] | null {
  if (mode === "alla") return null;
  if (mode === "planerade") return ["planned", "proposed", "consultation"];
  if (mode === "pågående") return ["permitted", "under_construction"];
  if (mode === "befintliga") return ["operational"];
  // "aktuella" = allt utom operational och cancelled (default)
  return ["planned", "proposed", "consultation", "permitted", "under_construction"];
}

function NationalView({
  onEnterEditor,
  onBack,
}: {
  onEnterEditor: (project: ApiProjectArea) => void;
  onBack: () => void;
}) {
  const tiles = useMemo(() => {
    const cols = NATIONAL_X2 - NATIONAL_X1 + 1;
    const rows = NATIONAL_Y2 - NATIONAL_Y1 + 1;
    const result: { key: string; url: string; left: number; top: number; width: number; height: number }[] = [];
    for (let tx = NATIONAL_X1; tx <= NATIONAL_X2; tx++) {
      for (let ty = NATIONAL_Y1; ty <= NATIONAL_Y2; ty++) {
        result.push({
          key: `${NATIONAL_ZOOM}-${tx}-${ty}`,
          url: ESRI_WORLD_IMAGERY_URL(NATIONAL_ZOOM, tx, ty),
          left: ((tx - NATIONAL_X1) / cols) * 100,
          top: ((ty - NATIONAL_Y1) / rows) * 100,
          width: (1 / cols) * 100,
          height: (1 / rows) * 100,
        });
      }
    }
    return result;
  }, []);

  const [projects, setProjects] = useState<ApiProjectArea[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ok" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<ApiProjectArea | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>("aktuella");

  // ── Pan/zoom state ─────────────────────────────────────────────────────────
  const [mapView, setMapView] = useState({ tx: 0, ty: 0, scale: 1 });
  const mapViewRef = useRef({ tx: 0, ty: 0, scale: 1 });
  useEffect(() => { mapViewRef.current = mapView; }, [mapView]);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  /** Förhindrar click-to-deselect direkt efter en drag-gest. */
  const wasDragRef = useRef(false);
  function clampScale(s: number) { return Math.max(0.7, Math.min(8, s)); }

  useEffect(() => {
    let cancelled = false;

    // ── Steg 1: visa bundlade projekt omedelbart ─────────────────────────────
    // Fungerar offline och på Capacitor native utan nätverkshämtning.
    // På native (iOS/Android) returnerar apiUrl() en relativ URL under
    // capacitor://localhost som inte kan nå en extern server →
    // DOMException "The string did not match the expected pattern."
    // Bundlade data förhindrar detta fel och ger offline-stöd.
    const bundled = BUNDLED_PROJECTS.filter(
      (p) => typeof p.centerLat === "number" && typeof p.centerLng === "number",
    );
    setProjects(bundled);
    setLoadState("ok");
    setLoadError(null);
    console.log(
      `[Vindkollen] Sverigekartan: laddade ${bundled.length} bundlade projekt`,
      bundled.map((p) => `[${p.id}] ${p.name} (${p.kommun ?? "okänd kommun"})`),
    );

    // ── Steg 2: på native utan absolut API-bas — hoppa över fetch ────────────
    // Relativa URL:er (/api/...) fungerar inte under capacitor://localhost.
    const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "";
    if (isNative() && !apiBase) {
      return () => { cancelled = true; };
    }

    // ── Steg 3: på webben — hämta API-data i bakgrunden och ersätt bundlade ──
    // Sverige-bbox: lon 10-25°E, lat 55-70°N
    const url = apiUrl("/api/wind/project-areas?minLat=55&maxLat=70&minLng=10&maxLng=25");
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ApiProjectArea[]>;
      })
      .then((data) => {
        if (cancelled) return;
        const withCoords = (Array.isArray(data) ? data : []).filter(
          (p) => typeof p.centerLat === "number" && typeof p.centerLng === "number",
        );
        if (withCoords.length > 0) {
          setProjects(withCoords);
          console.log(
            `[Vindkollen] Sverigekartan: API-uppdatering — ${withCoords.length} projekt`,
            withCoords.map((p) => `[${p.id}] ${p.name}`),
          );
        }
      })
      .catch((err: Error) => {
        if (cancelled) return;
        // Bundlade data visas redan — logga bara utan att ändra UI-tillstånd
        console.warn(
          "[Vindkollen] Sverigekartan: API-hämtning misslyckades (bundlade data visas):",
          err.message,
          url,
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // ── Interaktiv karta: native touch/wheel/mouse ────────────────────────────
  // Registreras som native listeners (inte React synthetic) för att kunna
  // använda {passive:false} på touchmove och wheel där vi kallar preventDefault.
  useEffect(() => {
    const nullableEl = mapContainerRef.current;
    if (!nullableEl) return;
    // Re-bind as non-null so TypeScript propagates the narrowing into closures
    const el: HTMLDivElement = nullableEl;
    let tdx = 0, tdy = 0, tdtx = 0, tdty = 0, tdMoved = false;
    let pinchDist = 0, pinchMidX = 0, pinchMidY = 0;
    let lastTap = 0;
    let msx = 0, msy = 0, mstx = 0, msty = 0, mouseDown = false;

    function two(t: TouchList) {
      const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
      return { dist: Math.sqrt(dx * dx + dy * dy), mx: (t[0].clientX + t[1].clientX) / 2, my: (t[0].clientY + t[1].clientY) / 2 };
    }

    function onTS(e: TouchEvent) {
      if (e.touches.length === 1) {
        tdx = e.touches[0].clientX; tdy = e.touches[0].clientY;
        tdtx = mapViewRef.current.tx; tdty = mapViewRef.current.ty;
        tdMoved = false;
        const now = Date.now();
        if (now - lastTap < 280) {
          const r = el.getBoundingClientRect();
          const px = e.touches[0].clientX - r.left, py = e.touches[0].clientY - r.top;
          setMapView(v => { const ns = clampScale(v.scale < 3 ? v.scale * 2 : 1), f = ns / v.scale; return { tx: px - f * (px - v.tx), ty: py - f * (py - v.ty), scale: ns }; });
        }
        lastTap = now;
      } else if (e.touches.length === 2) {
        const i = two(e.touches); pinchDist = i.dist; pinchMidX = i.mx; pinchMidY = i.my;
      }
    }

    function onTM(e: TouchEvent) {
      if (e.touches.length === 1) {
        const dx = e.touches[0].clientX - tdx, dy = e.touches[0].clientY - tdy;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) { tdMoved = true; wasDragRef.current = true; }
        if (tdMoved) { e.preventDefault(); setMapView(v => ({ ...v, tx: tdtx + dx, ty: tdty + dy })); }
      } else if (e.touches.length === 2) {
        e.preventDefault();
        const i = two(e.touches), r = el.getBoundingClientRect();
        const sf = pinchDist > 0 ? i.dist / pinchDist : 1;
        const px = i.mx - r.left, py = i.my - r.top;
        setMapView(v => { const ns = clampScale(v.scale * sf), f = ns / v.scale; return { tx: px - f * (px - v.tx) + (i.mx - pinchMidX), ty: py - f * (py - v.ty) + (i.my - pinchMidY), scale: ns }; });
        pinchDist = i.dist; pinchMidX = i.mx; pinchMidY = i.my;
      }
    }

    function onMD(e: MouseEvent) {
      if (e.button !== 0) return;
      mouseDown = true; msx = e.clientX; msy = e.clientY;
      mstx = mapViewRef.current.tx; msty = mapViewRef.current.ty;
    }
    function onMM(e: MouseEvent) {
      if (!mouseDown) return;
      const dx = e.clientX - msx, dy = e.clientY - msy;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) wasDragRef.current = true;
      if (wasDragRef.current) setMapView(v => ({ ...v, tx: mstx + dx, ty: msty + dy }));
    }
    function onMU() { mouseDown = false; }

    function onW(e: WheelEvent) {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const f0 = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      setMapView(v => { const ns = clampScale(v.scale * f0), f = ns / v.scale; return { tx: px - f * (px - v.tx), ty: py - f * (py - v.ty), scale: ns }; });
    }

    el.addEventListener("touchstart", onTS, { passive: true });
    el.addEventListener("touchmove", onTM, { passive: false });
    el.addEventListener("wheel", onW, { passive: false });
    el.addEventListener("mousedown", onMD);
    window.addEventListener("mousemove", onMM);
    window.addEventListener("mouseup", onMU);
    return () => {
      el.removeEventListener("touchstart", onTS);
      el.removeEventListener("touchmove", onTM);
      el.removeEventListener("wheel", onW);
      el.removeEventListener("mousedown", onMD);
      window.removeEventListener("mousemove", onMM);
      window.removeEventListener("mouseup", onMU);
    };
  }, []);

  // Filtrera projekt baserat på statusfilter
  const filteredProjects = useMemo(() => {
    const allowed = getFilterStatuses(filterMode);
    return projects.filter(
      (p) =>
        typeof p.centerLat === "number" &&
        typeof p.centerLng === "number" &&
        (allowed === null || allowed.includes(p.status)),
    );
  }, [projects, filterMode]);

  // Beräkna markörspositioner i WebMercator-koordinater → procent av kartarea
  const markerPositions = useMemo(
    () =>
      filteredProjects.map((p) => ({
        project: p,
        left: ((lon2tileX(p.centerLng!, NATIONAL_ZOOM) - NATIONAL_X1) / (NATIONAL_X2 - NATIONAL_X1 + 1)) * 100,
        top: ((lat2tileY(p.centerLat!, NATIONAL_ZOOM) - NATIONAL_Y1) / (NATIONAL_Y2 - NATIONAL_Y1 + 1)) * 100,
      })),
    [filteredProjects],
  );

  // Visa projektnamn som etiketter när zoomnivån är tillräckligt hög
  const showLabels = mapView.scale >= 2;

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[#090909] text-white">
      {/* Sidhuvud */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 pt-[max(env(safe-area-inset-top),12px)]">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#FFB347]">
            Vindkraft i Sverige
          </p>
          <h1 className="text-sm font-bold text-white">
            {loadState === "loading"
              ? "Laddar projekt…"
              : loadState === "error"
                ? "Laddningsfel"
                : `${filteredProjects.length} av ${projects.length} projekt`}
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
        {(["aktuella", "planerade", "pågående", "befintliga", "alla"] as FilterMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setFilterMode(mode)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filterMode === mode
                ? "bg-[#FF8B01] text-[#090909]"
                : "bg-white/10 text-white hover:bg-white/20"
            }`}
          >
            {FILTER_LABELS[mode]}
          </button>
        ))}
      </div>

      {/* Interaktiv karta — ESRI-satellit med pan/zoom/pinch/dubbeltryck */}
      <div
        ref={mapContainerRef}
        className="relative min-h-0 flex-1 select-none overflow-hidden bg-[#0d0d0d]"
        style={{ cursor: "grab" }}
        onClick={() => {
          if (wasDragRef.current) { wasDragRef.current = false; return; }
          setSelectedProject(null);
        }}
      >
        {/* Transformerat lager: tiles + markörer rör sig tillsammans vid pan/zoom */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: `translate(${mapView.tx}px, ${mapView.ty}px) scale(${mapView.scale})`,
            transformOrigin: "0 0",
            willChange: "transform",
          }}
        >
          {/* Satellit-tiles */}
          {tiles.map((tile) => (
            <img
              key={tile.key}
              src={tile.url}
              alt=""
              draggable={false}
              className="pointer-events-none absolute select-none"
              style={{
                left: `${tile.left}%`,
                top: `${tile.top}%`,
                width: `${tile.width}%`,
                height: `${tile.height}%`,
              }}
            />
          ))}

          {/* Projektmarkörer */}
          {loadState === "ok" &&
            markerPositions.map(({ project, left, top }) => {
              const isSelected = project.id === selectedProject?.id;
              const color = projectStatusColor(project.status);
              return (
                <div
                  key={project.id}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${left}%`, top: `${top}%`, zIndex: isSelected ? 20 : 10 }}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (wasDragRef.current) { wasDragRef.current = false; return; }
                      setSelectedProject(isSelected ? null : project);
                    }}
                    aria-label={project.name}
                    className="flex flex-col items-center"
                  >
                    <div
                      className={`rounded-full border-2 border-[#090909] shadow-md transition-transform ${
                        isSelected ? "scale-[2.5]" : "hover:scale-150 active:scale-125"
                      }`}
                      style={{ width: 10, height: 10, backgroundColor: color }}
                    />
                    {showLabels && (
                      <span
                        className="whitespace-nowrap rounded px-1 font-semibold leading-tight shadow"
                        style={{
                          backgroundColor: "#090909cc",
                          color,
                          fontSize: `${Math.max(7, 11 / mapView.scale)}px`,
                          marginTop: `${Math.max(1, 3 / mapView.scale)}px`,
                        }}
                      >
                        {project.name}
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
        </div>

        {/* Laddningsöverlay */}
        {loadState === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#090909]/70">
            <p className="text-sm text-white/60">Laddar projekt…</p>
          </div>
        )}

        {/* Felöverlay */}
        {loadState === "error" && (
          <div className="absolute inset-x-4 top-4 rounded-xl bg-red-900/90 px-4 py-3 text-xs text-white shadow-xl">
            <p className="font-bold">Kunde inte ladda projekt</p>
            <p className="mt-0.5 text-white/70">{loadError}</p>
          </div>
        )}

        {/* Zoom-knappar (övre höger) */}
        <div className="absolute right-3 top-3 flex flex-col gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              const el = mapContainerRef.current;
              const cx = (el?.clientWidth ?? 300) / 2, cy = (el?.clientHeight ?? 400) / 2;
              setMapView(v => { const ns = clampScale(v.scale * 1.5), f = ns / v.scale; return { tx: cx - f * (cx - v.tx), ty: cy - f * (cy - v.ty), scale: ns }; });
            }}
            className="h-8 w-8 rounded-full bg-black/60 text-sm font-bold text-white shadow-lg backdrop-blur hover:bg-black/80"
            aria-label="Zooma in"
          >
            +
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              const el = mapContainerRef.current;
              const cx = (el?.clientWidth ?? 300) / 2, cy = (el?.clientHeight ?? 400) / 2;
              setMapView(v => { const ns = clampScale(v.scale / 1.5), f = ns / v.scale; return { tx: cx - f * (cx - v.tx), ty: cy - f * (cy - v.ty), scale: ns }; });
            }}
            className="h-8 w-8 rounded-full bg-black/60 text-sm font-bold text-white shadow-lg backdrop-blur hover:bg-black/80"
            aria-label="Zooma ut"
          >
            −
          </button>
        </div>

        {/* Nedre toning mot projektkort */}
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-[#090909] to-transparent" />
      </div>

      {/* Projektkort (valt projekt) / hjälptext */}
      <div className="bg-[#090909] px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-4">
        {selectedProject ? (
          <div className="rounded-2xl border border-white/10 bg-[#131313] p-4">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#FFB347]">
                  {selectedProject.kommun ?? ""}
                </p>
                <h2 className="mt-0.5 text-base font-bold leading-tight text-white">
                  {selectedProject.name}
                </h2>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-white/60">
                  {selectedProject.turbineCountPlannedMin != null && (
                    <span>
                      {selectedProject.turbineCountPlannedMin}
                      {selectedProject.turbineCountPlannedMax &&
                        selectedProject.turbineCountPlannedMax !==
                          selectedProject.turbineCountPlannedMin &&
                        `–${selectedProject.turbineCountPlannedMax}`}{" "}
                      {selectedProject.status === "operational" ? "befintliga verk" : "planerade verk"}
                    </span>
                  )}
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: projectStatusColor(selectedProject.status) + "25",
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
                aria-label="Stäng"
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
            {loadState === "loading" ? (
              <p className="text-sm text-white/50">Laddar svenska vindkraftsprojekt…</p>
            ) : loadState === "error" ? (
              <p className="text-sm text-white/50">Kontrollera nätverket och ladda om</p>
            ) : (
              <>
                <p className="text-sm text-white/50">Tryck på ett projekt på kartan</p>
                <p className="mt-1 text-[10px] text-white/30">
                  Visar {filteredProjects.length} av {projects.length} projekt
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface EditHandoff {
  projectId?: string;
  projectName: string;
  municipality?: string;
  turbines: { id: string; lat: number; lon: number }[];
  centerLat?: number | null;
  centerLng?: number | null;
  /** GeoJSON-polygonens ytterring, om känd, som LatLon[]. */
  boundary?: { lat: number; lon: number }[] | null;
  savedAt: number;
}

/** Typ som används som React-state — speglar EditHandoff men med PlacedTurbine[]. */
type ActiveEditHandoff = {
  projectId?: string;
  projectName: string;
  municipality?: string;
  turbines: PlacedTurbine[];
  centerLat?: number | null;
  centerLng?: number | null;
  boundary?: LatLon[] | null;
};

function consumeEditHandoff(): ActiveEditHandoff | null {
  try {
    const raw = localStorage.getItem(EDIT_HANDOFF_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as EditHandoff;
    if (Date.now() - data.savedAt > 10 * 60 * 1000) {
      localStorage.removeItem(EDIT_HANDOFF_KEY);
      return null;
    }
    localStorage.removeItem(EDIT_HANDOFF_KEY);
    return {
      projectId: data.projectId,
      projectName: data.projectName,
      municipality: data.municipality,
      turbines: data.turbines.map((t) => ({ id: t.id, lat: t.lat, lon: t.lon })),
      centerLat: data.centerLat ?? null,
      centerLng: data.centerLng ?? null,
      boundary: data.boundary ?? null,
    };
  } catch {
    return null;
  }
}

// De 8 verkliga planerade vindkraftverk (från src/lib/turbines.ts, SWEREF99 TM
// konverterat till WGS84) som ligger NÄRMAST Katrineholms centrum. Kartverktyget
// utgår alltså från den verkliga planen — användaren experimenterar därifrån,
// inte från en godtycklig startposition. Se replit.md / turbines.ts för källan.
const DEFAULT_TURBINES: PlacedTurbine[] = [
  { id: "t25", lat: 58.99268, lon: 16.26596 }, // V5-2, ~3.4 km från Katrineholm
  { id: "t24", lat: 58.99401, lon: 16.28032 }, // V5-1, ~4.2 km
  { id: "t29", lat: 58.97705, lon: 16.28416 }, // V5-6, ~4.9 km
  { id: "t26", lat: 58.99142, lon: 16.29339 }, // V5-3, ~5.0 km
  { id: "t27", lat: 58.98694, lon: 16.30302 }, // V5-4, ~5.6 km
  { id: "t28", lat: 58.97971, lon: 16.30244 }, // V5-5, ~5.8 km
  { id: "t14", lat: 58.93001, lon: 16.23653 }, // V3-1, ~7.5 km
  { id: "t15", lat: 58.92455, lon: 16.21137 }, // V3-2, ~7.9 km
];

interface SavedPlacement {
  id: string;
  name: string;
  timestamp: number;
  turbines: PlacedTurbine[];
  totalScore: number;
}

function loadSaved(): SavedPlacement[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    return raw ? (JSON.parse(raw) as SavedPlacement[]) : [];
  } catch {
    return [];
  }
}

let nextTurbineSeq = 1;

/**
 * Hur länge "Beräknar påverkan…" visas innan hushåll/buller/skuggor/poäng
 * och kartans färger uppdateras (0,5–1s enligt spec). Den tunga
 * `scorePlacement()`-omräkningen (hushåll, avstånd, spacing — O(n²)-ish för
 * många verk) körs alltså inte synkront på varje flytt/tillägg/borttagning
 * längre; den skjuts till efter denna fördröjning, vilket också var en del
 * av krascharna vid många objekt (se PlacementMap.tsx för motsvarande fix
 * av per-render `scorePlacement([t])`-anrop).
 */
const RECOMPUTE_DELAY_MS = 700;

export default function PlaceTurbines() {
  const [, navigate] = useLocation();
  const [editHandoff, setEditHandoff] = useState<ActiveEditHandoff | null>(consumeEditHandoff);
  // Välkomstläge: sant när användaren navigerade hit "fresh" från hemvyn via
  // openSverigekartan() på native — inte via AR-handoff. Flaggan konsumeras
  // engångs ur sessionStorage. Om välkomstläge: tom karta som startläge.
  const [showWelcome, setShowWelcome] = useState<boolean>(() => {
    const fresh = consumeFreshPlaceraFlag();
    return fresh && !editHandoff;
  });
  const initialTurbines = editHandoff?.turbines ?? (showWelcome ? [] : DEFAULT_TURBINES);
  const [turbines, setTurbines] = useState<PlacedTurbine[]>(initialTurbines);
  const [committedTurbines, setCommittedTurbines] = useState<PlacedTurbine[]>(initialTurbines);
  const { isAuthenticated, login } = useAuth();
  const [showLoginGate, setShowLoginGate] = useState(false);
  const [savingToCloud, setSavingToCloud] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [saved, setSaved] = useState<SavedPlacement[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [showEstateBoundary, setShowEstateBoundary] = useState(false);
  const [boundaryDebugMode, setBoundaryDebugMode] = useState(false);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [scoreMinimized, setScoreMinimized] = useState(false);
  const [boundaryEditMode, setBoundaryEditMode] = useState(false);
  const [editableBoundary, setEditableBoundary] = useState<LatLon[]>(() => getActiveBoundary());
  const [boundaryVersion, setBoundaryVersion] = useState(0);

  // Initialisera/uppdatera editableBoundary från projektets polygon när
  // editHandoff sätts — antingen vid mount (från localStorage) eller direkt
  // från NationalViews "Öppna projektet". Kör inte om editHandoff saknar polygon.
  useEffect(() => {
    if (editHandoff?.boundary && editHandoff.boundary.length >= 3) {
      setEditableBoundary(editHandoff.boundary);
      setBoundaryVersion((v) => v + 1);
    }
  }, [editHandoff]);
  const [boundarySavedFlash, setBoundarySavedFlash] = useState(false);
  const [currentLatSpan, setCurrentLatSpan] = useState<number>(0.25);
  const [locationContext, setLocationContext] = useState<LocationContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);

  const turbinesRef = useRef(turbines);
  turbinesRef.current = turbines;
  const commitTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setSaved(loadSaved());
  }, []);

  // Hämta nationell platskontext (orter + naturskydd) när vi är i
  // national/editHandoff-läge. Debounced 1 s efter att turbiner ändras.
  useEffect(() => {
    if (!editHandoff) return;
    if (committedTurbines.length === 0) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const lats = committedTurbines.map((t) => t.lat);
      const lons = committedTurbines.map((t) => t.lon);
      const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
      const centerLng = (Math.min(...lons) + Math.max(...lons)) / 2;

      setContextLoading(true);
      try {
        const resp = await fetch(
          apiUrl(`/api/location-context?lat=${centerLat.toFixed(5)}&lng=${centerLng.toFixed(5)}&radiusKm=50`),
          { signal: controller.signal },
        );
        if (resp.ok) {
          const data = (await resp.json()) as LocationContext;
          setLocationContext(data);
        }
      } catch {
        // AbortError eller nätverksfel — tyst
      } finally {
        setContextLoading(false);
      }
    }, 1000);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [editHandoff, committedTurbines]);

  useEffect(() => () => {
    if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
  }, []);

  const scheduleRecompute = useCallback(() => {
    setCalculating(true);
    if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = window.setTimeout(() => {
      setCommittedTurbines(turbinesRef.current);
      setCalculating(false);
    }, RECOMPUTE_DELAY_MS);
  }, []);

  // De tunga/synliga effekterna (hushållsantal, buller/skuggor, totalpoäng,
  // kartfärger) drivs av `committedTurbines`, som bara hoppar fram efter
  // `scheduleRecompute`s fördröjning — detta ger den efterfrågade "Beräknar
  // påverkan…"-känslan istället för att allt smäller om direkt vid varje
  // flytt. Verkens faktiska position på kartan (`turbines`) uppdateras dock
  // omedelbart så flytt-animationen känns direkt och responsiv.
  // `boundaryVersion` bärs bara med som ett extra beroende: `scorePlacement()`
  // läser den aktiva gränsen via `getActiveBoundary()` (modulnivå-state, inte
  // ett argument), så en sparad/återställd gräns måste explicit trigga om den
  // annars memoiserade omräkningen.
  // `ctx`-parametern styr bl.a. om "Utanför Ericsbergs marker"-kontrollen
  // körs. I editHandoff-läge (nationellt/Sverigeläge) är gränsen inte
  // relevant — vi skickar alltid en (tom) sentinel så att kontrollen
  // hoppas över oavsett om `locationContext` ännu laddats klart.
  const result = useMemo(
    () => scorePlacement(
      committedTurbines,
      editHandoff ? (locationContext ?? { settlements: [], protectedAreas: [] }) : undefined,
    ),
    [committedTurbines, boundaryVersion, editHandoff, locationContext],
  );

  const handleMove = useCallback(
    (id: string, lat: number, lon: number) => {
      setTurbines((prev) => prev.map((t) => (t.id === id ? { ...t, lat, lon } : t)));
      scheduleRecompute();
    },
    [scheduleRecompute],
  );

  const handleAdd = useCallback(
    (lat: number, lon: number) => {
      setTurbines((prev) => [...prev, { id: `custom-${Date.now()}-${nextTurbineSeq++}`, lat, lon }]);
      scheduleRecompute();
    },
    [scheduleRecompute],
  );

  const handleRemove = useCallback(
    (id: string) => {
      setTurbines((prev) => prev.filter((t) => t.id !== id));
      scheduleRecompute();
    },
    [scheduleRecompute],
  );

  function handleReset() {
    setTurbines(DEFAULT_TURBINES);
    setCommittedTurbines(DEFAULT_TURBINES);
    setCalculating(false);
    if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
  }

  async function handleSave() {
    const name = editHandoff?.projectName ?? `Placering ${saved.length + 1}`;
    const entry: SavedPlacement = {
      id: `placement-${Date.now()}`,
      name,
      timestamp: Date.now(),
      turbines,
      totalScore: result.totalScore,
    };

    // Spara alltid lokalt
    const next = [...saved, entry].slice(-8);
    localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    setSaved(next);

    if (isAuthenticated) {
      // Spara även i molnet
      setSavingToCloud(true);
      const lats = turbines.map((t) => t.lat);
      const lons = turbines.map((t) => t.lon);
      const centerLat = lats.length ? String(((Math.min(...lats) + Math.max(...lats)) / 2).toFixed(6)) : null;
      const centerLng = lons.length ? String(((Math.min(...lons) + Math.max(...lons)) / 2).toFixed(6)) : null;
      try {
        await fetch(apiUrl("/api/projects"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            name,
            turbines,
            turbineCount: String(turbines.length),
            totalScore: String(Math.round(result.totalScore)),
            centerLat,
            centerLng,
          }),
        });
      } catch {
        // tyst fel — lokal kopia är sparad
      } finally {
        setSavingToCloud(false);
      }
    } else {
      // Visa inloggningsgaten om ej inloggad
      setShowLoginGate(true);
    }

    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1800);
  }

  function handleLoad(entry: SavedPlacement) {
    setTurbines(entry.turbines);
    setCompareOpen(false);
  }

  function handleDelete(id: string) {
    const next = saved.filter((s) => s.id !== id);
    localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    setSaved(next);
  }

  function handleViewInAr() {
    localStorage.setItem(AR_HANDOFF_KEY, JSON.stringify({ turbines, savedAt: Date.now() }));
    navigate("/");
  }

  function handleToggleBoundaryEdit() {
    setBoundaryEditMode((v) => {
      const next = !v;
      if (next) setEditableBoundary(getActiveBoundary());
      return next;
    });
  }

  const handleVertexDrag = useCallback((index: number, lat: number, lon: number) => {
    setEditableBoundary((prev) => prev.map((p, i) => (i === index ? { lat, lon } : p)));
  }, []);

  const handleVertexRemove = useCallback((index: number) => {
    setEditableBoundary((prev) => (prev.length > 3 ? prev.filter((_, i) => i !== index) : prev));
  }, []);

  const handleVertexAdd = useCallback((lat: number, lon: number) => {
    setEditableBoundary((prev) => {
      if (prev.length < 3) return [...prev, { lat, lon }];
      // Sätt in den nya punkten på den kant (segment) den ligger närmast,
      // så polygonen inte blir självkorsande av ett godtyckligt tillägg.
      let bestIndex = prev.length;
      let bestDist = Infinity;
      for (let i = 0; i < prev.length; i++) {
        const a = prev[i];
        const b = prev[(i + 1) % prev.length];
        const dx = b.lon - a.lon;
        const dy = b.lat - a.lat;
        const lenSq = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((lon - a.lon) * dx + (lat - a.lat) * dy) / lenSq));
        const projLon = a.lon + t * dx;
        const projLat = a.lat + t * dy;
        const dist = Math.hypot(lon - projLon, lat - projLat);
        if (dist < bestDist) {
          bestDist = dist;
          bestIndex = i + 1;
        }
      }
      const next = [...prev];
      next.splice(bestIndex, 0, { lat, lon });
      return next;
    });
  }, []);

  function handleSaveBoundary() {
    setCustomBoundary(editableBoundary);
    setBoundaryVersion((v) => v + 1);
    setBoundarySavedFlash(true);
    window.setTimeout(() => setBoundarySavedFlash(false), 1800);
  }

  function handleResetBoundary() {
    resetCustomBoundary();
    setEditableBoundary(getActiveBoundary());
    setBoundaryVersion((v) => v + 1);
  }

  function handleExportBoundaryGeoJson() {
    const geoJson = boundaryToGeoJson(boundaryEditMode ? editableBoundary : getActiveBoundary());
    const blob = new Blob([JSON.stringify(geoJson, null, 2)], { type: "application/geo+json" });
    const url = URL.createObjectURL(blob);
    // <a download> nollställs tyst i iOS Safari/installerad PWA-standalone-läge
    // (se .agents/memory/pdf-download-attribute-ios-pwa.md) — öppna i en ny
    // flik istället så OS:ets dela/spara-blad tar över på alla plattformar.
    window.open(url, "_blank");
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  // Nationell landningssida: visas när användaren öppnar Sverigekartan
  // "fresh" från hemvyn (sessionStorage-flagga). PlacementMap monteras INTE
  // — den monteras alltid färsk vid övergången till editorn, vilket garanterar
  // att den börjar på rätt Ericsberg-zoomnivå och att inga tiles laddas i
  // onödan bakom overlayen.
  if (showWelcome) {
    return (
      <NationalView
        onEnterEditor={(project) => {
          // Bygg upp editHandoff från det valda API-projektet.
          // boundary sätts från polygon om tillgänglig (summary-läge ger null →
          // editableBoundary-effekten ovan används inte; editor startar utan gräns).
          const boundary = apiPolygonToLatLon(project.polygon ?? null);
          setEditHandoff({
            projectId: String(project.id),
            projectName: project.name,
            municipality: project.kommun ?? undefined,
            turbines: [],
            centerLat: project.centerLat ?? null,
            centerLng: project.centerLng ?? null,
            boundary,
          });
          setTurbines([]);
          setCommittedTurbines([]);
          setShowWelcome(false);
        }}
        onBack={() => navigate("/")}
      />
    );
  }

  // Tomt redigeringsläge — projekt utan detaljerat redigeringsunderlag i appen
  if (editHandoff && !editHandoff.boundary) {
    return (
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[#090909] text-white">
        <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3 pt-[max(env(safe-area-inset-top),12px)]">
          <div>
            <p className="text-xs font-semibold tracking-wide text-[#FFB347]">REDIGERA PLACERING</p>
            <p className="text-sm text-white/70">{editHandoff.projectName}</p>
          </div>
          <button
            onClick={() => setShowWelcome(true)}
            className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20"
          >
            ← Karta
          </button>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-8 text-center">
          <div className="text-5xl">🗺️</div>
          <div>
            <p className="text-lg font-semibold text-white">Inget redigeringsunderlag</p>
            <p className="mt-2 text-sm leading-relaxed text-white/60">
              {editHandoff.projectName} har ännu inget detaljerat redigeringsunderlag tillgängligt i appen.
            </p>
          </div>
          {/* Diagnostik — synlig för att underlätta felsökning */}
          <div className="w-full rounded-xl bg-white/5 px-4 py-3 text-left text-xs text-white/40">
            <p>Projekt-ID: {editHandoff.projectId ?? "–"}</p>
            <p>Projekt: {editHandoff.projectName}</p>
            {editHandoff.municipality && <p>Kommun: {editHandoff.municipality}</p>}
            <p>Gränspunkter: 0</p>
            <p>Verk (laddade): {editHandoff.turbines.length}</p>
            <p>
              Koordinater:{" "}
              {editHandoff.centerLat != null
                ? `${editHandoff.centerLat.toFixed(4)}, ${editHandoff.centerLng?.toFixed(4)}`
                : "–"}
            </p>
          </div>
          <div className="flex w-full flex-col gap-2">
            <button
              onClick={() => setShowWelcome(true)}
              className="w-full rounded-full bg-[#FF8B01] py-3 text-sm font-bold text-[#090909] shadow-lg shadow-[#FF8B01]/20"
            >
              ← Tillbaka till Sverigekartan
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-[#090909] text-white">

      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-[#FFB347]">
            {editHandoff ? "REDIGERA PLACERING" : "PLACERA VINDKRAFTVERKEN SJÄLV"}
          </p>
          <p className="text-sm text-white/70">
            {editHandoff
              ? `${editHandoff.projectName}${editHandoff.municipality ? ` · ${editHandoff.municipality}` : ""} · klicka på ett verk för att flytta/ta bort`
              : "Klicka på kartan för att placera vindkraftverken · tryck på ett verk för att flytta/ta bort"}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => navigate("/mina-projekt")}
            className="rounded-full bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20"
          >
            {isAuthenticated ? "☁️ Mina projekt" : "📁 Lokala projekt"}
          </button>
          <button
            onClick={openSverigekartan}
            className="rounded-full bg-white/10 px-4 py-1.5 text-sm text-white hover:bg-white/20"
          >
            🗺️ Kartan
          </button>
          <button
            onClick={() => navigate("/")}
            className="rounded-full bg-white/10 px-4 py-1.5 text-sm text-white hover:bg-white/20"
          >
            📷 AR
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-white/10 bg-[#0d0d0d] px-4 py-2">
        {!editHandoff && (
          <>
            <button
              onClick={() => setBoundaryDebugMode((v) => !v)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                boundaryDebugMode ? "bg-sky-400 text-[#090909]" : "border border-white/20 bg-white/5 text-white hover:bg-white/10"
              }`}
            >
              🔢 Visa gränspunkter
            </button>
            <button
              onClick={handleToggleBoundaryEdit}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                boundaryEditMode ? "bg-purple-400 text-[#090909]" : "border border-white/20 bg-white/5 text-white hover:bg-white/10"
              }`}
            >
              ✏️ Redigera gräns
            </button>
          </>
        )}
        <button
          onClick={() => setDebugPanelOpen((v) => !v)}
          className={`rounded-full px-3 py-1.5 text-xs font-medium ${
            debugPanelOpen ? "bg-emerald-400 text-[#090909]" : "border border-white/20 bg-white/5 text-white hover:bg-white/10"
          }`}
        >
          🐞 Felsökning (poäng)
        </button>
        <p className="text-[11px] text-white/40">{turbines.length} verk placerade</p>
      </div>

      {boundaryEditMode && (
        <div className="flex flex-wrap items-center gap-2 border-b border-purple-400/30 bg-purple-950/30 px-4 py-2">
          <p className="text-[11px] text-purple-200">
            Dra en punkt för att flytta den · klicka ✕ för att ta bort · klicka på kartan för att lägga till en ny punkt
            {hasCustomBoundary() ? " · anpassad gräns aktiv" : ""}
          </p>
          <div className="ml-auto flex gap-2">
            <button
              onClick={handleResetBoundary}
              className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[11px] font-medium text-white hover:bg-white/10"
            >
              🔄 Återställ gräns
            </button>
            <button
              onClick={handleExportBoundaryGeoJson}
              className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[11px] font-medium text-white hover:bg-white/10"
            >
              📤 Exportera GeoJSON
            </button>
            <button
              onClick={handleSaveBoundary}
              className="rounded-full bg-purple-400 px-3 py-1 text-[11px] font-semibold text-[#090909] hover:bg-purple-300"
            >
              {boundarySavedFlash ? "✅ Sparad!" : "💾 Spara gräns"}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="relative flex-1 min-h-[35dvh] p-3">
        <PlacementMap
          turbines={turbines}
          colorTurbines={committedTurbines}
          initialView={
            editHandoff ? (() => {
              if (editHandoff.turbines.length === 0) {
                const lat = editHandoff.centerLat ?? 62.5;
                const lon = editHandoff.centerLng ?? 15.5;
                return { centerLat: lat, centerLon: lon, latSpan: 0.3 };
              }
              const lats = editHandoff.turbines.map((t) => t.lat);
              const lons = editHandoff.turbines.map((t) => t.lon);
              const minLat = Math.min(...lats);
              const maxLat = Math.max(...lats);
              const pad = Math.max((maxLat - minLat) * 0.25, 0.06);
              return {
                centerLat: (minLat + maxLat) / 2,
                centerLon: (Math.min(...lons) + Math.max(...lons)) / 2,
                latSpan: Math.min(maxLat - minLat + pad * 2, 2.0),
              };
            })()
            : undefined
          }
          onMove={handleMove}
          onAdd={handleAdd}
          onRemove={handleRemove}
          outsideBoundaryIds={result.outsideBoundaryIds}
          showEstateBoundary={showEstateBoundary}
          onLatSpanChange={setCurrentLatSpan}
          boundaryDebugMode={boundaryDebugMode}
          boundaryEditMode={boundaryEditMode}
          editableBoundary={editableBoundary}
          onVertexDrag={handleVertexDrag}
          onVertexRemove={handleVertexRemove}
          onVertexAdd={handleVertexAdd}
          onToggleEstateBoundary={() => setShowEstateBoundary((v) => !v)}
        />

        {debugPanelOpen && (
          <div className="pointer-events-auto absolute right-3 top-3 max-h-[80%] w-80 overflow-y-auto rounded-xl border border-emerald-400/30 bg-black/85 p-3 text-xs text-white shadow-xl">
            <p className="mb-2 font-semibold text-emerald-300">🐞 Felsökning — poängbidrag</p>
            <p className="mb-1 text-white/70">
              Total poäng: <span className="font-semibold text-white">{Math.round(result.totalScore)}</span>/100
            </p>
            <p className="mb-1 text-white/70">
              Närmaste hushåll:{" "}
              <span className="font-semibold text-white">
                {result.nearestHouseholdName ?? "—"}
                {result.nearestHouseholdDistanceM !== null ? ` (${Math.round(result.nearestHouseholdDistanceM)} m)` : ""}
              </span>
            </p>
            <p className="mb-2 text-white/70">
              Avstånd till tätort:{" "}
              <span className="font-semibold text-white">
                {result.nearestUrbanDistanceM !== null ? `${Math.round(result.nearestUrbanDistanceM)} m` : "—"}
              </span>
            </p>

            <p className="mb-1 font-medium text-white/80">Laddade datalager:</p>
            <ul className="mb-2 grid grid-cols-2 gap-x-2 gap-y-0.5 text-white/70">
              <li>
                Hushållskluster: <span className="text-white/90">{result.layerCounts.householdClusters}</span>
              </li>
              <li>
                Naturzoner: <span className="text-white/90">{result.layerCounts.natureZones}</span>
              </li>
              <li>
                Kulturzoner: <span className="text-white/90">{result.layerCounts.culturalZones}</span>
              </li>
              <li>
                Vattenzoner: <span className="text-white/90">{result.layerCounts.waterZones}</span>
              </li>
            </ul>

            <p className="mb-2 text-[10px] text-white/40">Baserat på senast beräknade placering (committedTurbines).</p>

            <p className="mb-1 font-medium text-white/80">Faktorer (bidrag till total poäng):</p>
            <ul className="mb-2 space-y-0.5">
              {result.factors.map((f) => (
                <li key={f.key} className="flex items-center justify-between">
                  <span className="text-white/70">{f.label}</span>
                  <span className={f.impactPoints < 0 ? "text-emerald-300" : "text-white/90"}>
                    {f.impactPoints > 0 ? "+" : ""}
                    {f.impactPoints.toFixed(1)}
                  </span>
                </li>
              ))}
            </ul>

            <p className="mb-1 font-medium text-white/80">Per verk — full felsökningsdata:</p>
            <ul className="space-y-2">
              {result.turbineDebug
                .slice()
                .sort((a, b) => b.totalScore - a.totalScore)
                .map((td) => (
                  <li key={td.id} className="rounded-md border border-white/10 bg-white/5 p-1.5">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-semibold text-white/90">{td.id}</span>
                      <span className="text-white/90">{Math.round(td.totalScore)} p</span>
                    </div>
                    {!td.insideBoundary && (
                      <p className="mb-1 text-[10px] font-medium text-red-300">⚠ Utanför markerat markområde</p>
                    )}
                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-white/60">
                      <span>
                        Hushåll: {td.nearestHouseholdName ?? "—"}
                        {td.nearestHouseholdDistanceM !== null ? ` (${Math.round(td.nearestHouseholdDistanceM)} m)` : ""}
                      </span>
                      
                      <span>Hushåll &lt;1 km: {td.householdsWithin1kmCount}</span>
                      <span>Hushåll &lt;2 km: {td.householdsWithin2kmCount}</span>
                      <span>Hushåll &lt;3 km: {td.householdsWithin3kmCount}</span>
                      <span>Buller: {td.noiseDba !== null ? `${td.noiseDba.toFixed(1)} dBA` : "—"}</span>
                      <span>
                        Natur: {td.nearestNatureName ?? "—"}
                        {td.nearestNatureDistanceM !== null ? ` (${Math.round(td.nearestNatureDistanceM)} m)` : ""}
                      </span>
                      <span>
                        Kultur: {td.nearestCulturalName ?? "—"}
                        {td.nearestCulturalDistanceM !== null ? ` (${Math.round(td.nearestCulturalDistanceM)} m)` : ""}
                      </span>
                      <span>
                        Vatten: {td.nearestWaterName ?? "—"}
                        {td.nearestWaterDistanceM !== null ? ` (${Math.round(td.nearestWaterDistanceM)} m)` : ""}
                      </span>
                      <span>Skuggflimmer: {td.shadowFlickerScore.toFixed(1)}</span>
                      <span>Visuellt: {td.visualScore.toFixed(1)}</span>
                    </div>
                  </li>
                ))}
            </ul>
          </div>
        )}

        {calculating && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
            <div className="flex items-center gap-2 rounded-full bg-black/80 px-4 py-2 text-xs font-medium text-white shadow-lg">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Beräknar påverkan…
            </div>
          </div>
        )}

        {currentLatSpan > 1.2 && (
          <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 bg-black/85 px-4 py-3 shadow-xl backdrop-blur-sm">
            <p className="text-sm font-medium text-white/90">
              🗺️ Vill du gå tillbaka till Sverigekartan?
            </p>
            <button
              onClick={openSverigekartan}
              className="shrink-0 rounded-full bg-[#FF8B01] px-4 py-1.5 text-xs font-semibold text-[#090909] hover:bg-[#FFB347]"
            >
              Ja, gå tillbaka
            </button>
          </div>
        )}
      </div>

      {result.playfulWarning && !editHandoff && (
        <div className="mx-3 mb-2 rounded-xl border border-yellow-400/30 bg-yellow-500/15 px-3 py-2 text-xs text-yellow-100">
          ⚠️ {result.playfulWarning}
        </div>
      )}

      {editHandoff && contextLoading && (
        <div className="mx-3 mb-1 flex items-center gap-2 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-white/60">
          <span className="animate-spin">⏳</span> Hämtar lokaldata (orter, naturskydd)…
        </div>
      )}
      {editHandoff && !contextLoading && locationContext && (
        <div className="mx-3 mb-1 rounded-lg bg-emerald-900/30 px-3 py-1.5 text-xs text-emerald-300/80">
          📍 {locationContext.settlements.length} orter · {locationContext.protectedAreas.length} skyddade områden hittade
        </div>
      )}

      <PlacementScorePanel
        result={result}
        minimized={scoreMinimized}
        onToggleMinimized={() => setScoreMinimized((v) => !v)}
        showEricsbergFeatures={!editHandoff}
      />
      </div>

      <div className="border-t border-white/10 bg-[#0d0d0d] px-4 py-3">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={handleReset}
            className="rounded-full border border-white/20 bg-white/5 py-2.5 text-xs font-medium text-white hover:bg-white/10"
          >
            🔄 Återställ
          </button>
          <button
            onClick={handleSave}
            disabled={savingToCloud}
            className="rounded-full border border-white/20 bg-white/5 py-2.5 text-xs font-medium text-white hover:bg-white/10 disabled:opacity-50"
          >
            {savingToCloud ? "☁️ Sparar…" : savedFlash ? (isAuthenticated ? "✅ Sparad i molnet!" : "✅ Sparad lokalt!") : "💾 Spara placering"}
          </button>
          <button
            onClick={() => setCompareOpen((v) => !v)}
            className="rounded-full border border-white/20 bg-white/5 py-2.5 text-xs font-medium text-white hover:bg-white/10"
          >
            📊 Jämför ({saved.length})
          </button>
          <button
            onClick={handleViewInAr}
            className="rounded-full bg-[#FF8B01] py-2.5 text-xs font-semibold text-[#090909] hover:bg-[#FFB347]"
          >
            👁️ Se denna placering i AR
          </button>
        </div>

        {compareOpen && (
          <div className="mt-3 space-y-2">
            {saved.length === 0 && <p className="text-xs text-white/50">Inga sparade placeringar ännu.</p>}
            {saved
              .slice()
              .sort((a, b) => a.totalScore - b.totalScore)
              .map((s) => {
                const sColors = PLACEMENT_LEVEL_COLORS[scorePlacement(s.turbines).level];
                return (
                  <div
                    key={s.id}
                    className={`flex items-center justify-between rounded-xl border px-3 py-2 ${sColors.border} ${sColors.bg}`}
                  >
                    <div>
                      <p className="text-xs font-semibold text-white">{s.name}</p>
                      <p className={`text-[11px] ${sColors.text}`}>
                        {sColors.emoji} {Math.round(s.totalScore)}/100
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleLoad(s)}
                        className="rounded-full bg-white/10 px-3 py-1 text-[11px] text-white hover:bg-white/20"
                      >
                        Ladda
                      </button>
                      <button
                        onClick={() => handleDelete(s.id)}
                        className="rounded-full bg-white/10 px-3 py-1 text-[11px] text-white hover:bg-white/20"
                      >
                        Ta bort
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Login-gate modal */}
      {showLoginGate && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 pb-10 sm:items-center sm:pb-0">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#141414] px-6 py-7 text-white shadow-2xl">
            <button
              onClick={() => setShowLoginGate(false)}
              className="absolute right-4 top-4 text-white/40 hover:text-white"
              aria-label="Stäng"
            >
              ✕
            </button>
            <p className="mb-1 text-lg font-semibold">Logga in för att spara i molnet</p>
            <p className="mb-5 text-sm text-white/60">
              Placeringen är sparad lokalt på din enhet. Logga in för att synkronisera till molnet
              och nå den från alla enheter.
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => { setShowLoginGate(false); login(); }}
                className="w-full rounded-full bg-[#FF8B01] py-3 text-sm font-semibold text-[#090909]"
              >
                Logga in
              </button>
              <button
                onClick={() => setShowLoginGate(false)}
                className="w-full rounded-full border border-white/20 py-3 text-sm text-white/70 hover:bg-white/5"
              >
                Behåll lokalt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
