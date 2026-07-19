# V19 — Sju förbättringar efter fälttest (3587 projekt, Ericsberg, simulator)

## Kontext
Fältrapport från iPhone (iOS, native build):

1. **Långsam projekladdning** — 3587 projekt tar 3.5s, ingen progress-bar
2. **Ljud av i simulator** — borde vara PÅ default
3. **Verk syns inte i simulator** — inomhusdetektion döljer allt
4. **Ericsberg bugg** — redigeraren har 8 verk (projekt 32), men "Se i AR" byter till GPS-närmaste (29 verk) → användaren förvirrad
5. **Hemknapp saknas** — kan inte återgå till startläge utan att ladda om appen
6. **PDF för Ericsberg saknas** — V17-instruktionen inte applicerad
7. **Ingen nedräkning** — när verken laddas syns inget, bara loggrad "force-showing 3 nearest"

---

## ÄNDRING 1 — Progress-bar medan 3587 projekt laddas

`src/components/NationalMapView.tsx`

Hitta `setIsLoading` eller liknande. Lägg till progress-state i komponenten:

```ts
const [loadProgress, setLoadProgress] = useState(0);

// Inne i datahämtningen, uppdatera progress:
setLoadProgress(0); // start
// ... efter 50% av arbetet ...
setLoadProgress(50);
// ... efter data returnerats ...
setLoadProgress(100);
setTimeout(() => setLoadProgress(0), 500); // fade bort
```

Lägg till progress-bar UI (top-bar under "X projekt · Y verk"):

```tsx
{loadProgress > 0 && loadProgress < 100 && (
  <div className="absolute left-0 right-0 top-0 z-50 h-1 bg-[#FF8B01]/30">
    <div
      className="h-full bg-[#FF8B01] transition-all duration-300"
      style={{ width: `${loadProgress}%` }}
    />
  </div>
)}
```

Uppdatera progress vid:
- `0%` direkt vid start av fetch
- `30%` efter 200ms (visuell feedback att något händer)
- `70%` när data returnerats
- `100%` efter rendering

---

## ÄNDRING 2 — Ljud PÅ default i simulerat läge

`src/pages/Home.tsx`

Hitta där `autoEnabled` (eller liknande) sätts för vindljud. Lägg till effekt:

```ts
// I en useEffect som reagerar på positionOverride:
useEffect(() => {
  if (positionOverride !== null) {
    setSoundAutoEnabled(true); // sätt PÅ i simulerat läge
  }
}, [positionOverride]);
```

(Anpassa variabelnamn efter befintlig kod — sök efter `autoEnabled` eller liknande i `VisualizationControls`/`SoundLevelPanel`.)

---

## ÄNDRING 3 — Verken alltid synliga i simulerat läge (ingen ocklusion)

`src/components/ARScene.tsx`

Hitta rad där `useSkyDetection` används i `Home.tsx` eller `ARScene`. Lägg till:

```ts
// I Home.tsx, där sky/isPointSky skickas till ARScene:
isPointSky={positionOverride !== null ? () => true : sky.isPointSky}
getOcclusionGrid={positionOverride !== null ? () => new Float32Array(GRID_COLS * GRID_ROWS).fill(1) : sky.getOcclusionGrid}
```

(Importera `GRID_COLS, GRID_ROWS` från `@/hooks/useSkyDetection`.)

Och stäng av `globalVisibilityFactor` i simulerat läge:

```tsx
globalVisibilityFactor={positionOverride !== null ? 1 : globalVisibilityFactor}
```

---

## ÄNDRING 4 — FIXA: Handoff-projekt vinner över GPS-automatval

`src/pages/Home.tsx`

**Diagnos**: Användaren redigerar projekt 32 (8 verk), klickar "Se i AR", AR startar med 8 verk från handoff, men sen tar GPS över och byter till "Ericsbergs planer" (29 verk från GPS-närmaste).

**Lösning**: När vi har en handoff (kommer från editorn), använd ALLTID den — ignorera GPS-automatvalet.

Hitta useEffect:en som gör "GPS-automatval" (sök efter `GPS-automatval` i konsolen → logik i koden). Wrappa den så att den inte körs när vi har en handoff:

