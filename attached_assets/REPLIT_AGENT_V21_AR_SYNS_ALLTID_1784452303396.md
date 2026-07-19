# V21 — Verk syns ALLTID i riktig AR (även inomhus, även utan himmel)

## Kontext
V20 fungerar i simulator, men i verklig AR syns inga verk alls. Användaren förväntar sig att "fall ner från himlen"-animationen + räknaren visas, men inget händer.

**Diagnos (utan loggar — be användaren skicka loggar om detta inte fixar)**:

| Möjlig orsak | Vad som händer |
|---------------|----------------|
| `indoorsOrNoSight` blir `true` | `hideAll={true}` → alla verkens opacity = 0, ingen animation syns |
| `isPointSky` returnerar `false` för hela bilden | per-pixel-ocklusionsshadern döljer allt |
| `onTurbineLanded` callback är inte kopplad | animation-logiken kör men UI-räknaren visas aldrig |
| `globalVisibilityFactor` blir låg | t.ex. 0.6 → verk tonade men inte dolda |
| `turbinesVisible={false}` | produkttogglen är av |
| `forceVisibleIds` är tomt Set | ingen fallback för att tvinga synlighet |

**Produktkrav (juli 2026)**: Verken ska ALLTID synas i AR, oavsett vad himmelsheuristiken säger. Användaren har explicit öppnat projektet och tryckt "Se i AR" — det är en avsiktlig handling. Inomhus-ocklusionen är en "försiktighetsspärr" som inte får göra appen oanvändbar.

## Säkerhet
- Inga nya beroenden
- Bara Home.tsx + ev. ARScene.tsx
- Befintlig V18+V19+V20-pipeline fortsätter att fungera

---

## ÄNDRING 1 — Tvinga synlighet i riktig AR (Home.tsx)

`src/pages/Home.tsx`

Hitta där `<ARScene>` monteras (runt rad 1563-1580). Uppdatera prop-värdena:

**Före** (runt rad 1573-1580):
```tsx
<ARScene
  isPointSky={sky.isPointSky}
  getOcclusionGrid={sky.getOcclusionGrid}
  globalVisibilityFactor={globalVisibilityFactor}
  hideAll={positionOverride !== null ? false : indoorsOrNoSight}
  ...
/>
```

**Efter** (VIKTIGT — verken syns ALLTID):
```tsx
<ARScene
  isPointSky={() => true}  // ← riktig AR: inga "himmel"-tester, allt är fritt
  getOcclusionGrid={() => new Float32Array(GRID_COLS * GRID_ROWS).fill(1)}  // ← 1 = fullt synlig
  globalVisibilityFactor={1}  // ← ingen dämpning
  hideAll={false}  // ← ALDRIG dölj, oavsett inomhus-detektion
  forceVisibleIds={new Set(activeTurbines.map(t => t.id))}  // ← alla verk tvingas synliga
  ...
/>
```

(Vi behåller fortfarande positionOverride-loggik för simulator där vi redan sätter `isPointSky={() => true}`, men vi utökar nu till RIKTIG AR också.)

**ELLER**, om vi vill ha kvar ocklusion för framtida förbättringar (rekommenderas), gör följande:

Skapa en toggle i `lib/visualizationTypes.ts`:

```ts
// Lägg till i SunMode-typen (eller som ny export):
export type OcclusionMode = "full" | "soft" | "off";

export const DEFAULT_OCCLUSION_MODE: OcclusionMode = "soft";
```

Och i `Home.tsx`, använd:

```tsx
<ARScene
  isPointSky={
    positionOverride !== null ? () => true :
    occlusionMode === "off" ? () => true :
    occlusionMode === "soft" ? () => true :  // soft = allt synligt, ingen dämpning
    sky.isPointSky  // full = riktig ocklusion (framtida)
  }
  getOcclusionGrid={
    positionOverride !== null || occlusionMode !== "full" 
      ? () => new Float32Array(GRID_COLS * GRID_ROWS).fill(1)
      : sky.getOcclusionGrid
  }
  globalVisibilityFactor={positionOverride !== null || occlusionMode !== "full" ? 1 : globalVisibilityFactor}
  hideAll={false}  // ALDRIG dölj
  forceVisibleIds={new Set(activeTurbines.map(t => t.id))}
  ...
/>
```

**För snabb fix**: välj den första varianten (alltid `() => true`, `hideAll={false}`). Det tar bort alla ocklusionsproblem och appen blir användbar.

---

## ÄNDRING 2 — Verifiera att fall-animationen triggas (ARScene.tsx)

`src/components/ARScene.tsx`

Kolla i `setup`-effekten (runt rad 800-1100) att animationen startas:

1. **`animationStartMs` sätts** när verken skapas (inte vid mount)
2. **Verk har `userData.fallStartY` sparat** OCH `userData.baseY` sparat
3. **`animate()`-loopen läser `animationStartMs`** och flyttar verken

