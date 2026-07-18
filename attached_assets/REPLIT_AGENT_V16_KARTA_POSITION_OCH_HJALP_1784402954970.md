# V16 — Två UX-förbättringar (karta-position + guide-knapp)

## Kontext
Efter V15 fungerar redigering och öppning av projekt. Två mindre UX-observationer kvarstår:

1. **Kartan "hänger ner" när man går tillbaka från editorn** — Användaren öppnar kartan, scrollar/zoomar till t.ex. Katrineholm-området, trycker "Öppna projektet", redigerar, trycker "Kartan" för att gå tillbaka. Kartan är då åter på default-position (Sverige-översikt, ofta scrollad så man ser södra Sverige eftersom de flesta projekten finns där). Användaren förväntar sig att kartan är kvar där de senast tittade.
2. **"?"-knappen uppe till höger i redigeringsvyn är obegriplig** — Användaren ser en knapp med bara "?" utan att veta vad den gör. Knapptryckningen öppnar `onboarding`-modalen (introduktionsguiden), men `aria-label="Visa hjälp"` är missvisande. Byt label så det tydligt framgår att det är "Starta om guide".

## Mål
- **ÄNDRING 1**: Spara kartan-position mellan sessioner. När användaren går tillbaka från editorn till kartan ska kartan vara på samma lat/lng/zoom som innan de öppnade editorn. Första gången appen öppnas → default-position.
- **ÄNDRING 2**: "?"-knappen ska tydligt visa att den startar om introduktionsguiden.

## Säkerhet
- Inga ändringar av API-endpoints, inga nya beroenden.
- localStorage-nyckel: `vindkraft:nationalMapView` (JSON: `{centerLat, centerLng, zoom}`).
- Tillåtelser: V15 (befintlig redigerings-/karta-pipeline) — du ska fortsätta använda samma `mapRef`, `doInit` och `moveend`-mönster.

---

## ÄNDRING 1 — Spara/återställ kartposition i `src/components/NationalMapView.tsx`

### 1.1 Lägg till en hjälpkonstant nära toppen av filen
Lägg till (efter befintliga konstanter som `SWEDEN_CENTER`, `SWEDEN_ZOOM`):

```ts
const MAP_VIEW_KEY = "vindkraft:nationalMapView";
type SavedMapView = { centerLat: number; centerLng: number; zoom: number };

function loadSavedMapView(): SavedMapView | null {
  try {
    const raw = localStorage.getItem(MAP_VIEW_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedMapView>;
    if (
      typeof parsed.centerLat === "number" &&
      typeof parsed.centerLng === "number" &&
      typeof parsed.zoom === "number" &&
      Number.isFinite(parsed.centerLat) &&
      Number.isFinite(parsed.centerLng) &&
      Number.isFinite(parsed.zoom) &&
      parsed.zoom >= 2 && parsed.zoom <= 20 &&
      parsed.centerLat >= 50 && parsed.centerLat <= 75 &&
      parsed.centerLng >= 5  && parsed.centerLng <= 35
    ) {
      return { centerLat: parsed.centerLat, centerLng: parsed.centerLng, zoom: parsed.zoom };
    }
    return null;
  } catch {
    return null;
  }
}

function saveMapView(m: maplibregl.Map) {
  try {
    const c = m.getCenter();
    const view: SavedMapView = { centerLat: c.lat, centerLng: c.lng, zoom: m.getZoom() };
    localStorage.setItem(MAP_VIEW_KEY, JSON.stringify(view));
  } catch {
    // localStorage kan saknas/överskridas — ignora tyst
  }
}
```

### 1.2 Återställ sparad position i `doInit` (inom `useEffect` som sätter upp kartan)
I `doInit`, **direkt efter** `const map = new maplibregl.Map({...})` men **före** `map.on('load', ...)`:

```ts
const saved = loadSavedMapView();
const initialCenter: [number, number] = saved
  ? [saved.centerLng, saved.centerLat]
  : SWEDEN_CENTER;
const initialZoom = saved ? saved.zoom : SWEDEN_ZOOM;
```

Och skicka in `center` och `zoom` i Map-konstruktorn (eller anropa `map.jumpTo` direkt efter skapandet, innan listeners). Enklast:

```ts
const map = new maplibregl.Map({
  container,
  style: STYLE_URL,
  center: initialCenter,
  zoom: initialZoom,
  // ... existerande options
});
```

### 1.3 Spara position på `moveend`
I samma `doInit`, efter att du registrerat övriga listeners (`map.on('load', ...)`, `map.on('error', ...)` etc.), lägg till:

