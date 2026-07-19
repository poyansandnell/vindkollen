# V25 — Tre rotorsaker: simulatorläge-fastlåsning, kompass-tapp vid rotation, badge-störning

## Sammanhang från V24-test (bilder + logg)

**Tre rotorsaker som tillsammans skapar den "hängiga" upplevelsen:**

| # | Problem | Bildbevis | Rotorsak |
|---|---------|-----------|----------|
| 1 | **Simulerat läge fastnar** | Orange "📍 SIMULERAT LÄGE" + "Simulerad position 61.1453°N 15.3678°E" kvar trots "Rensa"-tryck | V24 Ändring 1 skickade eventet, men `useGeolocation` har en inbyggd stale-threshold på 30s — den senaste (kanske redan stale) positionen anses fortfarande färsk nog. Behöver en **aggressivare** watch-restart, inte bara en retry-token |
| 2 | **Verken "tappar positioner" vid snabb vridning** | Verken är på plats → vrid kraftigt → verken hamnar "snett" eller verkar frysa → vrid tillbaka → de "hoppar" | `headingDegRef.current` uppdateras rå från sensorn. Vid snabb rotation överskrids CoreMotion's sample-rate (~50Hz) → frame-skip → discrete hopp. Vi behöver **smooth interpolation** av heading samt ett "spårlås" när sensorn ger inkonsistenta värden |
| 3 | **"Ruta högst upp stör"** (bild 1) | Orange "3.2 km till närmaste verk — vrid dig 258°" + "Närmaste verk 487 m — Vrid mobilen åt detta håll" syns BÅDA samtidigt → tar onödig plats + överlappar "SIMULERAT LÄGE"-badge | V22 lade till `nearestFarTurbine`-badge högst upp, men den visas alltid + duplicerar informationen med `nearestTurbineInfo`-pilen nere till höger |

## Säkerhet
- Inga nya beroenden
- Bara `useGeolocation.ts`, `ARScene.tsx`, `Home.tsx`
- Bakåtkompatibelt

---

## ÄNDRING 1 — Aggressiv GPS-restart vid positionOverride-rensning

**Fil**: `src/hooks/useGeolocation.ts`

Problemet med V24 Ändring 1: vi ökade bara `retryToken`, men hooken har fortfarande en intern stale-check som accepterar senaste positionen.

**Fix**: Vid `vindkollen:overrideCleared`, **nollställ `lastFix` och tvinga ny fetch**.

Hitta hookens `useState<GeoPosition | null>(null)` (eller vad den heter) för senaste position. Lägg till en `resetRef` och gör så att eventet nollställer den:

```ts
// V25: en "reset trigger" som hooken själv kan använda för att
// omedelbart glömma senaste positionen och kräva en NY GPS-fix.
const [resetTrigger, setResetTrigger] = useState(0);

// I useEffect som startar watch:
useEffect(() => {
  if (!enabled) return;
  // ... befintlig start av watch
  return () => { /* stop */ };
}, [enabled, resetTrigger]);  // <-- V25: lägg till resetTrigger som dep
```

Och lägg till en listener för eventet:

```ts
// V25-fix: lyssna på override-rensning och tvinga watch-restart
useEffect(() => {
  const handler = () => {
    console.info("[useGeolocation] overrideCleared → resetTrigger++");
    setResetTrigger((t) => t + 1);
  };
  window.addEventListener("vindkollen:overrideCleared", handler);
  return () => window.removeEventListener("vindkollen:overrideCleared", handler);
}, []);
```

**Varför detta fixar "fastnar"**: när `resetTrigger` ökar → useEffect med dep `[enabled, resetTrigger]` startar om hela watch-omslaget → `geolocation.clearWatch` → `geolocation.watchPosition` med nytt ID. Även om sista positionen var från simuleringsläget och är stale, **glöms den nu bort och ny GPS-fix krävs**.

**Och** i Home.tsx, se till att `positionOverride` faktiskt blir `null` OCH att fönstret event triggas (V24 borde redan ha detta, men verifiera).

---

## ÄNDRING 2 — Smooth heading interpolation i ARScene

**Fil**: `src/components/ARScene.tsx`

Lägg till en ref som håller smoothad heading, och interpolera mot rå heading i animate-loopen:

```ts
// V25: smooth heading för att förhindra "tapp"-hopp vid snabb rotation.
// Rå heading från CoreMotion uppdateras diskret (~50Hz sample rate),
// vilket ger synliga hopp vid snabba rörelser. Vi smoothar mot rå-värdet
// med exponential moving average.
const smoothedHeadingRef = useRef<number | null>(null);
const HEADING_SMOOTHING_ALPHA = 0.35; // 0 = ingen smooth, 1 = ingen rörelse alls
```

I `animate()`, där `headingDeg` beräknas från quaternion (eller från headingDegRef), lägg till smoothing:

```ts
// Hitta stället där headingDeg är satt, t.ex.:
// const headingDeg = ...;  // rå heading från sensorn

if (headingDeg !== null) {
  if (smoothedHeadingRef.current === null) {
    smoothedHeadingRef.current = headingDeg;
  } else {
    // Hantera wrap-around (359° → 1° ska gå via 0°, inte via 358°)
    let delta = headingDeg - smoothedHeadingRef.current;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    smoothedHeadingRef.current += delta * HEADING_SMOOTHING_ALPHA;
    // Normalisera till 0-360
    smoothedHeadingRef.current = ((smoothedHeadingRef.current % 360) + 360) % 360;
  }
}
const effectiveHeading = smoothedHeadingRef.current ?? headingDeg ?? 0;
```

