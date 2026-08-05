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
 *      - Misslyckas → behåller cache; om cachen också saknas → steg 3
 *   3. Dynamisk import av bundledProjects.ts (sista reserv, ~700 KB eget chunk)
 *      Laddas BARA om varken cache eller API fungerar.
 *
 * Bundelstrategi:
 *   bundledProjects.ts importeras ALDRIG statiskt från denna fil.
 *   Vite placerar den i ett separat async-chunk som aldrig laddas
 *   om användaren har nätverksåtkomst eller en lokal cache.
 *
 * `source` berättar varifrån datan kom senast:
 *   "cache"    = läst från localStorage
 *   "api"      = live från /api/project-areas
 *   "fallback" = inbyggd bundled-lista (sista reserv)
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
// VIKTIGT: endast type-import — ingen runtime-referens till bundledProjects.ts.
// Vite tree-shakar bort type-imports helt; filen hamnar inte i main-chunk.
import type { ApiProjectArea } from "@/lib/bundledProjects";
import { readProjectAreaCache, writeProjectAreaCache } from "@/lib/projectAreaCache";
import { apiUrl } from "@/lib/apiUrl";

export type ProjectAreasSource = "cache" | "api" | "fallback";

interface ProjectAreasContextValue {
  /** Hela projektregistret. Tomt array enbart under den allra första async-laddningen. */
  areas: ApiProjectArea[];
  /** Varifrån datan kom senast. */
  source: ProjectAreasSource;
  /** true medan bakgrundsuppdatering från API pågår. */
  refreshing: boolean;
  /** Katrineholm-projektet (id=32) om det finns i listan — med kampanjdata. */
  katrineholmProject: ApiProjectArea | null;
}

const ProjectAreasContext = createContext<ProjectAreasContextValue | null>(null);

const KATRINEHOLM_ID = 32;

function findKatrineholm(areas: ApiProjectArea[]): ApiProjectArea | null {
  return areas.find((p) => p.id === KATRINEHOLM_ID) ?? null;
}

/**
 * Lazy-laddar BUNDLED_PROJECTS som sista reserv.
 * Returnerar ett tomt array om importen misslyckas (bör aldrig inträffa).
 */
async function loadFallback(): Promise<ApiProjectArea[]> {
  try {
    const mod = await import("@/lib/bundledProjects");
    console.info(
      `[ProjectAreas] Inbyggd reserv laddad: ${mod.BUNDLED_PROJECTS.length} projekt`,
    );
    return mod.BUNDLED_PROJECTS;
  } catch (err) {
    console.error("[ProjectAreas] Kunde inte ladda inbyggd reserv:", err);
    return [];
  }
}

export function ProjectAreasProvider({ children }: { children: ReactNode }) {
  // Läs cache synkront vid första render (omedelbar data, ingen flimmer).
  const initialCache = readProjectAreaCache();

  const [areas, setAreas] = useState<ApiProjectArea[]>(
    initialCache?.areas ?? [],
  );
  const [source, setSource] = useState<ProjectAreasSource>(
    initialCache?.areas.length ? "cache" : "fallback",
  );
  const [refreshing, setRefreshing] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
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
          `[ProjectAreas] Live-data laddad: ${data.length} projekt`,
        );
      })
      .catch(async (err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.warn(
          "[ProjectAreas] API inte nåbar — försöker cache/reserv:",
          err,
        );
        // Om cachen redan har data, behåller vi den (state är redan satt ovan).
        // Om cachen är tom, lazy-ladda reserven som sista utväg.
        if (!initialCache?.areas.length) {
          const fallback = await loadFallback();
          if (fallback.length > 0) {
            setAreas(fallback);
            setSource("fallback");
          }
        }
      })
      .finally(() => {
        setRefreshing(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
