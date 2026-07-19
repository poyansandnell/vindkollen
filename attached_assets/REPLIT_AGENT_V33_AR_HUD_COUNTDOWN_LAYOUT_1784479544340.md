# Replit Agent-instruktioner: V33 — AR HUD sökhint, nedräkning, layout & gammalt chip-kontroll

## Sammanfattning
Gå in i `artifacts/vindkraft-ar-katrineholm/`. Fortsätt från V32 (`b07493c`). I `src/pages/Home.tsx` ska sökhinten flyttas upp, få en 30-sekunders nedräkning + progress-stapel, simulerings-badgen flyttas upp några pixlar, och botten-menyn få mer luft. Slutligen ska `pnpm native:build` köras och projektet verifieras så att gamla "vrid 89° / 3,2 km"-chipet inte längre finns kvar i någon bundle.

## Förberedelser
1. Säkerställ att du är i `artifacts/vindkraft-ar-katrineholm/`.
2. Kör:
   ```bash
   pnpm install
   pnpm run typecheck:libs   # om det finns workspace-bibliotek
   ```

## Ändringar i `src/pages/Home.tsx`

### 1. Byt sökhint från uppräkning till nedräkning 30 → 0 s
Ersätt den gamla `searchElapsedSec`-logiken vid rad 550-ish med följande:

```tsx
const SEARCH_HINT_TIMEOUT_SEC = 30;
const [searchRemainingSec, setSearchRemainingSec] = useState(SEARCH_HINT_TIMEOUT_SEC);
const searchEmptySinceRef = useRef<number | null>(null);
useEffect(() => {
  if (!arSessionVisible || arStartedAtMs === null || inFrontOfCameraCount > 0) {
    searchEmptySinceRef.current = null;
    setSearchRemainingSec(SEARCH_HINT_TIMEOUT_SEC);
    return;
  }
  if (searchEmptySinceRef.current === null) {
    searchEmptySinceRef.current = Date.now();
  }
  const tick = () => {
    const elapsedMs = Date.now() - searchEmptySinceRef.current!;
    const remaining = Math.max(0, SEARCH_HINT_TIMEOUT_SEC - Math.floor(elapsedMs / 1000));
    setSearchRemainingSec(remaining);
  };
  tick();
  const id = window.setInterval(tick, 250);
  return () => window.clearInterval(id);
}, [arSessionVisible, arStartedAtMs, inFrontOfCameraCount]);
```

Varje gång `inFrontOfCameraCount` blir 0 startar nedräkningen om från 30 s. Så fort ett verk hamnar i FOV återställs den till 30 s.

### 2. Gör sökhinten synlig ovanför `NearestTurbineArrow`
Hitta overlay-blocket som visas när `arSessionVisible && arStartedAtMs !== null && inFrontOfCameraCount === 0`. Ersätt det med:

```tsx
<div
  className="pointer-events-none absolute inset-x-0 z-[55] flex justify-center px-6"
  aria-live="polite"
  style={{ top: "max(120px, 22vh)" }}
>
  <div className="max-w-xs rounded-2xl border border-white/20 bg-black/55 px-5 py-3 text-center shadow-2xl backdrop-blur-md">
    <p className="text-sm font-semibold text-white">
      🔍 Hittar vindkraftverken…
    </p>
    <p className="mt-0.5 text-xs text-white/70">
      {searchRemainingSec}s kvar — peka kameran runt
    </p>
    <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/20">
      <div
        className="h-full bg-[#FF8B01] transition-all duration-300 ease-linear"
        style={{ width: `${(searchRemainingSec / SEARCH_HINT_TIMEOUT_SEC) * 100}%` }}
      />
    </div>
  </div>
</div>
```

Viktigt: använd `z-[55]` så det ligger över NearestTurbineArrow (z-50). Placeringen `top: max(120px, 22vh)` ser till att boxen inte flyter bakom höger-pilen.

### 3. Flytta upp simulerings-badgen
Hitta `"📍 SIMULERAT LÄGE"`-badgen (rad ~1605). Ändra dess `top`-stil:

```tsx
style={{ top: "max(2px, env(safe-area-inset-top, 4px))" }}
```

Kommentera gärna: "// V33: flyttat upp några pixlar så det inte överlappar övrig text."

### 4. Ge botten-menyn mer luft
Hitta yttre gradient-container för bottenkontrollerna (rad ~2090). Byt padding:

```tsx
pb-[max(4.5rem,calc(env(safe-area-inset-bottom)+1.25rem))]
```

Hitta meny-bladet (rad ~2165). Byt padding:

```tsx
pb-[max(3.5rem,env(safe-area-inset-bottom))]
```

### 5. (Redan gjort i V32, kontrollera) `NearestTurbineArrow` ska vara enda avståndspill
Sök i `src/` efter texten `km — vrid`, `vrid 89`, `nearestFarTurbine` eller liknande. Det ska inte finnas något gammalt "3,2 km — vrid 89°"-chip. Om du hittar något, ta bort det — men rör INTE `forceVisibleIds`- eller frustum-koden (`NEAR_CENTER_FORCE_DEG`, `forceVisible`, `cachedMeshes`, etc.).

## Bygg & verifiera
1. Kör typcheck:
   ```bash
   pnpm tsc --noEmit
   ```
2. Kör native build:
   ```bash
   pnpm native:build
   ```
3. Kontrollera att det gamla chipet inte läckt in i nya bundle:
   ```bash
   rg -n "3\.2 km|vrid 89|km — vrid" dist-native/assets/*.js
   # förväntat: inga träffar (exit 1)
   ```
4. Kontrollera att nya strängar finns:
   ```bash
   rg -n "Hittar vindkraftverken|s kvar" dist-native/assets/*.js
   # förväntat: träffar
   ```
5. Kör eventuella tester:
   ```bash
   pnpm test       # om det finns
   pnpm lint       # om det finns
   ```

## Commit
Committa endast V33-relevanta filer:

```bash
git add artifacts/vindkraft-ar-katrineholm/src/pages/Home.tsx
git add -A artifacts/vindkraft-ar-katrineholm/dist-native/
git commit -m "V33: höjd sökhint, 30s nedräkning+progress, sim-badge upp, mer botten-padding"
```

Lämna övriga dirty-filer (`capacitor.config.ts`, `index.html`, `src/index.css`, `src/pages/PlaceTurbines.tsx`, `pnpm-lock.yaml`, etc.) orörda eftersom de tillhör andra features/buggar.

## Test på enhet / simulator
- Meny-knappen och meny-bladet ska inte längre se avklippta ut nertill.
- Sökhinten ska synas ovanför höger-pilen när inga verk är i FOV.
- När AR öppnas utan verk i sikte ska nedräkningen gå 30 → 0 s; när du pekar mot ett verk ska den återgå till 30 s.
- Simulerings-badgen ska inte överlappa annan text.
- Det ska inte finnas något litet "3,2 km — vrid ..."-chip ovanpå / bredvid `NearestTurbineArrow`.

## Notering
Referensobjekt i simuleringsläge (Eiffeltornet, Turning Torso, Titanic, etc.) ska INTE göras i V33; lägg det åt sidan som en separat mini-MVP (V34).