Hitta var `state.objects = turbines.map(...)` sker. Efter den slingan, lägg till:

```ts
// V20/V21: Starta fall-animation — verken "regnar" ner från himlen
const FALL_HEIGHT_M = 200;
let animStartMs: number | null = null;
for (const obj of state.objects) {
  obj.userData = obj.userData ?? {};
  obj.userData.baseY = obj.group.position.y; // spara slutposition
  obj.userData.fallStartY = obj.group.position.y + FALL_HEIGHT_M; // start 200m ovanför
}
```

Och i `animate()`, EFTER `layoutObjects()` (rad ~1451):

```ts
// V20/V21: Fall-animation (1.5s ease-out cubic)
const ANIMATION_DURATION_MS = 1500;
if (animStartMs === null) animStartMs = performance.now();
const elapsedMs = performance.now() - animStartMs;
if (elapsedMs < ANIMATION_DURATION_MS) {
  const t = elapsedMs / ANIMATION_DURATION_MS;
  const eased = 1 - Math.pow(1 - t, 3);
  for (const obj of state.objects) {
    const startY = obj.userData?.fallStartY;
    const targetY = obj.userData?.baseY;
    if (startY != null && targetY != null) {
      obj.group.position.y = startY + (targetY - startY) * eased;
    }
  }
  // Räknare: X / N på plats
  const landed = Math.floor(state.objects.length * eased);
  if (modeRef.current.onTurbineLanded) {
    modeRef.current.onTurbineLanded(landed, state.objects.length);
  }
}
```

Lägg till i `modeRef` (runt rad 610-625):

```ts
onTurbineLanded: undefined, // sätts via useEffect
```

Och i `useEffect` (eller i samma `setup`-effekt), synka prop → ref:

```ts
onTurbineLandedRef.current = onTurbineLanded;
```

Och lägg till prop i `ARSceneProps`:

```ts
onTurbineLanded?: (landed: number, total: number) => void;
```

---

## ÄNDRING 3 — Visa räknaren i Home.tsx (redan delvis gjord i V20)

`src/pages/Home.tsx`

Kolla att UI:n visar räknaren. Sök efter `turbineLandedCount` och verifiera:

```tsx
{turbineLandedCount && turbineLandedCount.landed < turbineLandedCount.total && (
  <div className="pointer-events-none absolute left-1/2 top-1/3 z-[52] -translate-x-1/2 rounded-2xl bg-black/80 px-6 py-4 text-center text-white shadow-2xl">
    <div className="text-4xl">🌬️</div>
    <div className="mt-2 text-lg font-semibold">
      {turbineLandedCount.landed} / {turbineLandedCount.total} verk på plats
    </div>
    <div className="mt-1 text-xs text-white/40">Peka kameran runt</div>
  </div>
)}
```

Och att callback är kopplad på `<ARScene>`:

```tsx
<ARScene
  ...
  onTurbineLanded={(landed, total) => {
    setTurbineLandedCount({ landed, total });
  }}
  ...
/>
```

---

## Verifiering

1. **Bygg om** med `PORT=5173 pnpm build` + `cap sync ios`
2. **Riktig AR inomhus** — Starta appen → PermissionGate → klicka "Starta" → vänta på GPS/kompass → AR visas → **alla 7+ verk syns OMEDELBART** och faller från ovan
3. **Räknare** — "0 / 7 verk på plats" → "3 / 7" → "5 / 7" → "7 / 7" på ~1.5 sekunder
4. **Inomhus, dimma, mörker** — alla synliga oavsett vad himmelsdetektionen säger
5. **"Dölj verk"-knappen** fungerar fortfarande (om användaren vill dölja)

---

## Felsökning om det INTE fungerar

Lägg till i `animate()` EFTER fall-animationen:

```ts
console.info(`[AR][pipeline] Frame ${frameCountRef.current}: ${state.objects.length} obj, hideAll=${modeRef.current.hideAll}, anim elapsed=${elapsedMs.toFixed(0)}ms`);
```

Den ska logga `hideAll=false`. Om `hideAll=true` är problemet i Ändring 1 inte applicerat.

Och för ocklusion:

```ts
console.info(`[AR][pipeline] visMask range: ${state.objects.map(o => o.visMask).join(",")}`);
```

Om alla `visMask = 0` → ocklusionen döljer. Men med `getOcclusionGrid={() => new Float32Array(...).fill(1)}` ska alla vara 1.

---

## Leverans
- Ändra: `src/pages/Home.tsx` (Ändring 1, 3)
- Ändra: `src/components/ARScene.tsx` (Ändring 2)
- Inga nya filer
- Committa som `V21: verk syns alltid i riktig AR (ingen ocklusion) + fall-animation fixad`.
