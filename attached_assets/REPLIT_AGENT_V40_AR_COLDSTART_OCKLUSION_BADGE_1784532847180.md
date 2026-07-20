# V40 – Replit Agent-instruktioner

Två kvarvarande punkter efter V39 (lampa OK):

1. **AR öppnas → “Hittar vindkraftverken… 0 s kvar” + tom himmel**
2. **“Fri sikt”-badgen klipps bort** i toppstatusraden

## Problem (enhet)

- Screenshot: AR igång, GPS/Kompass/AR-stabilitet syns, sökhint **0 s**, **inga verk**.
- “Fri sikt” saknas / kapas i toppen (notch + fyra badges i en rad med `overflow-x-auto` utan tydlig scroll).

## Rotorsaker

### A) Kallstartstimern bränns / nollställs fel (`arStartedAtMs`)

Kedjan som ska ge **5 s “Direkt AR”** (`WORLD_LOCK_BLEND_MS`) beror på `arStartedAtMs` i `ARScene`:

- `worldLockBlend = 0` → **ingen ocklusion**, full opacitet (verk får **inte** gömmas bakom träd/byggnad/himmlsklassning).
- `worldLockBlend → 1` över 5 s → mjuk övergång till normal ocklusion.

**Buggen:**

1. Vid `hasOnboarded` sattes `arStartedAtMs = Date.now()` i `handleStart` **direkt vid knappen**.
2. En effect nollställde den så fort `!arSessionVisible` (sensorer/loading inte klara).
3. När vyn äntligen blev synlig var `arStartedAtMs === null` → `ARScene` tolkar det som **redan world-locked** (`blend = 1`) → **ingen kallstartsboost**, ocklusion/sky kan dämpa allt till “tom himmel”, sökhint räkna ner till 0.

### B) Permanent “force alla verk” + open-sky-override i riktig AR

I `Home.tsx` ARScene-props fanns dirty overrides:

- `forceVisibleIds={alla IDs}`
- `isPointSky={() => true}`, ocklusionsgrid `fill(1)`
- `globalVisibilityFactor={1}`, `hideAll={false}`

Det gav “alltid forceVisible”, men **V35 left presence-fade** efter `worldLockBlend >= 1`: off-axis → `viewPresence ≈ 0` → opacity ≈ 0. Kallstarten (A) var redan slut → **inga verk**.

Kalibreringsfallbacken (närmaste 3) måste **behålla full presence** så länge den är aktiv – inte bara de första 5 s.

### C) Badgerad klipper “Fri sikt”

`flex-nowrap` + `overflow-x-auto` + fyra `whitespace-nowrap`-badges → sista badgen hamnar utanför notch/bredd utan att användaren ser att man kan scrolla.

---

## Lösning (produktregel)

> **Första ~5 sekunderna i AR: göm aldrig verk bakom ocklusion/hinder.**  
> Starta den 5 s-timern **först när AR-canvasen faktiskt är synlig**.  
> Efter 5 s: normal ocklusion + vinkelfade.  
> Om fortfarande 0 synliga: nearest-3 safety force med **full opacity** tills något är riktigt synligt.

---

## Kodbas

`artifacts/vindkraft-ar-katrineholm/`  
Ändra bara filerna nedan. Rör **inte** V39 light-tip (`LIGHT_TOP_OFFSET_M` / `heightMeters`).

---

## Fil 1: `src/pages/Home.tsx`

### 1.1 `arStartedAtMs` – starta när vyn syns, nollställ bara vid exit

**Ersätt** hela arStartedAtMs-blocket (state + effect) med:

```tsx
  // V40: sätts FÖRST när arSessionVisible blir sant (sensorer klara +
  // AR-vy på skärmen). Nollställs bara när started blir false.
  const [arStartedAtMs, setArStartedAtMs] = useState<number | null>(null);
  useEffect(() => {
    if (!started) {
      setArStartedAtMs(null);
      return;
    }
    if (arSessionVisible) {
      setArStartedAtMs((prev) => prev ?? Date.now());
    }
  }, [arSessionVisible, started]);
```

