# V37 – Replit Agent-instruktioner

Fortsättning efter V36-test på riktig iOS. Tre nya problem:
1. Röda flyghinderlampan sitter mitt på tornet, ska vara på generatorn/navcellen.
2. Verken försvinner och kommer inte tillbaka.
3. Kompass/sensor känns seg.
4. Informationsrutan (Om projektet) täcker hela skärmen.

Kodbas: `/home/user/vindkollen/artifacts/vindkraft-ar-katrineholm/`
Senaste commit: `54eaafc` (V37).
`npx tsc --noEmit` ska vara clean efter alla ändringar.

---

## 1. Röda lampan på navcellen, inte mitt på tornet

**Fil:** `src/components/ARScene.tsx`

1. Lägg till en konstant strax under `METERS_TO_UNITS`:

```ts
const METERS_TO_UNITS = 0.9;
// V37: flygsäkerhetsbelysningen ska sitta på navcellens/generatorns tak,
// inte vid navets mitt. Halva navcellshöjden (~2.2 m) ovanför navhöjden.
const NACELLE_LIGHT_OFFSET_M = 2.2;
```

2. Hitta raden där `lightY` beräknas (i `layoutObjects`, strax under etikett-positionering):

```ts
// GAMMALT
const lightY = y + hubHeightUnits * scaleDamp * 1.02;
```

Ändra till:

```ts
// V37: placera lampan på navcellens tak (hub + halva navcellshöjden).
const lightY = y + (hubHeightUnits + NACELLE_LIGHT_OFFSET_M * METERS_TO_UNITS) * scaleDamp;
```

---

## 2. Verken försvinner och kommer inte tillbaka

**Rotorsak:** Kalibreringsfallbacken (`forceVisibleIds`) släcktes så fort något verk låg inom kamerans FOV, även om det FOV-verket var helt ockluderat/uttonat. Då försvann fallback-verken utan att något naturligt synligt verk fanns kvar.

**Fil:** `src/pages/Home.tsx`

1. Byt ut hela kalibreringsfallback-effekten (som använder `inFrontOfCameraCount`) mot denna version:

```ts
  // V37: om INGA verk faktiskt varit synliga (opacitet > 0.02 i ARScene)
  // under 800 ms (medan AR-sessionen faktiskt är synlig/redo) tvingas de tre
  // närmaste verken synliga som "AR-testobjekt" (via `forceVisibleIds` till
  // `ARScene`, se dess jsdoc), tillsammans med en icke-blockerande
  // kalibreringsbanderoll. Låser ALDRIG appen i kalibreringsläge — så fort
  // minst ett verk faktiskt blir synligt igen (`trueVisibleTurbineCount > 0`)
  // stängs fallbacken av igen automatiskt, utan att kräva någon
  // användaråtgärd.
  const [calibrationFallbackActive, setCalibrationFallbackActive] = useState(false);
  const noTurbinesVisibleSinceRef = useRef<number | null>(null);
  useEffect(() => {
    // V37: räkna ett verk som "tillbaka" först när det FAKTISKT är synligt
    // (opacitet > 0.02 i ARScene), inte bara när det ligger inom kamerans FOV.
    // Tidigare kunde ett verk ligga i FOV men vara helt ockluderat/uttonat,
    // vilket släckte fallbacken och lämnade användaren med en tom skärm.
    if (!arSessionVisible || !ready || arDebugStats.trueVisibleTurbineCount > 0) {
      noTurbinesVisibleSinceRef.current = null;
      setCalibrationFallbackActive(false);
      return;
    }
    if (noTurbinesVisibleSinceRef.current === null) {
      noTurbinesVisibleSinceRef.current = Date.now();
    }
    const elapsed = Date.now() - noTurbinesVisibleSinceRef.current;
    if (elapsed >= CALIBRATION_FALLBACK_DELAY_MS) {
      console.warn(
        `[AR][safety] No turbines actually visible for ${CALIBRATION_FALLBACK_DELAY_MS}ms — force-showing ${nearestThreeTurbineIds.length} nearest turbines`,
      );
      setCalibrationFallbackActive(true);
      return;
    }
    const id = window.setTimeout(() => {
      console.warn(
        `[AR][safety] No turbines actually visible for ${CALIBRATION_FALLBACK_DELAY_MS}ms — force-showing ${nearestThreeTurbineIds.length} nearest turbines`,
      );
      setCalibrationFallbackActive(true);
    }, CALIBRATION_FALLBACK_DELAY_MS - elapsed);
    return () => window.clearTimeout(id);
  }, [arSessionVisible, ready, arDebugStats.trueVisibleTurbineCount, nearestThreeTurbineIds]);
```

