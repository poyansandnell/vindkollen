# V14: V12 REDO APPLICERAD + pin-storlek + footer-padding

V12-instruktionen applicerades INTE korrekt — `projectGridLayout.ts` finns inte, `translateTurbinesToCenter` finns kvar, och `handleEnterEditorDirect` har fortfarande V11-logik (tom karta för icke-bundlade projekt).

Denna V14-instruktion applicerar V12-koden igen PLUS fixar:
1. Pin-storlek så 3587 projekt syns tydligt
2. Nederkant-padding så footer inte kapas
3. "1 sek"-bugg (useEffect återställer selectedProject för aggressivt)

---

## ÄNDRING 1: NY FIL — `src/lib/projectGridLayout.ts`

**Kontrollera först** att filen inte finns: `ls src/lib/projectGridLayout.ts`. Om den finns, hoppa till ÄNDRING 2.

Skapa en NY fil med exakt detta innehåll:

```ts
/**
 * Genererar ett automatiskt rutnät av vindkraftverk inom ett projektområde.
 *
 * Används som default när redigeraren öppnas för ett projekt som saknar
 * fördefinierade turbinkoordinater (alla projekt utom Katrineholm/Ericsberg).
 */

import type { PlacedTurbine } from "./placementScoring";

export interface LatLon {
  lat: number;
  lon: number;
}

const METERS_PER_DEG_LAT = 111_320;
const TURBINE_SPACING_M = 500;

function pointInPolygon(lat: number, lon: number, polygon: LatLon[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lon, yi = polygon[i].lat;
    const xj = polygon[j].lon, yj = polygon[j].lat;
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}

export function generateProjectGrid(
  centerLat: number,
  centerLng: number,
  turbineCount: number,
  polygon?: LatLon[] | null,
  seed?: number,
): PlacedTurbine[] {
  if (turbineCount <= 0) return [];
  const rand = seededRandom(seed ?? Math.round(centerLat * 1e6));
  const cols = Math.max(1, Math.round(Math.sqrt(turbineCount * 1.2)));
  const rows = Math.max(1, Math.ceil(turbineCount / cols));
  const spacingLat = TURBINE_SPACING_M / METERS_PER_DEG_LAT;
  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  const spacingLng = TURBINE_SPACING_M / (METERS_PER_DEG_LAT * cosLat);
  const startLat = centerLat - ((rows - 1) / 2) * spacingLat;
  const startLng = centerLng - ((cols - 1) / 2) * spacingLng;
  const turbines: { lat: number; lon: number; dist: number }[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lat = startLat + r * spacingLat + (rand() - 0.5) * spacingLat * 0.3;
      const lng = startLng + c * spacingLng + (rand() - 0.5) * spacingLng * 0.3;
      if (polygon && polygon.length >= 3 && !pointInPolygon(lat, lng, polygon)) continue;
      const dLat = (lat - centerLat) * METERS_PER_DEG_LAT;
      const dLng = (lng - centerLng) * METERS_PER_DEG_LAT * cosLat;
      turbines.push({ lat, lon: lng, dist: Math.sqrt(dLat * dLat + dLng * dLng) });
    }
  }

  turbines.sort((a, b) => a.dist - b.dist);
  return turbines.slice(0, turbineCount).map((t, i) => ({
    id: `auto-${i + 1}`,
    lat: t.lat,
    lon: t.lon,
  }));
}

export function translateDefaultTurbines(
  centerLat: number,
  centerLng: number,
  count: number,
): PlacedTurbine[] {
  const template: { dLat: number; dLng: number }[] = [
    { dLat: 0.0044, dLng: 0.0038 },
    { dLat: 0.0057, dLng: 0.0181 },
    { dLat: -0.0112, dLng: 0.0220 },
    { dLat: 0.0031, dLng: 0.0312 },
    { dLat: -0.0014, dLng: 0.0408 },
    { dLat: -0.0086, dLng: 0.0402 },
    { dLat: -0.0583, dLng: -0.0257 },
    { dLat: -0.0637, dLng: -0.0508 },
  ];
  return template.slice(0, Math.min(count, template.length)).map((t, i) => ({
    id: `tpl-${i + 1}`,
    lat: centerLat + t.dLat,
    lon: centerLng + t.dLng,
  }));
}
```

---