### 1.2 Ta bort setArStartedAtMs från `handleStart` (hasOnboarded)

```tsx
    if (hasOnboarded) {
      console.log("[AR] hasOnboarded=true — hoppar över LoadingSequence");
      // V40: arStartedAtMs sätts av effecten när arSessionVisible=true
      setShowArStartToast(true);
      setTimeout(() => setShowArStartToast(false), 1500);
    } else {
      setShowLoadingSequence(true);
    }
```

### 1.3 Ta bort setArStartedAtMs från `handleLoadingSequenceComplete`

```tsx
  const handleLoadingSequenceComplete = useCallback(() => {
    setShowLoadingSequence(false);
    // V40: arStartedAtMs via arSessionVisible-effecten
    markOnboarded();
  }, [markOnboarded]);
```

### 1.4 Fallback delay 0 ms

```tsx
  const CALIBRATION_FALLBACK_TURBINE_COUNT = 3;
  const CALIBRATION_FALLBACK_DELAY_MS = 0; // V40: omedelbart, inte 800 ms
```

### 1.5 Återställ ARScene-props (sim = open sky, riktig AR = riktig ocklusion)

Hitta ARScene som används i vanlig AR (`ref={arSceneRef}`) och sätt:

```tsx
            isPointSky={positionOverride !== null ? () => true : sky.isPointSky}
            getOcclusionGrid={
              positionOverride !== null
                ? () => new Float32Array(GRID_COLS * GRID_ROWS).fill(1)
                : sky.getOcclusionGrid
            }
            showHiddenTurbines={showHiddenTurbines}
            globalVisibilityFactor={positionOverride !== null ? 1 : globalVisibilityFactor}
            hideAll={positionOverride !== null ? false : indoorsOrNoSight}
            forceVisibleIds={
              positionOverride !== null
                ? new Set(activeTurbines.map((t) => t.id))
                : forceVisibleIds
            }
```

**Viktigt:** I riktig AR ska `forceVisibleIds` vara **kalibreringsfallbackens set** (närmaste 3), inte alla motor-IDs. Sim/positionOverride får fortfarande force-all + open sky.

### 1.6 Statusrad – wrappa badges

```tsx
            {showStatusDetails && (
              <div className="flex flex-wrap items-center gap-1 text-[10px]">
                <GpsQualityBadge ... />
                <CompassStabilityBadge ... />
                <ArStabilityBadge ... />
                <LineOfSightStatus ... />
              </div>
            )}
```

Ta bort `flex-nowrap` och `overflow-x-auto`.

---

## Fil 2: `src/components/ARScene.tsx`

### 2.1 Full presence för safety-forced (inte bara under 5 s)

I `applyFinalOpacities`:

```tsx
      const isSafetyForced = modeRef.current.forceVisibleIds.has(obj.turbine.id);
      const forceVisibleCold =
        isSafetyForced || (obj.forceVisible && worldLockBlendRef.current < 1);
      const effectivePresence = forceVisibleCold ? 1 : presence;
```

**Varför:** närmaste-3-fallback ska synas **även efter** world lock, annars dör den när presence → 0 off-axis.

### 2.2 forceDraw alltid för safety-forced

I `animate()`:

```tsx
        const isSafetyForced = modeRef.current.forceVisibleIds.has(obj.turbine.id);
        obj.forceVisible =
          (nearCenter && obj.renderDistM <= MAX_RENDER_DISTANCE_M) || isSafetyForced;
        const forceDraw =
          obj.forceVisible &&
          (isSafetyForced || viewPresence > 0.02 || worldLockBlendRef.current < 1);
```

### 2.3 (redan finns – rör inte) shader-ocklusion under kallstart

```glsl
float occlusionAlphaFactor = mix(OCCLUSION_MIN_ALPHA, 1.0, visMask);
gl_FragColor.a *= mix(1.0, occlusionAlphaFactor, uWorldLockBlend);
```

