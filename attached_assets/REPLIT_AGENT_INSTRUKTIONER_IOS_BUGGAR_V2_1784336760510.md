# Replit Agent – iOS-bugfixar för Vindkollen (v2)

**OBS:** Skärmdumparna visade datorns tangentbord i kamerabilden – INTE ett iOS-spöktangentbord. Stryk därför tangentbords-relaterade ändringar. Fokus ligger på de **fyra** riktiga buggarna.

Totalt **5 ändringar** i **6 filer**.

---

## Kontext

Native iOS-app byggd med Capacitor 8 + React + Vite + Wouter (hash-routing på native, path-routing på webb). Testad på iPhone i Safari/WKWebView.

---

## ÄNDRING 1 – `capacitor.config.ts`

**Problem:** Dubbel safe-area-inset (WKWebView lägger på insets + CSS `env(safe-area-inset-*)` → layout-hopp, knappar hamnar under hemindikator).

```ts
// capacitor.config.ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'katrineholm.framat.vindkraft',
  appName: 'Vindkollen',
  webDir: 'dist',
  ios: {
    contentInset: 'automatic',  // <-- BYTT från "always" till "automatic"
  },
};

export default config;
```

---

## ÄNDRING 2 – `src/pages/MyProjects.tsx` (saknad safe-area)

**Problem:** "Vid inlogg ser man bakgrunden nedtill" – `min-h-screen` utan `pb-[env(safe-area-inset-bottom)]`.

```tsx
// src/pages/MyProjects.tsx
// RAD 140 (loading-state):
<div className="flex min-h-screen items-center justify-center bg-[#090909] text-white pb-[env(safe-area-inset-bottom)]">

// RAD 147 (huvudvy):
<div className="min-h-screen bg-[#090909] text-white pb-[env(safe-area-inset-bottom)]">
```

---

## ÄNDRING 3 – Övriga sidor med `min-h-screen`

Samma safe-area-problem på Terms, Privacy, Contact, About, not-found.

```tsx
// src/pages/Terms.tsx rad 6:
<div className="min-h-screen bg-[#090909] text-white pb-[env(safe-area-inset-bottom)]">

// src/pages/Privacy.tsx rad 6:
<div className="min-h-screen bg-[#090909] text-white pb-[env(safe-area-inset-bottom)]">

// src/pages/Contact.tsx rad 6:
<div className="min-h-screen bg-[#090909] text-white pb-[env(safe-area-inset-bottom)]">

// src/pages/About.tsx rad 6:
<div className="min-h-screen bg-[#090909] text-white pb-[env(safe-area-inset-bottom)]">

// src/pages/not-found.tsx rad 6:
<div className="min-h-screen w-full flex items-center justify-center bg-gray-50 pb-[env(safe-area-inset-bottom)]">
```

---

## ÄNDRING 4 – `src/pages/PlaceTurbines.tsx` + `src/components/NationalMapView.tsx`

**Problem:** På iPhone öppnades inte redigeringsvyn när man tryckte "Öppna projektet" i nationella kartan. Hash-bounce-tekniken (`window.location.hash = "/"; setTimeout(...);`) är otillförlitlig i WKWebView.

### 4a. `src/components/NationalMapView.tsx`

Byt prop-namn för tydlighet:

```tsx
interface NationalMapViewProps {
  projects: ApiProjectArea[];
  filteredProjects: ApiProjectArea[];
  selectedProject: ApiProjectArea | null;
  loadState: MapLoadState;
  onSelectProject: (project: ApiProjectArea | null) => void;
  onBack: () => void;
  // BYTT namn från "onEnterEditor" till "onEnterEditorDirect":
  onEnterEditorDirect: (project: ApiProjectArea) => void;
}
```

Knappen (runt rad 991):

```tsx
<button
  onClick={() => onEnterEditorDirect(selectedProject)}
  className="w-full rounded-full bg-[#FF8B01] py-3 text-sm font-bold text-[#090909] shadow-lg shadow-[#FF8B01]/20 transition hover:bg-[#FFB347] active:bg-[#FF8B01]"
  style={{ touchAction: 'manipulation' }}
>
  📐 Öppna projektet
</button>
```

### 4b. `src/pages/PlaceTurbines.tsx`

Monteringen av NationalMapView (runt rad 740):

```tsx
<NationalMapView
  projects={projects}
  filteredProjects={filteredProjects}
  selectedProject={selectedProject}
  loadState={mapLoadState}
  onSelectProject={setSelectedProject}
  onBack={() => setShowWelcome(true)}
  onEnterEditorDirect={handleEnterEditorDirect}  {/* ← NY prop-namn */}
/>
```