## ÄNDRING 2: `src/pages/PlaceTurbines.tsx` — Importera nya funktioner

**Hitta** import-blocket högst upp i filen (runt rad 1–25).

**Lägg till** denna import (efter de andra `@/lib/...`-importerna):

```ts
import { generateProjectGrid, translateDefaultTurbines } from "@/lib/projectGridLayout";
```

---

## ÄNDRING 3: `src/pages/PlaceTurbines.tsx` — Ta bort `translateTurbinesToCenter`

**Hitta** funktionen `translateTurbinesToCenter` (runt rad 38–55). Hela funktionen inklusive JSDoc:

```ts
/**
 * Förflyttar en uppsättning turbiner så att deras geometriska mittpunkt hamnar
 * på (targetLat, targetLon).  Används som fallback på iOS native när API-anrop
 * inte är möjliga (VITE_API_BASE_URL saknas) — ger användaren ett visuellt
 * utgångspunkt att justera istället för en helt tom karta.
 */
function translateTurbinesToCenter(
  turbines: PlacedTurbine[],
  targetLat: number,
  targetLon: number,
): PlacedTurbine[] {
  if (turbines.length === 0) return [];
  const avgLat = turbines.reduce((s, t) => s + t.lat, 0) / turbines.length;
  const avgLon = turbines.reduce((s, t) => s + t.lon, 0) / turbines.length;
  return turbines.map((t) => ({
    ...t,
    id: `relocated-${t.id}`,
    lat: targetLat + (t.lat - avgLat),
    lon: targetLon + (t.lon - avgLon),
  }));
}
```

**Ta bort hela funktionen + JSDoc.**

---

## ÄNDRING 4: `src/pages/PlaceTurbines.tsx` — Ny `handleEnterEditorDirect`

**Hitta** `handleEnterEditorDirect` (runt rad 527–555). Ser ut ungefär så här:

```ts
  const handleEnterEditorDirect = useCallback((project: ApiProjectArea) => {
    const boundary = apiPolygonToLatLon(project.polygon ?? null);
    const isBundledKatrineholm = project.id === 10001;
    const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? '';
    const nativeNoApi = isNative() && !apiBase;
    const preloadedTurbines = (() => {
      if (isBundledKatrineholm) return DEFAULT_TURBINES;
      if (nativeNoApi && project.centerLat && project.centerLng) {
        return translateTurbinesToCenter(DEFAULT_TURBINES, project.centerLat, project.centerLng);
      }
      return [];
    })();
    setEditHandoff({
      projectId: String(project.id),
      projectName: project.name,
      municipality: project.kommun ?? undefined,
      turbines: preloadedTurbines,
      centerLat: project.centerLat ?? null,
      centerLng: project.centerLng ?? null,
      boundary,
    });
    setTurbines(preloadedTurbines);
    setCommittedTurbines(preloadedTurbines);
    setShowWelcome(false);
  }, []);
```

**Ersätt HELA funktionen** med:

```ts
  const handleEnterEditorDirect = useCallback((project: ApiProjectArea) => {
    const boundary = apiPolygonToLatLon(project.polygon ?? null);
    const isBundledKatrineholm = project.id === 10001;
    const turbineCount = project.turbineCountPlannedMin ?? project.turbineCountPlannedMax ?? 8;
    const hasCoords = typeof project.centerLat === 'number' && typeof project.centerLng === 'number';

    const preloadedTurbines = (() => {
      // Katrineholm/Ericsberg — använd exakta DEFAULT_TURBINES
      if (isBundledKatrineholm) return DEFAULT_TURBINES;
      // Projekt utan koordinater — tom karta
      if (!hasCoords) return [];
      // Projekt med polygon — klipp rutnätet mot polygonen
      if (boundary && boundary.length >= 3) {
        return generateProjectGrid(project.centerLat!, project.centerLng!, turbineCount, boundary);
      }
      // Små projekt utan polygon — använd Katrineholm-template översatt
      if (turbineCount <= 10) {
        return translateDefaultTurbines(project.centerLat!, project.centerLng!, turbineCount);
      }
      // Stora projekt utan polygon — generera fritt rutnät
      return generateProjectGrid(project.centerLat!, project.centerLng!, turbineCount, null);
    })();

    setEditHandoff({
      projectId: String(project.id),
      projectName: project.name,
      municipality: project.kommun ?? undefined,
      turbines: preloadedTurbines,
      centerLat: project.centerLat ?? null,
      centerLng: project.centerLng ?? null,
      boundary,
    });
    setTurbines(preloadedTurbines);
    setCommittedTurbines(preloadedTurbines);
    setShowWelcome(false);
  }, []);
```