```ts
// Hitta koden som gör:
//   if (geo.lat && geo.lon) {
//     const nearest = findNearestProject(geo.lat, geo.lon);
//     setActiveProject(nearest);
//   }

// Ändra till:
useEffect(() => {
  if (editHandoff) return; // <-- LÄGG TILL: handoff vinner ALLTID
  if (!geo.lat || !geo.lon) return;
  // ... befintlig GPS-automatval-logik ...
}, [geo.lat, geo.lon, editHandoff]);
```

Eller, om logiken är mer komplex: sätt en flagga `hasHandoff` som blockerar automatvalet:

```ts
const hasHandoff = Boolean(editHandoff && editHandoff.turbines?.length > 0);
```

Använd den i alla platser där projektet sätts automatiskt från GPS.

---

## ÄNDRING 5 — "🏠 Hem"-knapp som rensar allt

`src/pages/Home.tsx`

Lägg till en Hem-knapp i top-bar bredvid "Kartan"-knappen:

```tsx
<button
  onClick={() => {
    // Rensa allt: handoff, position, valt projekt
    localStorage.removeItem("vindkraft-ar-katrineholm:customPlacement");
    setPositionOverride(null);
    setActiveProject(null);
    setStarted(false); // tillbaka till PermissionGate
    navigate("/"); // hem-route
  }}
  className="rounded-full bg-white/10 px-3 py-1.5 text-sm text-white/60 hover:bg-white/20"
  aria-label="Tillbaka till start"
>
  🏠 Hem
</button>
```

(Anpassa variabelnamn efter befintlig kod.)

---

## ÄNDRING 6 — PDF-knapp för Ericsberg (V17 applicerad)

`src/pages/PlaceTurbines.tsx`

Installera först:
```bash
npm install jspdf
```

Skapa `src/lib/projectPdfExport.ts`:

```ts
import jsPDF from "jspdf";
import type { Project } from "./types";

export function generateProjectPdf(project: Project, opts: {
  turbines: Array<{ lat: number; lng: number }>;
  bbox?: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  title?: string;
}): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 15;
  let y = margin;

  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text(opts.title || project.name, margin, y);
  y += 8;

  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(`Kommun: ${project.municipality ?? "—"}`, margin, y); y += 5;
  doc.text(`Status: ${project.status ?? "—"}`, margin, y); y += 5;
  doc.text(`Antal verk: ${opts.turbines.length}`, margin, y); y += 5;
  if (project.turbineCountPlannedMax) {
    doc.text(`Planerat max: ${project.turbineCountPlannedMax}`, margin, y); y += 5;
  }
  y += 5;

  // Bbox
  if (opts.bbox) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    const { minLat, maxLat, minLng, maxLng } = opts.bbox;
    doc.text(
      `Bounding box: ${minLat.toFixed(4)}–${maxLat.toFixed(4)} N, ${minLng.toFixed(4)}–${maxLng.toFixed(4)} E`,
      margin, y
    );
    y += 6;
  }

  // Bbox map
  if (opts.bbox && opts.turbines.length > 0) {
    const mapW = pageW - margin * 2;
    const mapH = 80;
    const { minLat, maxLat, minLng, maxLng } = opts.bbox;
    const latRange = maxLat - minLat || 0.01;
    const lngRange = maxLng - minLng || 0.01;

    doc.setDrawColor(180);
    doc.setLineWidth(0.2);
    doc.rect(margin, y, mapW, mapH);
    doc.setFillColor(34, 139, 34);
    opts.turbines.forEach((t) => {
      const x = margin + ((t.lng - minLng) / lngRange) * mapW;
      const z = y + mapH - ((t.lat - minLat) / latRange) * mapH;
      doc.circle(x, z, 0.6, "F");
    });
    y += mapH + 5;
  }

  // Turbin-lista
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Turbinpositioner:", margin, y); y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("#", margin, y);
  doc.text("Lat", margin + 10, y);
  doc.text("Lng", margin + 40, y);
  y += 4;

  const max = Math.min(opts.turbines.length, 30);
  for (let i = 0; i < max; i++) {
    if (y > 270) { doc.addPage(); y = margin; }
    const t = opts.turbines[i];
    doc.text(String(i + 1), margin, y);
    doc.text(t.lat.toFixed(5), margin + 10, y);
    doc.text(t.lng.toFixed(5), margin + 40, y);
    y += 4;
  }
  if (opts.turbines.length > 30) {
    doc.setFont("helvetica", "italic");
    doc.text(`…och ${opts.turbines.length - 30} till`, margin, y);
    y += 5;
  }

  doc.setFontSize(7);
  doc.setTextColor(120);
  doc.text(
    `Genererad ${new Date().toISOString().slice(0, 10)} från Vindkollen`,
    margin, 290
  );

  return doc;
}
```

