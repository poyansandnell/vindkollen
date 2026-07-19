# V27 — Fyra rotorsaker: V24+V26-ändringar som faktiskt appliceras + checklist tillbaka

## Diagnos från V26-testloggen

Loggen bekräftar rotorsaken direkt:

```
⚡️  [log] - [AR] Start button pressed
⚡️  [log] - [AR] All permissions granted, waiting 400 ms before starting services
⚡️  [log] - [AR] 400 ms elapsed, checking compass permission. needsPermission: true
⚡️  [log] - [AR] Requesting compass permission
⚡️  [log] - [AR] Compass permission result: true
⚡️  [log] - [AR] Starting compass (startCalibrationTracking)
⚡️  [log] - [AR] Navigating to AR scene (setStarted true)
⚡️  [info] - [AR][pipeline] Sensorfusion aktiv (gyroskop + kompass)   ← händer FÖRE LoadingSequence hinner börja
```

Mellan `setShowLoadingSequence(true)` (rad 1261) och `setStarted(true)` (rad ~1309) hinner **400 ms + kompass-behörighetsförfrågan** gå. När `started` blir true är kompassen redan klar → `orientation.calibrationPhase === "done"` direkt → LoadingSequence hoppar förbi kalibrerings-/nedräknings-fasen och bränner igenom checklistans 7 bockar på 7×220 ms ≈ 1.5 s. Användaren ser bara en **snabb blinkning** av checklistan, inte den "snygga starten".

V24 + V26-ändringarna var aldrig applicerade i koden:
- `Home.tsx:252` har fortfarande `useState(() => positionOverride !== null)` (V25-buggen)
- `ARScene.tsx` saknar `smoothedYawDegRef`/`isValidYaw` (V25 NaN-buggen)
- `LoadingSequence.tsx` saknar `skipEntireSequence` prop (V24-flagga)
- `Home.tsx` saknar `hasOnboarded` localStorage (V24-flagga)

Loggbevis att V24+V26-ändringarna inte är på plats:
```
$ grep "hasOnboarded" src/pages/Home.tsx → 0 träffar
$ grep "smoothedYawDegRef" src/components/ARScene.tsx → 0 träffar
$ grep "useState(false)" src/pages/Home.tsx → useState(false) finns för *andra* state, men INTE för `started`
```

## Användarens önskemål (V24 + V27)

- "den snygga starten med alla bockar som bockas i" ska **vara kvar första gången**
- Efterföljande gånger: hoppa över kalibrering/checklista, gå direkt till AR
- "verken fram snabbt" ska fortsätta fungera (inga 241 km)

## Säkerhet
- Inga nya beroenden
- Bara `Home.tsx`, `ARScene.tsx`, `LoadingSequence.tsx`
- Bakåtkompatibelt med redan deployad V23-build

---

## ÄNDRING 1 — `started` börjar alltid `false` (V26-ändring, om appliceras korrekt)

**Fil**: `src/pages/Home.tsx`

Rad 252:

**Före:**
```ts
const [started, setStarted] = useState(() => positionOverride !== null);
```

**Efter:**
```ts
// V26+V27: Alltid false vid mount. PlaceTurbines-handoff sparar sin data
// (turbines, position) i sessionStorage, men användaren måste alltid
// gå via PermissionGate. Detta är enklare, säkrare och matchar
// användarens krav "PermissionGate ska visas varje gång".
const [started, setStarted] = useState(false);
```

---

## ÄNDRING 2 — `hasOnboarded` localStorage-flagga (V24-ändring, om appliceras korrekt)

**Fil**: `src/pages/Home.tsx`

Lägg till efter rad 253 (efter `setStarting`):

```ts
// V24+V27: Kom ihåg om användaren redan gått igenom kalibrerings/checklist-fasen
// en gång. Första gången: visa LoadingSequence med "snygga starten".
// Efterföljande gånger: hoppa direkt till AR.
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
  } catch {
    /* ignore */
  }
  setHasOnboarded(true);
}, []);
const resetOnboarding = useCallback(() => {
  try {
    localStorage.removeItem("vindkollen:hasOnboarded");
  } catch {
    /* ignore */
  }
  setHasOnboarded(false);
}, []);
```

I `handleStart` (efter `setStarted(true)` i `finish()`-funktionen), lägg till:

```ts
const finish = () => {
  console.log("[AR] Starting compass (startCalibrationTracking)");
  orientation.startCalibrationTracking();
  console.log("[AR] Navigating to AR scene (setStarted true)");
  setStarted(true);
  setStarting(false);
  // V24+V27: Första gången vi går igenom detta → markera som onboarded
  // (detta är ett engångs-anrop som skriver localStorage-flagga)
  markOnboarded();
};
```

Och längst upp i `handleStart`, **efter** `setStarting(true)` och `setNativePermError(null)`, men **före** permissions-loop, lägg till:

```ts
// V24+V27: Visa LoadingSequence (med checklista) ENDAST första gången.
// Efterföljande app-starter: hoppa över hela LoadingSequence → AR startar direkt.
if (hasOnboarded) {
  console.log("[AR] hasOnboarded=true — hoppar över LoadingSequence");
} else {
  setShowLoadingSequence(true);
}
```

(Och ta bort den befintliga `setShowLoadingSequence(true);` på rad 1261 — ersätts av ovanstående `if/else`.)

---

## ÄNDRING 3 — `skipEntireSequence` prop på LoadingSequence (V24-ändring, om appliceras korrekt)

**Fil**: `src/components/LoadingSequence.tsx`

Uppdatera `LoadingSequenceProps`-interfacet (rad 4-19):

```ts
interface LoadingSequenceProps {
  onComplete: () => void;
  /** Vilket kalibreringssteg som just nu pågår (se `useDeviceOrientation.ts`). */
  calibrationPhase: "flat" | "vertical" | "done";
  /** 0..1 — hur stor del av det AKTUELLA stegets riktningssektorer som redan svepts. */
  calibrationProgress: number;
  /**
   * Sant om kompasskalibrering inte kan genomföras alls (t.ex.
   * `DeviceOrientationEvent` saknas, eller behörigheten nekades) — då hoppar
   * sekvensen förbi kalibreringssteget helt och går direkt till
   * nedräkningen.
   */
  skipCalibration: boolean;
  /**
   * V24+V27: Om true, hoppar över HELA sekvensen och anropar
   * `onComplete` direkt nästa frame. Används när användaren redan
   * har gått igenom kalibrering/checklista en gång (sparat i
   * localStorage som `vindkollen:hasOnboarded`).
   */
  skipEntireSequence?: boolean;
}
```

Längst upp i `LoadingSequence`-komponenten (direkt efter `useState`-deklarationerna, rad 116-122), lägg till en tidig `useEffect`:

```ts
// V24+V27: Om skipEntireSequence är satt, hoppa över hela animationen
// och anropa onComplete direkt. Användaren har redan gått igenom detta.
useEffect(() => {
  if (skipEntireSequence) {
    console.log("[LoadingSequence] skipEntireSequence=true — hoppar till onComplete direkt");
    // Mindre fördröjning så React hinner rendera första frame
    const id = window.setTimeout(onComplete, 50);
    return () => window.clearTimeout(id);
  }
  return undefined;
}, [skipEntireSequence, onComplete]);
```

**VIKTIGT**: om `skipEntireSequence=true` ska komponenten rendera TOM (eller inte alls). Uppdatera `return` (rad 183):

```ts
// V24+V27: Om vi hoppar över hela sekvensen, returnera null
// (LoadingSequence-anroparen styr om det överhuvudtaget ska renderas)
if (skipEntireSequence) {
  return null;
}

return (
  <div className="fixed inset-0 z-[70] ...">
    ...
  </div>
);
```

---

## ÄNDRING 4 — `useGeolocation` NaN-skydd (V26-ändring, om appliceras korrekt)

**Fil**: `src/components/ARScene.tsx`

Lokalisera koden som sätter `state.camera.quaternion.setFromEuler(sensorEuler)` (sök efter `setFromEuler` — bör vara runt rad 1650-1700). Lägg till NaN-skydd precis innan:

```ts
// V26+V27: NaN-skydd för sensorns euler-vinklar. Om `sensorEuler.y`
// är NaN/Infinity (vilket kan hända vid sensorfel, t.ex. första frame
// innan kompassen hinner initialiseras), SKA vi INTE applicera
// quaternion-rotationen — det ger NaN-korruption som gör att alla
// 3D-objekt renderas på fel position (t.ex. 241 km bort).
const isValidNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

if (
  isValidNumber(sensorEuler.x) &&
  isValidNumber(sensorEuler.y) &&
  isValidNumber(sensorEuler.z)
) {
  state.camera.quaternion.setFromEuler(sensorEuler);
} else {
  // Fallback: behåll föregående quaternion (gör inget)
  // Logga en gång per session, sedan tyst
  if (typeof window !== "undefined" && !(window as any).__nanGuardLogged) {
    console.warn("[ARScene] sensorEuler innehåller NaN/Infinity — hoppar över quaternion-set denna frame");
    (window as any).__nanGuardLogged = true;
  }
}
```

Och i slutet av sensor-loopen (efter quaternion-set), rensa `__nanGuardLogged` när vi ser en giltig frame:

```ts
// V27: om vi ser en giltig frame efter NaN, tillåt framtida loggning igen
if (
  isValidNumber(sensorEuler.x) &&
  isValidNumber(sensorEuler.y) &&
  isValidNumber(sensorEuler.z)
) {
  if (typeof window !== "undefined") {
    (window as any).__nanGuardLogged = false;
  }
}
```

---

## ÄNDRING 5 — Koppla `skipEntireSequence` i Home.tsx

**Fil**: `src/pages/Home.tsx`

Uppdatera `<LoadingSequence>`-anropet (rad 1493-1500):

**Före:**
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

**Efter:**
```tsx
{showLoadingSequence && (
  <LoadingSequence
    onComplete={handleLoadingSequenceComplete}
    calibrationPhase={orientation.calibrationPhase}
    calibrationProgress={orientation.calibrationProgress}
    skipCalibration={!orientation.supported || Boolean(orientation.error)}
    // V24+V27: hoppar över hela sekvensen efter första gången
    skipEntireSequence={hasOnboarded}
  />
)}
```

(Obs: `hasOnboarded` är true EFTER `markOnboarded()` har anropats en gång, vilket sker i `finish()` efter `setStarted(true)`. Så första gången mountas LoadingSequence med `skipEntireSequence=false` (default), och kör normalt. Andra gången är `hasOnboarded=true` redan vid mount, så `skipEntireSequence=true` → LoadingSequence returnerar `null` direkt och `onComplete` anropas efter 50 ms.)

---

## Verifiering (efter V27)

1. Bygg om: `pnpm build` + `cap sync ios`
2. **Test "snygga starten" första gången**:
   - Rensa localStorage: i Safari DevTools Console kör
     `localStorage.removeItem("vindkollen:hasOnboarded")`
   - Starta AR → LoadingSequence VISAS med:
     1. 📱-spinnande "Kalibrera kompassen" (1-2 s)
     2. 📍/🛰️/🌍 nedräkning 3-2-1 (3 s)
     3. ✅✅✅✅✅✅✅ checklista med 7 bockar (1.5 s)
   - Total tid: ~5-6 s innan AR-vyn syns
3. **Test "snabb start" efterföljande gånger**:
   - Döda appen helt
   - Öppna appen igen → LoadingSequence visas INTE
   - Direkt till AR-vyn (PermissionGate → Starta AR → direkt AR)
   - Logg visar: `[AR] hasOnboarded=true — hoppar över LoadingSequence`
     och `[LoadingSequence] skipEntireSequence=true — hoppar till onComplete direkt`
4. **Test V26 NaN-skydd**:
   - Logg visar INTE `Modell placerad (V1, avstånd=241081m, ...)`
   - Verken placerade på rimliga avstånd (1-15 km från Katrineholm)
   - Om loggen visar `[ARScene] sensorEuler innehåller NaN/Infinity` →
     det är skyddet som aktiveras, vilket är BRA (förut skulle detta
     resultera i 241 km-fel)
5. **Test PermissionGate visas alltid**:
   - Döda appen → öppna → PermissionGate visas
   - Logg visar `Start button pressed` (INTE `Renderer attached` direkt efter `WebView loaded`)

---

## Leverans
- Ändra: `src/pages/Home.tsx` (Ändring 1, 2, 5)
- Ändra: `src/components/LoadingSequence.tsx` (Ändring 3)
- Ändra: `src/components/ARScene.tsx` (ÄNDRING 4)
- Committa som `V27: Fyra rotorsaker — V24+V26 applicerade korrekt, checklist tillbaka första gången, NaN-skydd i ARScene`
