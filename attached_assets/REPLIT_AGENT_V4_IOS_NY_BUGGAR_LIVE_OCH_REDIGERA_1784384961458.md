# Vindkollen iOS — V4-instruktion: 4 nya buggar + AR-hinder-detektering

> **Förutsättning:** Den här V4-filen bygger vidare på den kod som finns på `main` efter
> commit `9c95c94` (Bugg 7+8-fix). **Bekräfta att `9c95c94` är deployad i Replit**
> innan du kör V4 — annars tillämpa V3 först.
>
> **Mål:** Fixa de nya buggar som upptäckts manuellt på iPhone efter V3, och
> presentera en designskiss för AR-hinder-detektering.
>
> **Testmiljö:** iPhone 12 mini / iPhone 14 Pro, iOS 17, Safari + TestFlight.

---

## De 4 nya buggarna (verifierade på riktig iPhone efter V3)

| #   | Vad händer / observation                                                                                              | Allvarlighet | Status           |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------- |
| 9   | "Live-data kunde inte hämtas — pilotdataset visas" visas **andra gången** man öppnar appen                            | Hög          | Reproducerbar    |
| 10  | Trycker man "📐 Öppna projektet" på en projektruta i kartan → **inget händer**                                        | Kritisk      | Reproducerbar    |
| 11  | Trycker man "🎯 Visa närmaste verk direkt (utan karta)" → Katrineholms editor öppnas; **när man zoomar ut fryser allt** | Kritisk    | Reproducerbar    |
| 12  | På mobilen syns **inte Meny-knappen nederst**; V3-fixet (`pb-[max(3.5rem,…)]`) räckte inte                            | Hög          | Reproducerbar    |

Bonus: Nice-to-have-designförslag för AR-hinder-detektering (avsnitt 5).

---

## 1. Orsaksanalys

### 1.1 Bugg 9 — "Live-data kunde inte hämtas" (andra gången)

Faktiskt felmeddelande (`src/components/NationalMapView.tsx` rad 1050):

```tsx
{loadState === 'live-error' && (
  <p className="mb-1 text-[11px] text-yellow-400/90">
    ⚠️ Live-data kunde inte hämtas — pilotdataset visas
  </p>
)}
```

`NationalMapView` mountas när `showWelcome=true`. Direkt: `BUNDLED_PROJECTS` (20 pilotprojekt) visas. Direkt efter:

```ts
fetch('/api/wind/project-areas?minLat=55&maxLat=70&minLng=10&maxLng=25')
```

**Problemet:** `apiUrl()` returnerar **relativ URL** om `VITE_API_BASE_URL` är tomt. I native (Capacitor på `capacitor://localhost`) fungerar INTE relativa URL:er — `window.location.origin` pekar inte mot din API-server.

Koden varnar redan (rad 311-315):

```ts
if (native && !apiBase) {
  const warn = 'VITE_API_BASE_URL saknas i native-bygget — relativ URL fungerar inte i Capacitor';
  console.warn('[NationalMap]', warn, { url, native });
  setApiDiag(prev => ({ ...prev, lastApiError: warn }));
}
```

Det fungerar ALDRIG på native om `VITE_API_BASE_URL` saknas. Vad användaren ser:

- Första gången: felet syns bara i diagnostikpanelen (DEV), UI visar "Laddar projekt…".
- Andra gången: användaren jämför med webben och ser feltexten tydligt. Eller också har ett mellanliggande steg nu hunnit cachelagra ett 4xx/5xx-svar.

**Sannolika orsaker (i prioritetsordning):**

1. **`VITE_API_BASE_URL` är inte satt i native-byggmiljön** (Replit-Secret eller `.env`-fil).
   Sätt i Replit → Secrets:
   ```
   VITE_API_BASE_URL=https://<ditt-replit-projekt>.replit.app
   ```
2. **CORS / ATS på riktig URL.** Native iOS WKWebView har striktare App Transport
   Security. Din API-server kanske saknar `Access-Control-Allow-Origin` för
   `capacitor://localhost`. Testa i Safari DevTools (Mac → Develop → iPhone).
3. **fetch-timing.** Bundled visas först, sedan plötsligt hoppar loadState till `'live-error'`.
   Bundled-data finns kvar men felmeddelandet dyker upp.

**Diagnostik:** Anslut Mac Safari → Develop → iPhone → localhost → inspektera
`apiBase`, `url`, `native`, `httpStatus`, `lastApiError` i konsolen.

