# V20 — Slutfixar efter V19-fälttest

## Kontext
V19 fungerar! Verken är raka, simulatorn är snabb, ljudet är på. Men 5 UX-issues kvarstår från fälttest på iPhone:

1. **"Utanför Ericsbergs marker"-varning** — Felmeddelandet i editorn ("Ett eller flera verk står utanför Ericsbergs marker") ska bort helt, det stör mer än det hjälper.
2. **Verk försvinner i simulator** — Användaren ser verken, vrider telefonen, plötsligt försvinner alla. Tryck på skärm → de kommer tillbaka. Detta beror på `indoorsOrNoSight` som triggas av sensortrendering.
3. **AR startar om från PermissionGate** — Från redigering → "Se i AR" → användaren ska INTE behöva gå genom PermissionGate igen, AR ska starta direkt.
4. **Verk dyker upp utan animation** — Användaren vill ha en "fall ner från himlen"-animation där verken dalar in på rätt plats med en räknare ("7/29 på plats").
5. **Redigering scrollbar** — På mobilen kan man scrolla i editorn, ska vara låst till skärmstorlek.

---

## ÄNDRING 1 — Ta bort "Utanför Ericsbergs marker"-varningen

`src/pages/PlaceTurbines.tsx`

Hitta varningen som renderas som:
```tsx
⚠️ "Hoppsan! Ett eller flera verk står utanför Ericsbergs marker. Dra tillbaka dem inom gränsen."
```

Den är en villkorlig render baserad på `turbinesOutsideBoundary` eller liknande state. **Ta bort hela det blocket** (eller wrappa det i en dev-flagga `import.meta.env.DEV` om det är ett felsökningsverktyg).

Sök med:
```bash
grep -n "Utanför Ericsbergs\|utanför.*marker\|turbinesOutsideBoundary" src/pages/PlaceTurbines.tsx
```

Och ta bort den returnerade JSX. Behåll beräkningen om den används någon annanstans.

---

## ÄNDRING 2 — Verk som försvinner i simulator (kraftfull forceVisible)

`src/components/ARScene.tsx` + `src/pages/Home.tsx`

**Diagnos**: `indoorsOrNoSight` blir `true` även i simulerat läge (sensortrenderingen kan tro att man är inomhus). Verken döljs då. När man trycker på skärmen triggas en re-render som slår om flaggan.

**Fix**: Tvinga ALLA verk i simulerat läge att vara synliga, oavsett vad `indoorsOrNoSight` eller himmelsdetektion säger.

I `Home.tsx`, hitta där `forceVisibleIds` skickas till `<ARScene>`:

```tsx
<ARScene
  forceVisibleIds={positionOverride !== null ? new Set(turbines.map(t => t.id)) : forceVisibleIds}
  ...
/>
```

(Obs: `turbines` är propsen som skickas till ARScene — använd samma lista.)

Och se till att `hideAll` är `false` i simulerat läge (redan gjort i V19, men verifiera):

```tsx
hideAll={positionOverride !== null ? false : indoorsOrNoSight}
```

---

## ÄNDRING 3 — Skippa PermissionGate vid AR-start från editorn

`src/pages/Home.tsx`

**Diagnos**: När användaren är i `PlaceTurbines` och klickar "Se i AR", monteras `<ARScene>` och PermissionGate visas först. Användaren har redan gett behörigheter — vi vill starta direkt.

**Fix**: Hitta `PermissionGate`-villkoret (`{!started && (...)}`) och skippa det om vi har en handoff:

```tsx
{!started && !editHandoff && (
  <PermissionGate ... />
)}
```

Och se till att `setStarted(true)` redan är satt om vi har handoff. Kolla `useState(() => positionOverride !== null)` på rad 253 — utöka det:

```ts
const [started, setStarted] = useState(() => positionOverride !== null || /* handoff-detektering */);
```

Om det inte räcker, använd `useEffect` som sätter `setStarted(true)` direkt vid mount om `editHandoff` finns.

---

## ÄNDRING 4 — "Fall ner från himlen"-animation + räknare

`src/components/ARScene.tsx`

**Mål**: När AR startar (eller när verk skapas), animera verken så de "faller" från 200m ovanför sin slutposition ner till marken med easing. Visa en räknare "X / N på plats".

### 4.1 Lägg till animation-state

I `setup`-effekten, efter att verken skapats, initiera animation:

```ts
const animationStartMs = performance.now();
const ANIMATION_DURATION_MS = 1500; // 1.5s
const FALL_HEIGHT_M = 200; // start 200m ovanför

// För varje turbine, spara startpositionen:
for (const obj of state.objects) {
  obj.userData = obj.userData ?? {};
  obj.userData.fallStartY = obj.group.position.y + FALL_HEIGHT_M;
  obj.group.position.y = obj.userData.fallStartY;
}
```

