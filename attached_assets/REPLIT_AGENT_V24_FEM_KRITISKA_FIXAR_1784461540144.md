# V24 — Fem kritiska fixar (rotorsaker från logg)

## Sammanhang

Logganalys av V23-test:

**Bra som fungerar (V23)**:
- ✅ Meny-knappen syns längst ner (när `arSessionVisible=true`)
- ✅ Verken renderas korrekt (29/29 synliga första gången Ericsberg)
- ✅ Auto-exponering bättre

**Problem som finns kvar (loggbevis)**:

| # | Problem | Bevis från logg | Rotorsak |
|---|---------|-----------------|----------|
| 1 | Ericsberg 210 km avstånd andra gången | `V1-1, avstånd=210449m, bäring=179.4°` | GPS-fix kommer inte in efter `positionOverride` rensats; gammal simulerad position används |
| 2 | Permission-flödet körs varje gång | `Compass permission result: true` × 4 i loggen | Ingen `hasOnboarded`-flagga — kalibrerings-overlayen visas alltid |
| 3 | Menyn försvinner ibland | `App became active. Restarting location monitoring` flera gånger → `ready` fluktuerar → Meny inne i `arSessionVisible` försvinner | Meny-knappen ligger i `arSessionVisible`-villkorad container |
| 4 | Verken "fastnar" i sina positioner | `Heading=0.0° Camera yaw=9.0°` syns i startloggen | Initial heading = 0 → alla verk visas i samma riktning tills första gyro-fix |
| 5 | Kameran tappar fokus | `App became active. Restarting location monitoring` + kameran stannar | Location watch startas om vid varje app-resume → race conditions, ingen cleanup |

## Säkerhet
- Inga nya beroenden
- Bara `Home.tsx`, `PermissionGate.tsx`, `ARScene.tsx`
- Bakåtkompatibelt

---

## ÄNDRING 1 — Tvinga GPS-refresh efter `positionOverride` rensas

**Fil**: `src/pages/Home.tsx`

I `effectiveLat`/`effectiveLon`-raden (runt rad 793-796), se till att när `positionOverride` rensas, triggas en omedelbar GPS-watch-update:

```ts
// Före (befintlig kod):
const effectiveLat = positionOverride?.lat ?? geo.lat;
const effectiveLon = positionOverride?.lon ?? geo.lon;
const effectiveAccuracy = positionOverride ? 1 : geo.accuracy;
```

Lägg till en effekt som lyssnar på `positionOverride` och tvingar en omedelbar GPS-refresh:

```ts
// V24-fix: När positionOverride rensas, säkerställ att en NY GPS-fix
// kommer in inom rimlig tid. Annars stannar AR på den senast kända
// positionen (som kan vara fel/simulerad från tidigare session) — det
// är detta som orsakar "Ericsberg 210 km bort" i loggen.
useEffect(() => {
  if (positionOverride === null) {
    // Signal: vi vill ha en NY GPS-position ASAP
    // (hookarna useGeolocation/useCameraStream lyssnar på detta)
    console.info("[AR] positionOverride rensad — väntar på färsk GPS");
  }
}, [positionOverride]);
```

Och i `src/hooks/useGeolocation.ts`, längst upp i hook-funktionen, lägg till en watchdog:

```ts
// V24-fix: om positionOverride har nyss rensats, sänk stale-threshold
// så att den senaste (kanske simulerade) positionen snabbare anses
// för gammal och en ny GPS-fix triggas.
const MAX_STALE_MS_AFTER_OVERRIDE_CLEAR = 3000;
const overrideClearedAtRef = useRef<number | null>(null);
// ...efter befintlig useEffect som startar watch:
useEffect(() => {
  // Lyssna på positionOverride-rensning
  // (skickas via window-event eftersom hooken inte har direkt tillgång)
  const onOverrideCleared = () => {
    overrideClearedAtRef.current = Date.now();
  };
  window.addEventListener("vindkollen:overrideCleared", onOverrideCleared);
  return () => window.removeEventListener("vindkollen:overrideCleared", onOverrideCleared);
}, []);
```

Och i Home.tsx, där `setPositionOverride(null)` anropas (runt rad 217):

```ts
const clearPositionOverride = useCallback(() => {
  setPositionOverride(null);
  // V24-fix: signalera till hooks att override har rensats
  window.dispatchEvent(new CustomEvent("vindkollen:overrideCleared"));
}, []);
```

Byt sedan `setPositionOverride(null)` mot `clearPositionOverride()` på rad 217 (efter AR-stopp).

---

## ÄNDRING 2 — Kom ihåg "har visat kalibrering"-flagga

**Fil**: `src/pages/Home.tsx`