### 1.2 Bugg 10 — "📐 Öppna projektet" gör inget

**Plats:** `src/components/NationalMapView.tsx` rad 1033:

```tsx
<button
  onClick={() => onEnterEditorDirect(selectedProject)}
  ...
>
  📐 Öppna projektet
</button>
```

`onEnterEditorDirect` är `handleEnterEditorDirect` i `src/pages/PlaceTurbines.tsx` (rad 527-551):

```ts
const handleEnterEditorDirect = useCallback((project: ApiProjectArea) => {
  const boundary = apiPolygonToLatLon(project.polygon ?? null);
  const isBundledKatrineholm = project.id === 10001;   // ← fel: bundledProjects har inte numeriska id:n
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? '';
  const nativeNoApi = isNative() && !apiBase;
  const preloadedTurbines = (() => {
    if (isBundledKatrineholm) return DEFAULT_TURBINES;
    if (nativeNoApi && project.centerLat && project.centerLng) {
      return translateTurbinesToCenter(DEFAULT_TURBINES, project.centerLat, project.centerLng);
    }
    return [];
  })();
  setEditHandoff({...});
  setTurbines(preloadedTurbines);
  setCommittedTurbines(preloadedTurbines);
  setShowWelcome(false);
}, []);
```

**Tre möjliga orsaker, alla behöver fixas:**

1. **`isBundledKatrineholm` är trasigt** — kollar `project.id === 10001`, men
   `BUNDLED_PROJECTS` har id som `katrineholm-framat` / `katrineholm-framat-2` osv.
   För ett icke-Katrineholms-projekt: `preloadedTurbines = []` (tom karta).
2. **`nativeNoApi` är `true` på iPhone** om `VITE_API_BASE_URL` saknas.
   `preloadedTurbines = translateTurbinesToCenter(DEFAULT_TURBINES, …)` → 8
   förskjutna verk visas. OK.
3. **Klick-eventet når inte knappen.** `selectedProject` kan vara null (om
   användaren klickade på kartan men inte på en markör — rad 642 nollställer
   den), eller så finns en oavsiktlig pointer-events-overlay ovanpå.

**Verifiera först vilken av dessa det är** genom att lägga till en `console.log`
i handlern (se 2.2 steg 1).

### 1.3 Bugg 11 — Krasch/frysning från B4 "Visa närmaste verk direkt"

**Flödet (B4 i `src/components/PermissionGate.tsx` rad 130-145):**

```tsx
<button
  onClick={() => {
    sessionStorage.setItem("vindkollen:placeraEditorDirect", "1");
    openPlaceraEditor();
  }}
  ...
>
  🎯 Visa närmaste verk direkt (utan karta)
</button>
```

`openPlaceraEditor()` (`src/lib/capacitorBridge.ts` rad 81):

```ts
export function openPlaceraEditor(): void {
  if (isNative()) void stopNativeCameraPreview();
  sessionStorage.setItem("vindkollen:placeraEditorDirect", "1");
  window.location.hash = "/placera";
}
```

I `PlaceTurbines.tsx` rad 184:

```ts
if (direct) return false;  // showWelcome blir false direkt
```

→ Mountar editorn med `editHandoff = null`, `showWelcome = false`,
`initialTurbines = DEFAULT_TURBINES` (Katrineholms 8 verk).

**Användaren förväntar sig vita kartan (som på webben), inte Katrineholms editor.**

När de zoomar ut → `currentLatSpan > 1.2` → "Vill du gå tillbaka till
Sverigekartan?"-banner visas (rad 877-893). Trycker användaren där:

```ts
onClick={openSverigekartan}  // ← öppnar Browser-plugin till vindkollen.com
```

- På native: SFSafariViewController-arket öppnas.
- På webben: `window.location.href = "/vindkraft-karta/"` → 404 / NotFound.

**Den upplevda "kraschen/frysningen"** är alltså INTE en krasch — det är att
användaren skickas till en sida som inte finns, eller en Browser-sheet som de
inte inser är en separat vy.

**Rätt lösning:** B4 ska bete sig som webben — öppna **vite kartan**
(Sverigekartan), INTE Katrineholms editor. Byt namn till
"🗺️ Öppna Sverigekartan – välj projekt" och låt den auto-fokusera närmaste
projekt baserat på GPS.

### 1.4 Bugg 12 — Meny-knappen gömd