---

## ÄNDRING 5: `src/components/NationalMapView.tsx` — Pin-storlek

Användaren rapporterar att kartan "bara visar 20 prickar" men API:et returnerar 3587. Problemet är att klustret/pins är för små. **Hitta** den CSS/JS som styr pin-storleken i MapLibre (sök efter `circle-radius` eller `paint` eller liknande).

Typiskt står det:

```js
'circle-radius': 4,
'circle-color': '#FF8B01',
```

**Ändra till:**

```js
'circle-radius': [
  'interpolate', ['linear'], ['zoom'],
  4, 6,    // mycket zoomat ut
  8, 8,    // regionalt
  12, 10,  // lokalt
],
'circle-color': '#FF8B01',
'circle-stroke-color': '#ffffff',
'circle-stroke-width': 1.5,
'circle-opacity': 0.95,
```

Detta gör att:
- Vid zoom 4 (hela Sverige) → 6px prickar (syns tydligt)
- Vid zoom 8 (län) → 8px
- Vid zoom 12 (ort) → 10px
- Vit outline → syns mot gröna bakgrunden

**VIKTIGT:** Anpassa söksträngen efter den exakta koden i filen. Leta efter `circle-radius` och redigera DET blocket.

---

## ÄNDRING 6: `src/components/NationalMapView.tsx` — Footer-padding

Användaren rapporterar att appen täcker nederkanten (footer "Tryck på ett projekt på kartan" kapas). **Hitta** root-containern i `return`-blocket (ofta `<div className="nm-page">` eller liknande).

**Lägg till** `pb-[max(env(safe-area-inset-bottom),1rem)]` på root-divven om den saknas. Exempel:

```tsx
return (
    <div className="nm-page pb-[max(env(safe-area-inset-bottom),1rem)]">
```

Om root redan har `pb-...` men inte `safe-area-inset-bottom`, uppdatera till:

```tsx
<div className="nm-page pb-[max(env(safe-area-inset-bottom),1rem)]">
```

---

## ÄNDRING 7: `src/components/NationalMapView.tsx` — Mindre aggressiv selectedProject-reset

Användaren rapporterar "bara 1 sek att jag kan redigera Ericsberg sen försvinner den". Troligen orsak: useEffect (runt rad 770-773) återställer `selectedProject` till null när `projects`-listan uppdateras.

**Hitta** (runt rad 769–774):

```ts
  useEffect(() => {
    if (!selectedProject) return;
    const updated = projects.find(p => String(p.id) === String(selectedProject.id));
    if (!updated) setSelectedProject(null);
    else if (updated !== selectedProject) setSelectedProject(updated);
  }, [projects]);
```

**Ersätt med** (VIKTIGT: vi återställer INTE selectedProject till null om det inte finns — vi behåller det):

```ts
  useEffect(() => {
    if (!selectedProject) return;
    const updated = projects.find(p => String(p.id) === String(selectedProject.id));
    // Behåll selectedProject även om det inte finns i uppdaterad lista —
    // undviker att knappen "📐 Öppna projektet" försvinner efter 1 sek.
    if (updated && updated !== selectedProject) setSelectedProject(updated);
  }, [projects]);
```

---

## SAMMANFATTNING

| Fil | Ändring |
|-----|---------|
| `src/lib/projectGridLayout.ts` | NY FIL — rutnätsgenerator + translateDefaultTurbines |
| `src/pages/PlaceTurbines.tsx` | Lägg till import, ta bort translateTurbinesToCenter, ny handleEnterEditorDirect |
| `src/components/NationalMapView.tsx` | Pin-storlek, footer-padding, mindre aggressiv selectedProject-reset |

---

## EFTER ÄNDRINGAR

1. Visa diff för alla ändrade filer
2. Kör typecheck (`pnpm typecheck` eller `tsc --noEmit`)
3. Rör INGA andra filer
4. Bygg INTE om — vänta på OK
5. Committa med: `V14: V12 redo applicerad + pin-storlek + footer-padding + selectedProject-stabilitet`