```ts
map.on('moveend', () => {
  if (cancelled) return;
  saveMapView(map);
});
```

(Obs: använd `moveend`, inte `zoomend`+`moveend` separat — `moveend` triggas efter båda.)

### 1.4 "Centrera Sverige"-knappen ska nolla sparat läge
Uppdatera befintlig `onClick` på centerknappen (rad ~843):

```ts
onClick={() => {
  mapRef.current?.flyTo({ center: SWEDEN_CENTER, zoom: SWEDEN_ZOOM });
  try { localStorage.removeItem(MAP_VIEW_KEY); } catch {}
}}
```

(Så att default-positionen blir ihågkommen som "användaren har återställt".)

### 1.5 Rensa sparat läge om det blir trasigt
Lägg till i `doInit` någonstans tidigt:

```ts
// Skydd: ogiltig JSON eller extremt avlägsna koordinater → rensa och fall tillbaka till default
const saved0 = loadSavedMapView();
if (saved0 === null && localStorage.getItem(MAP_VIEW_KEY)) {
  try { localStorage.removeItem(MAP_VIEW_KEY); } catch {}
}
```

---

## ÄNDRING 2 — Gör "?"-knappen tydlig i `src/pages/PlaceTurbines.tsx`

Hitta knappen runt rad 676 (det är den med `aria-label="Visa hjälp"` som öppnar `setShowOnboarding(true)`). Uppdatera så här:

**Före:**
```tsx
<button
  onClick={() => {
    localStorage.setItem(ONBOARDING_KEY, "");
    localStorage.removeItem(ONBOARDING_KEY);
    setShowOnboarding(true);
  }}
  className="rounded-full bg-white/10 px-3 py-1.5 text-sm text-white/60 hover:bg-white/20"
  aria-label="Visa hjälp"
>
  ?
</button>
```

**Efter:**
```tsx
<button
  onClick={() => {
    localStorage.setItem(ONBOARDING_KEY, "");
    localStorage.removeItem(ONBOARDING_KEY);
    setShowOnboarding(true);
  }}
  className="rounded-full bg-white/10 px-3 py-1.5 text-sm text-white/60 hover:bg-white/20"
  aria-label="Starta om guide"
  title="Starta om introduktionsguiden"
>
  ↻
</button>
```

(Obs: byter `?` till `↻` (reload-symbol) som visuellt antyder "starta om". VoiceOver läser nu "Starta om guide"-knappen. Hover-tooltip visar samma sak för web/desktop.)

---

## Verifiering

1. **Kartan minns position**:
   - Öppna appen, scrolla/zooma kartan till t.ex. Skåne-området.
   - Vänta ~1 sek efter pansning (så `moveend` hinner trigga och `saveMapView` köra).
   - Stäng appen helt (kill Capacitor-appen), öppna igen.
   - **Förväntat**: Kartan öppnas på samma lat/lng/zoom som du stängde på.
2. **"Centrera Sverige"-knappen nollar sparat läge**:
   - Efter ovanstående, klicka "Centrera Sverige"-knappen.
   - Stäng och öppna appen.
   - **Förväntat**: Default Sverige-översikt, inte den Skåne-position du nyss hade.
3. **"?"-knappen tydligare**:
   - Öppna editorn (något projekt), titta uppe till höger.
   - **Förväntat**: Symbolen är `↻` istället för `?`. VoiceOver säger "Starta om guide".
   - Klick öppnar fortfarande `onboarding`-modalen (introduktionsguiden) som tidigare.
4. **Inga regressioner**:
   - `flyTo` med `sverigekartanFocusNearest`-flaggan (V13) ska fortfarande auto-fokusera på närmaste projekt — vår `loadSavedMapView` körs EN GÅNG i `doInit` innan `flyTo` triggas i `useEffect` för focus-flaggan, så `flyTo` vinner.
   - Pinstorlek (V14), footer-padding (V14), `selectedProject`-stabilitet (V14), API-fetch-override (V15) — allt ska vara oförändrat.

## Loggning (valfritt, felsökning)
Vill du se sparningen i iOS-loggen kan du i `saveMapView` även logga:
```ts
console.log("[NationalMap] sparad vy", view);
```

---

## Leverans
- Ändra **bara** `src/components/NationalMapView.tsx` (ÄNDRING 1) och `src/pages/PlaceTurbines.tsx` (ÄNDRING 2).
- Inga nya filer. Inga nya beroenden.
- Verifiera med `npm run build` (eller Replits motsvarighet) att allt fortfarande kompilerar.
- Committa som `V16: karta minns position + tydligare guide-knapp`.