**V3-fixet** lade `pb-[max(3.5rem,calc(env(safe-area-inset-bottom)+0.75rem))]`
på botten-containern. Borde ge 56-68px padding. På iPhone 14 Pro borde
knappen synas.

**Mest sannolika syndare — `env(safe-area-inset-bottom)` returnerar `0px` på vissa sidor:**

| Fil                                              | Rad | Padding |
| ------------------------------------------------ | --- | ------- |
| `src/pages/MyProjects.tsx`                       | 157 | `pb-[env(safe-area-inset-bottom)]` |
| `src/pages/MyProjects.tsx`                       | 164 | `pb-[max(1.5rem,env(safe-area-inset-bottom))]` ✓ |
| `src/pages/About.tsx`                            | 6   | `pb-[env(safe-area-inset-bottom)]` |
| `src/pages/Terms.tsx`                            | 6   | `pb-[env(safe-area-inset-bottom)]` |
| `src/pages/Privacy.tsx`                          | 6   | `pb-[env(safe-area-inset-bottom)]` |
| `src/pages/Contact.tsx`                          | 6   | `pb-[env(safe-area-inset-bottom)]` |
| `src/pages/not-found.tsx`                        | 6   | `pb-[env(safe-area-inset-bottom)]` |
| `src/components/PlaceTurbines.tsx`               | 962 | `pb-[max(env(safe-area-inset-bottom),12px)]` ✓ |
| `src/pages/Home.tsx`                             | 2022| `pb-[max(3.5rem,calc(env(safe-area-inset-bottom)+0.75rem))]` ✓ |

De fyra första-filerna saknar `max(...)`-wrapper → om `env(...)` returnerar 0px
blir padding också 0px och hemindikatorn klipper knappar.

**Verifiering:** I Safari DevTools på iPhone, kör:
```js
getComputedStyle(document.querySelector('.min-h-screen')).paddingBottom
```
Förväntat: `"0px"` på alla 6 statiska sidor.

---

## 2. Implementeringsplan

### 2.1 Bugg 9 — Gör live-data HÄMTAS på iPhone

**Steg 1: Sätt `VITE_API_BASE_URL` i Replit.**
Replit → ditt projekt → Secrets:
```
VITE_API_BASE_URL=https://<ditt-replit-projekt>.replit.app
```
utan avslutande slash.

**Steg 2: Verifiera att API:t svarar.**
Öppna `https://<ditt-projekt>.replit.app/api/wind/project-areas?minLat=55&maxLat=70&minLng=10&maxLng=25`
i Safari. Förväntat: JSON-array med 20+ projekt.

**Steg 3: Tillåt CORS för native i Replit-servern.**

```ts
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
```

**Steg 4: Mät latens + tydligare fel-UI.**

I `src/components/NationalMapView.tsx` rad 309, byt ut fetch-blocket:

```ts
const t0 = performance.now();
fetch(url, { signal: AbortSignal.timeout(8000) })
  .then(r => {
    console.info('[NationalMap] API fetch', { ms: (performance.now() - t0).toFixed(0), status: r.status });
    httpStatus = r.status;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setApiDiag(prev => ({ ...prev, apiHttpStatus: r.status }));
    return r.json() as Promise<ApiProjectArea[]>;
  })
  // ... resten som tidigare, men i catch:
  .catch((error: unknown) => {
    if (cancelled) return;
    const msg = error instanceof Error ? error.message : String(error);
    const ms = (performance.now() - t0).toFixed(0);
    console.error('[NationalMap] Projekt-API misslyckades', { url, error, native, httpStatus, apiBase, ms });
    setLoadState('live-error');
    setApiDiag(prev => ({
      ...prev,
      apiHttpStatus: httpStatus,
      apiSource: 'error',
      lastApiError: native && !apiBase
        ? 'VITE_API_BASE_URL är inte satt i native-bygget'
        : msg,
    }));
  });
```

Förbättra felmeddelandet (rad 1050):

```tsx
{loadState === 'live-error' && (
  <div className="mb-2 rounded-lg border border-yellow-400/30 bg-yellow-500/10 px-3 py-2 text-[11px] text-yellow-100">
    <p className="font-semibold">⚠️ Live-data kunde inte hämtas — pilotdataset visas</p>
    {apiDiag.lastApiError && (
      <p className="mt-1 text-yellow-200/70">Orsak: {apiDiag.lastApiError}</p>
    )}
    <button
      onClick={() => window.location.reload()}
      className="mt-1.5 rounded-full bg-yellow-500/20 px-3 py-1 text-[10px] font-semibold text-yellow-100 hover:bg-yellow-500/30"
    >
      🔄 Försök igen
    </button>
  </div>
)}
```