### 4.2 Uppdatera position i animate-loopen

I `animate()`, efter `layoutObjects()` (eller i `applyFinalOpacities`):

```ts
const elapsedMs = performance.now() - animationStartMs;
if (elapsedMs < ANIMATION_DURATION_MS) {
  const t = elapsedMs / ANIMATION_DURATION_MS;
  // Easing: ease-out (cubic) — snabb i början, långsam i slutet
  const eased = 1 - Math.pow(1 - t, 3);
  for (const obj of state.objects) {
    const startY = obj.userData?.fallStartY ?? 0;
    const targetY = obj.baseY ?? 0; // spara baspositionen
    obj.group.position.y = startY + (targetY - startY) * eased;
  }
} else if (!animationComplete) {
  // Första gången vi når slutposition: logga och sätt flagga
  animationComplete = true;
  console.info("[AR][pipeline] Alla verk på plats efter", ANIMATION_DURATION_MS, "ms");
}
```

### 4.3 Räknare "X av N på plats"

Lägg till en ref som räknar antal verk som nått slutposition:

```ts
let turbinesLandedCount = 0;
let turbinesLandedReported = false;

// I animate(), uppdatera baserat på elapsed:
const t = elapsedMs / ANIMATION_DURATION_MS;
const eased = 1 - Math.pow(1 - t, 3);
const landedCount = Math.floor(state.objects.length * eased);
if (landedCount !== turbinesLandedCount) {
  turbinesLandedCount = landedCount;
  modeRef.current.onTurbineLanded?.(landedCount, state.objects.length);
}
```

Lägg till callback-prop i `ARSceneProps`:

```ts
/**
 * V20: Callback som anropas varje gång antalet "på plats"-verk ändras
 * under ingångs-animationen. Används för att visa räknare "X / N på
 * plats" i Home.tsx-overlayen.
 */
onTurbineLanded?: (landed: number, total: number) => void;
```

### 4.4 I Home.tsx — visa räknare under startsekvensen

Lägg till state:

```ts
const [turbineLandedCount, setTurbineLandedCount] = useState<{ landed: number; total: number } | null>(null);
```

Skicka callback till ARScene:

```tsx
<ARScene
  onTurbineLanded={(landed, total) => setTurbineLandedCount({ landed, total })}
  ...
/>
```

Visa i UI under startsekvensen (ersätt den befintliga "Hittar vindkraftverken…" eller kombinera):

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

Och stäng av den gamla "Hittar vindkraftverken… Xs"-räknaren om den finns kvar (eller behåll den som en parallell räknare).

---

## ÄNDRING 5 — Lås redigeringsskärmen till skärmstorlek

`src/pages/PlaceTurbines.tsx`

Hitta rot-diven (oftast `<div className="flex h-screen ...">` eller liknande) och säkerställ:

```tsx
<div className="flex h-[100dvh] w-screen flex-col overflow-hidden">
```

- `h-[100dvh]` — Dynamic Viewport Height (hanterar iOS Safari-bar)
- `w-screen` — full bredd
- `overflow-hidden` — INGEN scroll på root-nivå
- `flex-col` — stapla vertikalt

Och inuti, om det finns en scrollbar-sektion, ge den explicit `overflow-y-auto` och en max-höjd så scrollen INTE pushar hela layouten.

---

## Verifiering

1. **Ingen "Utanför Ericsbergs marker"** — Editorn visar aldrig det felmeddelandet
2. **Verk består i simulator** — Simulator-läge, vrid telefonen → verken försvinner INTE (även efter 10 sekunder)
3. **Direkt AR från editor** — Editor → "Se i AR" → AR startar UTAN PermissionGate, ingen orange "SIMULERAT LÄGE"-text initialt (eller texten är mindre)
4. **Fall-animation** — AR startar → "3 / 29 verk på plats" → räknar upp till "29 / 29 verk på plats" på 1.5s
5. **Låst editor** — Redigeringsskärmen scrollar INTE på mobilen, allt syns inom 100dvh

---

## Leverans
- Ändra: `src/pages/PlaceTurbines.tsx` (Ändring 1, 5)
- Ändra: `src/pages/Home.tsx` (Ändring 2, 3, 4 — UI)
- Ändra: `src/components/ARScene.tsx` (Ändring 2, 4 — animation)
- Inga nya filer
- Committa som `V20: ta bort boundary-varning, fäst verk i sim, skippa gate, fall-animation, lås editor`.
