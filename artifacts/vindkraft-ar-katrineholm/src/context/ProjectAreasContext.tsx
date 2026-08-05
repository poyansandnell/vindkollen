/**
 * ProjectAreasContext
 *
 * Tillhandahåller hela projektregistret (ApiProjectArea[]) till alla
 * komponenter utan att de behöver importera bundledProjects direkt.
 *
 * Laddningsordning vid uppstart:
 *   1. localStorage-cache (omedelbar — ingen nätverksfördröjning)
 *   2. GET /api/project-areas (bakgrundsuppdatering)
 *      - Lyckas → uppdaterar state + skriver ny cache
 *      - Misslyckas → behåller cache/fallback; inga synliga fel för användaren
 *   3. Om varken cache eller API → BUNDLED_PROJECTS (inbyggd reserv)
 *
 * `source` berättar varifrån datan kom:
 *   "cache"    = läst från localStorage (kan vara upp till 24h gammal)
 *   "api"      = live från /api/project-areas
 *   "fallback" = inbyggd bundled-lista (inget nätverk, ingen cache)
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { BUNDLED_PROJECTS, type ApiProjectArea } from "@/lib/bundledProjects";
import { readProjectAreaCache, writeProjectAreaCache } from "@/lib/projectAreaCache";
import { apiUrl } from "@/lib/apiUrl";

export type ProjectAreasSource = "cache" | "api" | "fallback";

interface ProjectAreasContextValue {
  /** Hela projektregistret. Alltid ett icke-tomt array (cache/bundled som reserv). */
  areas: ApiProjectArea[];
  /** Varifrån datan kom senast. */
  source: ProjectAreasSource;
  /** true medan bakgrundsuppdatering pågår. */
  refreshing: boolean;
  /** Katrineholm-projektet (id=32) om det finns i listan — med kampanjdata. */
  katrineholmProject: ApiProjectArea | null;
}

const ProjectAreasContext = createContext<ProjectAreasContextValue | null>(null);

const KATRINEHOLM_ID = 32;

function findKatrineholm(areas: ApiProjectArea[]): ApiProjectArea | null {
  return areas.find((p) => p.id === KATRINEHOLM_ID) ?? null;
}

export function ProjectAreasProvider({ children }: { children: ReactNode }) {
  // Ladda cache synkront vid första render för omedelbar data.
  const initialCache = readProjectAreaCache();
  const initial: ApiProjectArea[] =
    initialCache?.areas.length ? initialCache.areas : BUNDLED_PROJECTS;
  const initialSource: ProjectAreasSource = initialCache?.areas.length
    ? "cache"
    : "fallback";

  const [areas, setAreas] = useState<ApiProjectArea[]>(initial);
  const [source, setSource] = useState<ProjectAreasSource>(initialSource);
  const [refreshing, setRefreshing] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    // Kör max en gång per mount.
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const url = apiUrl("/api/project-areas");
    setRefreshing(true);

    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ApiProjectArea[]>;
      })
      .then((data) => {
        if (!Array.isArray(data) || data.length === 0) return;
        setAreas(data);
        setSource("api");
        writeProjectAreaCache(data);
        console.info(
          `[ProjectAreas] Live-data laddad: ${data.length} projekt från ${url}`,
        );
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.warn(
          "[ProjectAreas] Kunde inte hämta live-data — använder cache/bundled:",
          err,
        );
      })
      .finally(() => {
        setRefreshing(false);
      });

    return () => controller.abort();
  }, []);

  const katrineholmProject = findKatrineholm(areas);

  return (
    <ProjectAreasContext.Provider
      value={{ areas, source, refreshing, katrineholmProject }}
    >
      {children}
    </ProjectAreasContext.Provider>
  );
}

/** Hook för att komma åt projektregistret. Kastar om den används utanför providern. */
export function useProjectAreas(): ProjectAreasContextValue {
  const ctx = useContext(ProjectAreasContext);
  if (!ctx) {
    throw new Error("useProjectAreas måste användas inuti <ProjectAreasProvider>");
  }
  return ctx;
}