### 2.2 Bugg 10 — Fixa "Öppna projektet"

**Steg 1: Diagnostisera — lägg till loggning.**

`src/components/NationalMapView.tsx` rad 1033:

```tsx
<button
  onClick={() => {
    console.info('[NationalMap] Open project clicked', { id: selectedProject?.id, name: selectedProject?.name });
    if (selectedProject) onEnterEditorDirect(selectedProject);
    else console.warn('[NationalMap] selectedProject is null');
  }}
  ...
>
  📐 Öppna projektet
</button>
```

**Steg 2: Förhindra att projektkortet stängs vid kart-klick.**

Lägg till `e.stopPropagation()` på projektkortet (rad 994-1037):

```tsx
<div
  className="rounded-2xl border border-white/10 bg-[#131313] p-4"
  onClick={(e) => e.stopPropagation()}  // ← NY
>
```

**Steg 3: Auto-scrolla till projektkortet när det öppnas.**

Lägg till en `useEffect` i `NationalMapView`:

```ts
useEffect(() => {
  if (selectedProject) {
    document.querySelector('.nm-project-card')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}, [selectedProject]);
```

Och byt projektkortets outer-div till att inkludera `nm-project-card`.

**Steg 4: Fixa `isBundledKatrineholm` för nya numeriska id.**

I `src/pages/PlaceTurbines.tsx` rad 529, byt ut:

```ts
// INNAN (fel):
const isBundledKatrineholm = project.id === 10001;

// EFTER (rätt):
const isBundledKatrineholm = String(project.id).startsWith('katrineholm-');
```

Eller ännu hellre — kolla på `project.kommun === 'Katrineholm'`.

### 2.3 Bugg 11 — B4 till vita kartan

**Steg 1: Döp om B4 och ändra beteendet.**

`src/components/PermissionGate.tsx` rad 130-145:

```tsx
<button
  onClick={() => {
    // NY: öppna Sverigekartan med auto-fokus på närmaste projekt
    sessionStorage.setItem("vindkollen:sverigekartanFocusNearest", "1");
    openSverigekartan();
  }}
  disabled={starting}
  className="w-full rounded-full border border-white/20 bg-white/5 py-3.5 text-sm font-medium text-white transition hover:bg-white/10 disabled:opacity-60"
>
  🗺️ Öppna Sverigekartan – välj projekt
</button>

{/* Sekundär knapp: hoppa direkt till Katrineholms editorn (befintlig B4-funktion) */}
<button
  onClick={() => {
    sessionStorage.setItem("vindkollen:placeraEditorDirect", "1");
    openPlaceraEditor();
  }}
  className="w-full rounded-full bg-white/5 py-2 text-xs text-white/60 transition hover:bg-white/10"
>
  🎯 Hoppa direkt till editorn (Katrineholm)
</button>
```

**Steg 2: Implementera "fokusera närmaste projekt" i `NationalMapView`.**

I `src/components/NationalMapView.tsx`, lägg till efter useEffect som laddar
projekt:

```ts
const focusNearest = useMemo(
  () => sessionStorage.getItem("vindkollen:sverigekartanFocusNearest") === "1",
  []
);
useEffect(() => {
  if (!focusNearest || projects.length === 0) return;
  if (!navigator.geolocation) {
    sessionStorage.removeItem("vindkollen:sverigekartanFocusNearest");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      let best: ApiProjectArea | null = null;
      let bestD = Infinity;
      for (const p of projects) {
        if (typeof p.centerLat !== "number" || typeof p.centerLng !== "number") continue;
        const d = Math.hypot(p.centerLat - here.lat, p.centerLng - here.lng);
        if (d < bestD) { bestD = d; best = p; }
      }
      if (best && mapRef.current) {
        mapRef.current.flyTo({ center: [best.centerLng!, best.centerLat!], zoom: 11 });
        setSelectedProject(best);
      }
      sessionStorage.removeItem("vindkollen:sverigekartanFocusNearest");
    },
    () => { sessionStorage.removeItem("vindkollen:sverigekartanFocusNearest"); },
    { enableHighAccuracy: false, timeout: 8000 }
  );
}, [focusNearest, projects]);
```