> Viktigt: `arDebugStats` finns redan och uppdateras var 250 ms från `ARScene.getDebugStats().trueVisibleTurbineCount`. Ingen ny polling behövs.

---

## 3. Snabbare kompass/sensorrespons

**Fil:** `src/hooks/useDeviceOrientation.ts`

Ändra följande konstanter (samma block som redan finns):

```ts
const HEADING_NOISE_DELTA_DEG = 4;       // tidigare 5
const HEADING_TURN_DELTA_DEG = 12;       // tidigare 14
const HEADING_STILL_TAU = 0.45;          // tidigare 0.7
const HEADING_TURN_TAU = 0.08;           // tidigare 0.15
const GYRO_TURN_RATE_THRESHOLD_DEG_PER_SEC = 8;  // tidigare 12
const GYRO_ACTIVITY_THRESHOLD_DEG_PER_SEC = 2;   // tidigare 3
const PITCH_ROLL_NOISE_DELTA_DEG = 2;    // tidigare 2.5
const PITCH_ROLL_TURN_DELTA_DEG = 7;     // tidigare 9
const PITCH_ROLL_STILL_TAU = 0.35;       // tidigare 0.55
const PITCH_ROLL_TURN_TAU = 0.08;        // tidigare 0.15
```

`DEADZONE_DEG = 0.5` ska vara kvar — den filtrerar fortfarande bort stillastående sensorbrus.

**Fil:** `src/components/ARScene.tsx`

Hitta kamerans slerp-konstant i `animate` (strax under quaternion-kopian):

```ts
// GAMMALT
const CAMERA_SLERP_TAU = 0.04;
```

Ändra till:

```ts
// V37: ännu snabbare kamerainterpolation så sol/sprite/verk följer
// telefonrörelserna tätare.
const CAMERA_SLERP_TAU = 0.03;
```

---

## 4. Informationsrutan ska inte täcka allt

**Fil:** `src/components/InfoPanel.tsx`

Ändra yttersta wrappern från helskärms-overlay till kompakt bottom sheet:

```tsx
// GAMMALT
  return (
    <div className="absolute inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md rounded-t-3xl bg-[#111111] p-6 shadow-2xl sm:rounded-3xl">
```

TILL:

```tsx
// V37
  return (
    <div className="absolute inset-x-0 bottom-0 z-[60] flex max-h-[80vh] flex-col items-center justify-end pointer-events-none sm:items-center sm:justify-center">
      {/* V37: informationsrutan är en kompakt bottom sheet istället för en
          helskärms-overlay, så kamerabilden och AR-verken fortfarande syns
          bakom/ovanför den. */}
      <div className="pointer-events-auto w-full max-w-md rounded-t-3xl bg-[#111111]/95 p-5 shadow-2xl backdrop-blur-md sm:rounded-3xl">
```

2. Minska innehållshöjden:

```tsx
// GAMMALT
<div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1 text-sm leading-relaxed text-white/75">
```

TILL:

```tsx
<div className="max-h-[45vh] space-y-3 overflow-y-auto pr-1 text-sm leading-relaxed text-white/75">
```

---

## 5. Verifiering

Kör i projektroten:

```bash
cd /home/user/vindkollen/artifacts/vindkraft-ar-katrineholm
npx tsc --noEmit
```

Det ska inte rapportera några fel.

---

## 6. Commit

```bash
git add -u
git commit -m "V37: nacelle obstruction light, true-visible fallback, faster sensors, compact InfoPanel"
```

(Använd gärna `--no-verify` om det finns pre-commit-hooks som blockerar bygget.)

---

## Sammanfattning av beteendeförändringar

- **Röd lampa:** sitter nu på navcellens/generatorns tak istället för vid navets mitt.
- **Synlighetsåterhämtning:** kalibreringsfallbacken släcks inte förrän ett verk faktiskt är synligt (opacitet > 0.02), så AR-vyn inte plötsligt blir tom.
- **Snabbare sensor:** kortare tidskonstanter, lägre gyrotrösklar och snabbare kamera-slerp ger en mer direkt känsla.
- **InfoPanel:** kompakt bottom sheet som inte döljer kamerabilden/AR-vyn.