När `uWorldLockBlend = 0` (första sekunderna): **multipliceras alpha med 1.0** → **ingen ocklusionsdämpning**. Det är “göm inte bakom saker första sekunder”.

Se till att `arStartedAtMs` sätts rätt i Home, annars är blend alltid 1 och denna grej nås aldrig.

### 2.4 Skugga: safety-forced full

```tsx
        const shadowGlobalFactor = obj.forceVisible
          ? (modeRef.current.forceVisibleIds.has(obj.turbine.id)
              ? 1
              : Math.min(1, Math.max(0, obj.viewPresence)))
          : modeRef.current.hideAll
            ? INDOOR_DIM_FACTOR
            : Math.max(modeRef.current.globalVisibilityFactor, MIN_CONFIDENCE_VISIBILITY_FACTOR);
```

---

## Filer 3–6: kompaktare badges

I alla fyra:

- `src/components/GpsQualityBadge.tsx`
- `src/components/CompassStabilityBadge.tsx`
- `src/components/ArStabilityBadge.tsx`
- `src/components/LineOfSightStatus.tsx`

Byt padding/storlek:

```tsx
// från
whitespace-nowrap rounded-full px-2.5 py-1 text-[11px]
// till
whitespace-nowrap rounded-full px-2 py-0.5 text-[10px]
```

I `ArStabilityBadge.tsx` kortare etikett:

```tsx
AR: {percent}%
// istället för "AR-stabilitet: {percent}%"
```

---

## Verifiering

```bash
cd artifacts/vindkraft-ar-katrineholm
npx tsc --noEmit
```

Ska vara clean.

### Manuell checklista (enhet)

1. Öppna AR (efter onboarding) → inom **1 s** ska minst närmaste verk (fallback) synas, **inte** tom himmel + “0 s kvar”.
2. Första **~5 s**: verk ska **inte** döljas bakom träd/byggnad (Direkt AR / worldLockBlend=0).
3. Efter ~5 s: mjuk övergång till normal ocklusion + vinkelfade.
4. Statusrad: **Fri sikt** syns (rad wraps 2×2 om det behövs).
5. Simulerad position: fortfarande force-all + open sky (oförändrat beteende).
6. Natt: lampa fortfarande **högst upp** (V39 orörd).

---

## Commit (endast dessa filer)

```bash
git add \
  artifacts/vindkraft-ar-katrineholm/src/pages/Home.tsx \
  artifacts/vindkraft-ar-katrineholm/src/components/ARScene.tsx \
  artifacts/vindkraft-ar-katrineholm/src/components/GpsQualityBadge.tsx \
  artifacts/vindkraft-ar-katrineholm/src/components/CompassStabilityBadge.tsx \
  artifacts/vindkraft-ar-katrineholm/src/components/ArStabilityBadge.tsx \
  artifacts/vindkraft-ar-katrineholm/src/components/LineOfSightStatus.tsx

git commit -m "V40: fix AR cold-start timer, keep turbines unoccluded first 5s, unclip Fri sikt badge"
```

Committeda **inte** `REPLIT_AGENT_*.md`.

---

## Förväntat resultat

| Före | Efter |
|------|--------|
| AR öppnas → 0 s sök, tom himmel | Verk (minst nearest-3) direkt när canvas syns |
| Ocklusion döljer allt från frame 1 om blend redan = 1 | Första 5 s: ingen ocklusionsdämpning |
| force-all + presence=0 efter blend | force-all bara i sim; safety force = nearest 3 med full presence |
| Fri sikt kapas | Wrap + kortare “AR: N%” |

## Obs / rör inte

- V27/V29/V30/V32 frustum/start-kärna om det inte behövs.
- V39 light `heightMeters` / `LIGHT_TOP_OFFSET_M`.
- Lämna `WORLD_LOCK_BLEND_MS = 5000` (5 s Direkt AR). Vill man längre kan man höja till 8000 senare – inte nödvändigt för V40.