**Steg 3: Förbättra "tillbaka till kartan"-bannern i PlaceTurbines.**

I `src/pages/PlaceTurbines.tsx` rad 877-893, byt ut `onClick={openSverigekartan}`:

```tsx
<button
  onClick={() => {
    // Gå tillbaka till Sverigekartan INOM appen (samma kod som B4)
    if (editHandoff) {
      setEditHandoff(null);
      setShowWelcome(true);
    } else {
      sessionStorage.setItem("vindkollen:placeraFresh", "1");
      window.location.hash = "/placera";
    }
  }}
  className="pointer-events-auto shrink-0 rounded-full bg-[#FF8B01] px-4 py-1.5 text-xs font-semibold text-[#090909] hover:bg-[#FFB347]"
>
  Ja, gå tillbaka
</button>
```

### 2.4 Bugg 12 — Fixa meny-klippningen

**Steg 1: Ny utility `src/lib/safeArea.ts`:**

```ts
/**
 * Returnerar en CSS-sträng som ger en forcerad minimum-padding-bottom.
 * På iOS / Capacitor returnerar env(...) rätt värde (34px+).
 * På webbläsare som INTE känner igen env() returneras 0px.
 * Vi vill ha ett säkert minimum: 24px för iPhone 8/X, 34px för X+.
 */
export const SAFE_AREA_BOTTOM_CSS =
  "max(env(safe-area-inset-bottom), 24px)";

export const SAFE_AREA_TOP_CSS =
  "max(env(safe-area-inset-top), 24px)";
```

**Steg 2: Utility-klasser i `src/index.css`** (efter rad 463):

```css
/* Forcerad minimum-padding-bottom — fallback när env(...) returnerar 0px */
.safe-bottom-fallback {
  padding-bottom: max(env(safe-area-inset-bottom), 24px);
}
.safe-top-fallback {
  padding-top: max(env(safe-area-inset-top), 24px);
}
```

**Steg 3: Byt ut i alla 6 statiska sidor:**

`MyProjects.tsx:157`:
```tsx
// INNAN
<div className="flex min-h-screen items-center justify-center bg-[#090909] text-white pb-[env(safe-area-inset-bottom)]">
// EFTER
<div className="flex min-h-screen items-center justify-center bg-[#090909] text-white safe-bottom-fallback">
```

`About.tsx:6`, `Terms.tsx:6`, `Privacy.tsx:6`, `Contact.tsx:6`, `not-found.tsx:6`:
```tsx
// INNAN
<div className="min-h-screen bg-[#090909] text-white pb-[env(safe-area-inset-bottom)]">
// EFTER
<div className="min-h-screen bg-[#090909] text-white safe-bottom-fallback">
```

`not-found.tsx:6` har `bg-gray-50` — byt till `bg-[#090909]` för konsistens.

**Steg 4: Öka AR-vyns botten-marginal för säkerhets skull.**

I `src/pages/Home.tsx` rad 2022, öka `pb` från 3.5rem till 4.5rem och extra
safe-area-marginal från 0.75rem till 2rem:

```tsx
// INNAN
<div className="flex flex-col gap-3 bg-gradient-to-t from-black to-transparent px-4 pb-[max(3.5rem,calc(env(safe-area-inset-bottom)+0.75rem))] pt-10">
// EFTER
<div className="flex flex-col gap-3 bg-gradient-to-t from-black to-transparent px-4 pb-[max(4.5rem,calc(env(safe-area-inset-bottom)+2rem))] pt-10">
```

---

## 3. Testplan

### 3.1 Bugg 9
1. Sätt `VITE_API_BASE_URL` i Replit Secrets.
2. `pnpm native:build && pnpm native:sync && pnpm native:ios`.
3. Kör på iPhone → Sverigekartan.
4. Räknaranimation visar "20 → 25 → 1500 → 1571 verk".
5. NativeDiagnostics: "Källa: live · 20 proj".

### 3.2 Bugg 10
1. Sverigekartan → klicka orange/grön markör → projektkort.
2. Klicka "📐 Öppna projektet" → editor öppnas med rätt projekt för-laddat.
3. Om inget händer: Mac Safari DevTools → konsolen ska logga `[NationalMap] Open project clicked`.