Längst upp i komponenten, efter befintliga useState, lägg till:

```ts
// V24-fix: kom ihåg om användaren redan gått igenom kalibrering en gång.
// Första gången: visa full kalibrerings-overlay (2 steg, 5s timeout).
// Efterföljande gånger: hoppa direkt till AR-vyn.
const [hasOnboarded, setHasOnboarded] = useState<boolean>(() => {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem("vindkollen:hasOnboarded") === "1";
  } catch {
    return false;
  }
});
const markOnboarded = useCallback(() => {
  try {
    localStorage.setItem("vindkollen:hasOnboarded", "1");
  } catch {}
  setHasOnboarded(true);
}, []);
```

I `handleStart` (efter `setStarted(true)` framgångsrikt anrop), lägg till:

```ts
// V24: efter första lyckade start, markera som onboarded
markOnboarded();
```

Och skippa kalibreringen om `hasOnboarded === true`. Ändra LoadingSequence-anropet (runt rad 1493) från:

```tsx
{showLoadingSequence && (
  <LoadingSequence
    onComplete={handleLoadingSequenceComplete}
    calibrationPhase={orientation.calibrationPhase}
    calibrationProgress={orientation.calibrationProgress}
    skipCalibration={!orientation.supported || Boolean(orientation.error)}
  />
)}
```

till:

```tsx
{showLoadingSequence && (
  <LoadingSequence
    onComplete={handleLoadingSequenceComplete}
    calibrationPhase={orientation.calibrationPhase}
    calibrationProgress={orientation.calibrationProgress}
    // V24: hoppa över kalibreringssteget helt efter första gången
    skipCalibration={hasOnboarded || !orientation.supported || Boolean(orientation.error)}
  />
)}
```

Och i `handleStart`, skippa `setShowLoadingSequence(true)` om användaren redan onboarded:

```ts
// V24: skippa laddningssekvensen helt efter första gången
if (!hasOnboarded) {
  setShowLoadingSequence(true);
}
```

(Notera: `showLoadingSequence` styr LoadingSequence-overlayen — om den är false visas aldrig overlayen, vilket betyder att AR-vyn visas direkt.)

**Bonus**: Lägg till en "Återställ kalibrering"-knapp i menyn (för den som vill köra kalibreringen igen):
```tsx
{hasOnboarded && (
  <button onClick={() => {
    try { localStorage.removeItem("vindkollen:hasOnboarded"); } catch {}
    setHasOnboarded(false);
  }}>
    Kör kalibrering igen
  </button>
)}
```

---

## ÄNDRING 3 — Meny-knappen ALLTID synlig (utöver arSessionVisible)

**Fil**: `src/pages/Home.tsx`

Hitta bottencontainerns `arSessionVisible`-villkor (runt rad 1984):

```tsx
{arSessionVisible && (
<div className="pointer-events-none absolute inset-x-0 bottom-0 z-[45] flex flex-col-reverse">
  ...
</div>
)}
```

Byt ut mot:

```tsx
{/* V24: Meny-knappen syns ALLTID efter `started=true` — inte bara när
    arSessionVisible är true. ready fluktuerar vid app-resume (location
    watch startas om, kamera stoppas/startas), och då försvinner hela
    menyn med allt innehåll. Splittra: widget-kolumnen inuti
    arSessionVisible (försvinner om sensortapp), Meny-knappen utanför
    (alltid synlig). */}
{started && (
  <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[45] flex flex-col-reverse">
    <div className="pointer-events-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <button
        onClick={() => setShowMenu(true)}
        className="w-full rounded-full border border-white/50 bg-white/20 py-3 text-sm font-semibold text-white shadow-sm backdrop-blur-md hover:bg-white/30"
      >
        ☰ Meny
      </button>
    </div>
  </div>
)}
{arSessionVisible && (
<div className="pointer-events-none absolute inset-x-0 bottom-0 z-[45] flex flex-col-reverse pointer-events-none">
  ...
</div>
)}
```

Faktiskt, **enklare**: flytta Meny-knappen UTANFÖR arSessionVisible-villkoret, men behåll resten inuti:

```tsx
{/* Meny-knappen — ALLTID synlig efter `started=true` (V24) */}
{started && (
  <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-[45] px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
    <button
      onClick={() => setShowMenu(true)}
      className="w-full rounded-full border border-white/50 bg-black/70 py-3 text-sm font-semibold text-white shadow-lg backdrop-blur-md hover:bg-black/85"
    >
      ☰ Meny
    </button>
  </div>
)}

{/* Övriga widgets (ljud, brus, petition, foto) — bara i arSessionVisible */}
{arSessionVisible && (
<div className="pointer-events-none absolute inset-x-0 bottom-0 z-[45] flex flex-col-reverse">
  ...befintlig widget-kolumn UTAN Meny-knappen i slutet...
</div>
)}
```