Och **viktigt**: skippa denna smoothing om användaren uttryckligen stängt av (t.ex. via dev-flagga), men default = på.

**Varför detta fixar "tapp-positioner"**: istället för att hoppa direkt till nya heading, interpolerar vi 35% av vägen mot målet varje frame. Vid 60Hz blir det ~5 frames att nå 90% av målet — snabbt nog att kännas responsivt, men jämnt nog att inte hoppa.

---

## ÄNDRING 3 — Dölj/dupplicera inte "3.2 km"-badge med pil

**Fil**: `src/pages/Home.tsx`

V22 lade till denna badge:
```tsx
{nearestFarTurbine && (
  <div className="pointer-events-none absolute left-1/2 top-24 z-30 -translate-x-1/2 rounded-full border border-[#FF8B01]/40 bg-black/80 px-4 py-2 text-sm text-white shadow-lg">
    <div className="flex items-center gap-2">
      <svg ... style={{ transform: `rotate(${nearestFarTurbine.bearing}deg)` }}>...</svg>
      <span><strong>...</strong> bort — vrid dig {Math.round(nearestFarTurbine.bearing)}°</span>
    </div>
  </div>
)}
```

**Problem**: Den tar stor plats, överlappar titeln, och DUPLICERAR informationen med `nearestTurbineInfo`-pilen (nere till höger). I bilden ser vi båda samtidigt.

**Fix**: Visa bara en av dem åt gången. Antingen:
- (a) Visa bara "3.2 km"-badget om det INGET verk är inom synligt område just nu (dvs pilen till höger är inaktiv)
- (b) Visa bara pilen (nere till höger) alltid, ta bort badget helt

Jag rekommenderar **(a)**, eftersom badget är användbar första gången (man vet inte vart man ska vrida sig), men efter att man börjat vrida sig tar piltagaren över.

```tsx
{/* V25: visa "3.2 km"-badget BARA om inget verk syns i FOV just nu.
    Annars är piltagaren (nere till höger) tillräcklig. */}
{!nearestOnTarget && nearestFarTurbine && (
  <div className="pointer-events-none absolute left-1/2 top-24 z-30 -translate-x-1/2 rounded-full border border-[#FF8B01]/40 bg-black/80 px-4 py-2 text-sm text-white shadow-lg">
    <div className="flex items-center gap-2">
      <svg ... style={{ transform: `rotate(${nearestFarTurbine.bearing}deg)` }}>...</svg>
      <span><strong>{Math.round(nearestFarTurbine.distanceM / 100) / 10} km</strong> bort — vrid dig {Math.round(nearestFarTurbine.bearing)}°</span>
    </div>
  </div>
)}
```

**Bonus**: gör badget lite mer kompakt och lättare att ignorera:

```tsx
{!nearestOnTarget && nearestFarTurbine && (
  <div className="pointer-events-none absolute left-1/2 top-24 z-30 -translate-x-1/2 rounded-full border border-[#FF8B01]/30 bg-black/60 px-3 py-1.5 text-xs text-white/85 shadow-md">
    <span className="flex items-center gap-1.5">
      <svg width="14" height="14" ... style={{ transform: `rotate(${nearestFarTurbine.bearing}deg)` }}>...</svg>
      <strong className="font-semibold text-white">{Math.round(nearestFarTurbine.distanceM / 100) / 10} km</strong>
      <span className="text-white/60">— vrid {Math.round(nearestFarTurbine.bearing)}°</span>
    </span>
  </div>
)}
```

---

## Verifiering (efter V25)

1. Bygg om: `pnpm build` + `cap sync ios`
2. **Test simulerat-läge-fastlåsning** (Ändring 1):
   - Ställ in simulerad position via PlaceTurbines
   - Öppna AR → orange "SIMULERAT LÄGE"-ram
   - Klicka "Rensa" (eller "Tillbaka till startskärmen" om det är samma väg)
   - **`useGeolocation` startar om watch OMEDELBART** → logg visar `[useGeolocation] overrideCleared → resetTrigger++`
   - Inom 1-3s kommer riktig GPS-position
3. **Test smooth heading** (Ändring 2):
   - Stå stilla → alla verk stabila
   - Vrid telefonen snabbt 90° åt vänster → verken följer **mjukt** (inte diskret hopp)
   - Vrid tillbaka → verken följer mjukt
4. **Test badge-dedup** (Ändring 3):
   - Med riktig position, långt från verken → "X km bort — vrid dig Y°"-badge syns högst upp
   - Vrid mot verken → "✓ Du tittar mot närmaste verk" i grönt → 3.2 km-badge försvinner
   - Vrid bort från verken → 3.2 km-badge kommer tillbaka

---

## Leverans
- Ändra: `src/hooks/useGeolocation.ts` (Ändring 1)
- Ändra: `src/components/ARScene.tsx` (Ändring 2)
- Ändra: `src/pages/Home.tsx` (Ändring 3)
- Committa som `V25: aggressiv GPS-restart vid override-cleared, smooth heading interpolation, dedup av riktningsbadge`