### 3.3 Bugg 11
1. Stäng appen, öppna igen.
2. Scrolla ner till botten-knapparna.
3. **Ny knapp:** "🗺️ Öppna Sverigekartan – välj projekt".
4. Klicka → Sverigekartan öppnas → närmaste projekt auto-fokuseras + väljs.
5. Klicka "📐 Öppna projektet" → editor.

### 3.4 Bugg 12
1. Öppna "Mina projekt" / "Om" / "Kontakt" / "Integritetspolicy" / "Villkor".
2. Sista knappen/länken ska INTE klippas av hemindikatorn.
3. iPhone 8: 24px padding-bottom.
4. iPhone 14 Pro: 34px padding-bottom.

---

## 4. Deploy-checklista

- [ ] Sätt `VITE_API_BASE_URL` i Replit Secrets
- [ ] CORS-headers på API-servern
- [ ] `pnpm native:build` → inga typecheck-fel
- [ ] `pnpm native:sync` → inga Capacitor-konflikter
- [ ] `pnpm native:ios` → Xcode öppnas, bygger OK
- [ ] Testa alla 4 buggar på iPhone 12 mini + iPhone 14 Pro
- [ ] Webb-versionen fungerar fortfarande (utan VITE_API_BASE_URL → relative URLs)
- [ ] Committa: `fix: Bugg 9-12 (live-data, redigera-knapp, B4, meny-clipping)`

---

## 5. Nice-to-have: AR-hinder-detektering (designförslag, EJ implementation)

**Problem:** Användaren vill kunna se vindkraftverken även när de är skymda av
träd, byggnader, inomhus-väggar — men göra det tydligt att de är "gömda".

**Tidigare försök:** "rödstreckade verk när fri siktig, dock blev de lite
dolda av moln".

### 5.1 Litteratursökning: tekniker idag

| Teknik | Plattform | Precision | Fri? | Kommentar |
|---|---|---|---|---|
| **ARKit Scene Reconstruction** (LiDAR) | iOS Pro | 5 cm | Ja | Kräver iPhone/iPad Pro (12 Pro+) |
| **ARKit Depth API** (TrueDepth) | iOS 13+ | relativ, kantbaserad | Ja | Alla A12+ |
| **ARCore Depth API** | Android | relativ | Ja | Pixel 4+, Galaxy S20+ |
| **WebXR Depth Sensing** | WebXR | dålig | Ja | Bakom flagga, ingen iOS |
| **Terrängmodellering** (Lantmäteriet) | Alla | 5-50 m | Ja (data) | Approximativt, ingen vegetation |
| **Himmelsanalys** (ljushet, färg) | Alla | 0 | Ja | Approximativt |
| **6DoF + GPS + känd omgivning** | Alla | dålig | Ja | Endast där vi har kartdata |

### 5.2 Rekommenderad approach (utan LiDAR)

**Steg 1: Upptäck "inomhus / skymd sikt" (inga special-sensorer):**

`src/lib/occlusionDetect.ts`:

```ts
export interface OcclusionHint {
  /** Sannolikhet 0..1 att kameran är inomhus / skymd. */
  indoors: number;
  /** Fri-sikt-andel (0..1) av himmel i synfältet. */
  skyRatio: number;
  /** Ljushet (medel RGB 0..1). */
  brightness: number;
  /** Resonemang för diagnostik. */
  reasons: string[];
}

export async function estimateOcclusion(
  videoEl: HTMLVideoElement
): Promise<OcclusionHint> {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { indoors: 0.5, skyRatio: 0.5, brightness: 0.5, reasons: ['canvas-2d-unavailable'] };
  }
  ctx.drawImage(videoEl, 0, 0, 64, 64);
  const { data } = ctx.getImageData(0, 0, 64, 64);
  const pixels = data.length / 4;

  let rMean = 0, gMean = 0, bMean = 0;
  for (let i = 0; i < data.length; i += 4) {
    rMean += data[i]; gMean += data[i+1]; bMean += data[i+2];
  }
  rMean /= pixels; gMean /= pixels; bMean /= pixels;

  let brightSum = 0, blueSum = 0, colorVar = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i+1], b = data[i+2];
    brightSum += (r + g + b) / 3;
    blueSum += Math.max(0, b - Math.max(r, g));
    colorVar += Math.abs(r - rMean) + Math.abs(g - gMean) + Math.abs(b - bMean);
  }
  const brightness = brightSum / pixels / 255;
  const skyRatio = blueSum / (brightSum || 1);
  const variation = colorVar / pixels / 255;

  const reasons: string[] = [];
  if (brightness < 0.15) reasons.push('very-dark');
  if (variation < 0.05) reasons.push('low-contrast');
  if (skyRatio < 0.1) reasons.push('no-sky');

  const indoors = Math.min(1,
    (brightness < 0.2 ? 0.4 : 0) +
    (variation < 0.08 ? 0.3 : 0) +
    (skyRatio < 0.1 ? 0.3 : 0)
  );

  return { indoors, skyRatio, brightness, reasons };
}
```