I `PlaceTurbines.tsx`, lägg till en 📄-knapp bredvid ↻-knappen:

```tsx
import { generateProjectPdf } from "../lib/projectPdfExport";

const handleDownloadPdf = () => {
  if (!selectedProject) return;
  const projectTurbines = selectedProject.turbines || DEFAULT_TURBINES;
  if (projectTurbines.length === 0) return;
  const lats = projectTurbines.map((t: any) => t.lat);
  const lngs = projectTurbines.map((t: any) => t.lng);
  const doc = generateProjectPdf(selectedProject, {
    turbines: projectTurbines,
    bbox: {
      minLat: Math.min(...lats), maxLat: Math.max(...lats),
      minLng: Math.min(...lngs), maxLng: Math.max(...lngs),
    },
  });
  doc.save(`${selectedProject.name.replace(/\s+/g, "_")}.pdf`);
};

// I UI, efter ↻-knappen:
<button
  onClick={handleDownloadPdf}
  className="rounded-full bg-white/10 px-3 py-1.5 text-sm text-white/60 hover:bg-white/20"
  aria-label="Ladda ner PDF"
  title="Ladda ner projektsammanfattning som PDF"
>
  📄
</button>
```

---

## ÄNDRING 7 — Nedräkning tills verken syns

`src/pages/Home.tsx`

Lägg till en state som räknar upp tills första verket syns:

```ts
const [arStartupSeconds, setArStartupSeconds] = useState(0);
const [showStartupCounter, setShowStartupCounter] = useState(false);

useEffect(() => {
  if (!started) return;
  setArStartupSeconds(0);
  setShowStartupCounter(true);
  const id = window.setInterval(() => {
    setArStartupSeconds(s => s + 1);
  }, 1000);
  return () => window.clearInterval(id);
}, [started]);

// Stäng av när första verk syns:
useEffect(() => {
  if (arSceneRef.current) {
    const visible = arSceneRef.current.getInFrontOfCameraCount?.() ?? 0;
    if (visible > 0 && showStartupCounter) {
      setShowStartupCounter(false);
    }
  }
}, [/* trigga vid varje render */]);
```

UI (visas överst i mitten):

```tsx
{showStartupCounter && (
  <div className="pointer-events-none absolute left-1/2 top-1/3 z-50 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-black/80 px-6 py-4 text-center text-white shadow-2xl">
    <div className="text-4xl">🌬️</div>
    <div className="mt-2 text-lg font-semibold">Hittar vindkraftverken…</div>
    <div className="mt-1 text-sm text-white/60">{arStartupSeconds}s</div>
    <div className="mt-2 text-xs text-white/40">Peka kameran runt</div>
  </div>
)}
```

---

## Verifiering

1. **Laddning**: Klicka "Kartan" → progress-bar visas 0%→100% på < 5s
2. **Ljud simulator**: Öppna Ericsberg → "Se i AR" → ljud PÅ utan att behöva trycka
3. **Verk synliga**: Inomhus, simulator-läge → alla 8 verk synliga från start (inte dolda)
4. **Rätt projekt**: Ericsberg-editorn → "Se i AR" → exakt 8 verk, INTE 29
5. **Hemknapp**: AR → klicka 🏠 → tillbaka till PermissionGate, allt rensat
6. **PDF**: Editorn → 📄 → "Ericsbergs_planer.pdf" laddas ner
7. **Nedräkning**: AR startar → "Hittar vindkraftverken… 0s" → 1s, 2s, ... → försvinner när verk syns

---

## Leverans
- Ändra: `src/components/NationalMapView.tsx` (progress-bar)
- Ändra: `src/components/ARScene.tsx` (om inga ändringar behövs, skippa)
- Ändra: `src/pages/Home.tsx` (ljud, hemknapp, ocklusion, GPS-val, nedräkning)
- Ändra: `src/pages/PlaceTurbines.tsx` (PDF-knapp)
- Ny fil: `src/lib/projectPdfExport.ts`
- Ändra: `package.json` (lägg till `jspdf`)
- Committa som `V19: progress-bar, ljud default, synliga verk i sim, handoff>GPS, hemknapp, PDF, nedräkning`.