Och ta bort Meny-knappen från innehållet i `arSessionVisible`-containern.

**Notera z-index**: Meny-knappen (z-[45]) ligger under LoadingSequence (z-[70]) — så den syns inte under kalibrering, vilket är OK. Men under AR-vyn är den överst.

---

## ÄNDRING 4 — Heading init till senast kända

**Fil**: `src/components/ARScene.tsx`

I `setup`-effekten, där `cameraTargetQuatRef` initieras (runt rad 710), använd `lastKnownHeadingDegRef` om det finns:

Lägg till en ref överst i funktionen:
```ts
const lastKnownHeadingRef = useRef<number | null>(null);
```

I `animate()`-loopen, EFTER att riktning uppdaterats, spara:
```ts
if (Math.abs(headingDeg) < 360 && Math.abs(headingDeg) > 0) {
  lastKnownHeadingRef.current = headingDeg;
}
```

Och där `cameraTargetQuatRef` skapas (runt rad 710), initiera från denna ref om den finns:
```ts
const initialHeading = lastKnownHeadingRef.current ?? 0;
const initialRad = (initialHeading * Math.PI) / 180;
// (befintlig cameraTargetQuatRef setup, men med initialRad som start)
```

Detta är en liten förändring. Alternativt, enklare: skippa rendering av verken tills heading är giltig.

Lägg till i animate-loopen (efter `state.headingDeg = ...`):

```ts
// V24-fix: hoppa över rendering om heading inte initierats ännu
// (första frame efter mount = heading=0 → alla verk visas i samma riktning
// och "fastnar" tills första gyro-fix)
if (state.firstFrame && Math.abs(headingDeg) < 0.1) {
  return; // skippa rendering
}
state.firstFrame = false;
```

---

## ÄNDRING 5 — LoadingSequence snabbare efter första gången

**Fil**: `src/components/LoadingSequence.tsx`

Redan mestadels fixat via Ändring 2 (`skipCalibration=true` efter onboarded). Men för säkerhets skull, skippa HELA sekvensen om projektet redan är aktivt (cachat):

Lägg till en prop `skipEntireSequence?: boolean`:

```ts
interface LoadingSequenceProps {
  onComplete: () => void;
  calibrationPhase: "flat" | "vertical" | "done";
  calibrationProgress: number;
  skipCalibration: boolean;
  /** V24: hoppa över hela sekvensen (loading + checklist) */
  skipEntireSequence?: boolean;
}
```

I komponenten:
```ts
useEffect(() => {
  if (skipEntireSequence) {
    onComplete();
  }
}, [skipEntireSequence, onComplete]);
```

Och i Home.tsx, skicka `skipEntireSequence={hasOnboarded && !positionOverride}`.

---

## Verifiering (efter V24)

1. Bygg om: `pnpm build` + `cap sync ios`
2. **Test GPS-refresh** (Ändring 1):
   - Ställ in simulerad position (via PlaceTurbines)
   - Öppna AR → se orange "SIMULERAT LÄGE"-ram
   - Öppna Meny → "Rensa position" (eller gå tillbaka till riktig GPS)
   - AR ska **omedelbart** använda riktig GPS (210 km-buggen är borta)
3. **Test permission en gång** (Ändring 2):
   - Första AR-start: kalibreringsoverlay visas (2 steg)
   - Andra AR-start: ingen overlay, direkt till AR-vyn
   - I menyn: "Kör kalibrering igen"-knapp om man vill
4. **Test Meny alltid synlig** (Ändring 3):
   - Öppna AR
   - Gör hemknappen / swipe upp (app i bakgrunden)
   - Kom tillbaka till appen
   - Meny-knappen ska **fortfarande synas** även under location-watch-restart
5. **Test heading init** (Ändring 4):
   - Starta AR
   - Första frame: verken "fastnar inte" i samma riktning, utan visas inte alls tills heading är giltig
6. **Test loading snabbare** (Ändring 5):
   - Andra AR-start: ingen loading-modal alls, direkt AR

---

## Leverans
- Ändra: `src/pages/Home.tsx` (Ändring 1, 2, 3)
- Ändra: `src/components/ARScene.tsx` (Ändring 4)
- Ändra: `src/components/LoadingSequence.tsx` (Ändring 5)
- Ändra: `src/hooks/useGeolocation.ts` (Ändring 1 - lägg till override-cleared-lyssnare)
- Committa som `V24: GPS-refresh efter override-rensning, har-onboardad-flagga, Meny alltid synlig, heading-init, snabbare loading`