**Steg 2: Minska AR-föremålens opacitet / strecka dem vid skymd sikt:**

I `src/components/ARScene.tsx` (eller motsvarande):

```tsx
<group ref={turbineGroup}>
  {turbines.map(t => (
    <TurbineModel
      key={t.id}
      {...t}
      opacity={occlusionHint.indoors > 0.5 ? 0.4 * INDOOR_DIM_FACTOR : 1.0}
      wireframe={occlusionHint.indoors > 0.3 && occlusionHint.indoors < 0.7}
    />
  ))}
</group>
```

**Steg 3: Diskret badge i UI:**

```tsx
{occlusionHint.indoors > 0.5 && (
  <div className="absolute left-3 top-32 z-20 rounded-full border border-blue-400/40 bg-blue-500/15 px-3 py-1 text-[10px] text-blue-200">
    🏠 Inomhusläge — verk visas med dämpad opacitet
  </div>
)}
```

### 5.3 Avancerad: ARKit/ARCore Scene Reconstruction

```ts
// Bara på iPhone Pro / iPad Pro
import { ARKit } from '@capacitor-community/arkit';  // finns inte officiellt
// eller react-three/xr + WebXR
import { useXRDepthSensing } from '@react-three/xr';
```

**Status juli 2026:** Inte produktionsklart i WebXR. Kräver native plugin för
Capacitor (3:e-parts). Vänta tills WebXR Depth Module är stabilt (sent 2026 / tidigt 2027).

### 5.4 Prioritering

| Prioritet | Approach | Användarvärde | Implementeringstid |
|---|---|---|---|
| **P1** | 5.2 (canvas-baserad) | Medel | 1-2 dagar |
| **P2** | 5.3 (WebXR Depth) | Hög | 1-2 veckor + native plugin |
| **P3** | 5.2 + sun-position cross-check | Låg | 2-3 dagar |

**Rekommendation:** Börja med P1. 80% av värdet på 10% av tiden.

---

## 6. Filer som ändras

| Fil | Ändring | Bugg |
|---|---|---|
| `src/lib/safeArea.ts` | NY — safe-area utility | 12 |
| `src/lib/occlusionDetect.ts` | NY (valfri, P1) | Nice-to-have |
| `src/index.css` | `.safe-bottom-fallback` + `.safe-top-fallback` | 12 |
| `src/components/PermissionGate.tsx` | Döp om B4, lägg till fokusera-närmaste | 11 |
| `src/components/NationalMapView.tsx` | Loggning, stopPropagation, focusNearest, förbättrad fel-UI | 9, 10, 11 |
| `src/pages/PlaceTurbines.tsx` | Fixa `isBundledKatrineholm`, förbättrad "tillbaka till kartan"-banner | 10, 11 |
| `src/pages/Home.tsx` | Ökad bottom-padding | 12 |
| `src/pages/MyProjects.tsx`, `About.tsx`, `Terms.tsx`, `Privacy.tsx`, `Contact.tsx`, `not-found.tsx` | Byt `pb-[env(safe-area-inset-bottom)]` → `safe-bottom-fallback` | 12 |
| Replit Secrets | `VITE_API_BASE_URL=https://<ditt>.replit.app` | 9 |
| API-server | CORS-headers | 9 |

**Uppskattad total tid för Replit Agent: 4-6 timmar** inklusive iPhone-testning.

---

## 7. Frågor till Poyan innan körning

1. **Vad är API-serverns URL?** Behöver sättas i `VITE_API_BASE_URL`.
2. **Har API:n CORS redan?** Om inte, vem lägger till headers?
3. **B4-knappen: bara ny "Öppna Sverigekartan" eller BÅDA knapparna?**
4. **AR-hinder-detektering (P1) — implementera nu eller efter lansering?**
5. **V4 som en release (version 21) eller flera mindre commits?**

---

*Fil skapad: 2026-07-18 — av HackerAI åt @PoyanSandnell*