Lägg till en NY `handleEnterEditorDirect`-funktion i komponenten:

```tsx
const handleEnterEditorDirect = useCallback((project: ApiProjectArea) => {
  if (!project) return;
  // Sätt state direkt – komponenten är redan monterad (showWelcome === true)
  setEditHandoff(project);
  setTurbines([]);
  setShowWelcome(false);
}, []);
```

Och ta bort den gamla hash-bounce-koden (`window.location.hash = "/"; setTimeout(...)`).

---

## ÄNDRING 5 – `src/components/NationalMapView.tsx` (layout-hopp / Meny-knapp försvinner)

**Problem:** "Efter en stund hoppade allt ner i kartvyn så knappen längst ner försvann" – `ResizeObserver` triggar `map.resize()` → feedback-loop + `.nm-diag` (dev-diagnostik) ligger `position: absolute; z-index: 1000` och kan täcka projektkortets knapp.

Hitta `ResizeObserver`-blocket (runt rad 709–714) och **debounce** det:

```tsx
// BYT UT:
const ro = new ResizeObserver(() => {
  if (cancelled) return;
  map.resize();
  requestAnimationFrame(() => { if (!cancelled) map.resize(); });
  updateCanvasSize();
  updateContainerDims();
});
ro.observe(container);

// MOT:
let resizeScheduled = false;
const ro = new ResizeObserver(() => {
  if (cancelled || resizeScheduled) return;
  resizeScheduled = true;
  requestAnimationFrame(() => {
    resizeScheduled = false;
    if (cancelled) return;
    map.resize();
    updateCanvasSize();
    updateContainerDims();
  });
});
ro.observe(container);
```

Och **döda setTimeout-kedjan** (runt rad 716–718):

```tsx
// TA BORT:
// const t1 = setTimeout(() => { ... }, 150);
// const t2 = setTimeout(() => { ... }, 500);
// const t3 = setTimeout(() => { ... }, 1500);
// ... och även:
// disposers.push(() => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); });
```

Och **säkra `.nm-diag` så den inte blockerar projektkortets knapp** (rad ~836–837):

```tsx
{import.meta.env.DEV && (
  <div
    className="pointer-events-none absolute bottom-0 left-0 right-0 z-50"
    style={{ maxHeight: diagExpanded ? '42dvh' : '24px' }}  // LÄGG TILL
  >
    <div className={`nm-diag text-[10px] font-mono text-white/90 ${diagExpanded ? 'pointer-events-auto' : 'pointer-events-none'}`}>
```

**Vad fixar detta:** Förhindrar ResizeObserver-feedback-loopen, tar bort onödiga `map.resize()`-anrop, och säkrar att dev-diagnostiken inte blockerar projektkortets "Öppna projektet"-knapp.

---

## Sammanfattning – 4 riktiga buggar

| # | Fil | Bug som fixas |
|---|-----|---------------|
| 1 | `capacitor.config.ts` | Dubbel safe-area-inset → layout-hopp |
| 2 | `src/pages/MyProjects.tsx` | Bakgrund syns nedtill efter inlogg |
| 3 | `src/pages/{Terms,Privacy,Contact,About,not-found}.tsx` | Samma safe-area-problem |
| 4 | `src/pages/PlaceTurbines.tsx` + `NationalMapView.tsx` | "Öppna projektet" fungerar inte på iPhone |
| 5 | `src/components/NationalMapView.tsx` | Layout-hopp efter tid i kartvyn, knapp försvinner |

---

## Testplan efter ändringarna (på riktig iPhone)

1. `npm run build && npx cap sync ios && npx cap run ios` (eller öppna i Xcode)
2. **Sverigekartan** – tryck på en pinne → projektkort → "📐 Öppna projektet" ska öppna PlaceTurbines direkt
3. **Sverigekartan efter 30+ sekunder** – inga layout-hop, "Öppna projektet"-knappen ska vara kvar
4. **Mina projekt** – bakgrund ska gå hela vägen ner under hemindikatorn
5. **Terms/Privacy/Contact/About** – samma test, inget vitt fält under hemindikatorn

---

**INTE längre aktuellt (stryk dessa):**
- `index.html` ändring av `viewport` (var relaterad till spöktangentbord)
- `src/index.css` `touch-action`/`user-select` (var relaterad till tap-markering från spöktangentbord)
- `Info.plist` `keyboardDisplayRequiresUserAction` (förhindrar ingenting om det inte finns något tangentbord)
- `capacitor.config.ts` `SplashScreen`-plugin (inte relevant)
