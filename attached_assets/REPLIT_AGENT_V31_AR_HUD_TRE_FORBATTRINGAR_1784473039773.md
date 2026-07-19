# V31 — AR-HUD: tre förbättringar (sökhint, dedupe, prioritetsordning)

**Commit:** `5ae7c09`
**Filer ändrade:** `src/pages/Home.tsx` (enda filen; +85 / −21 rader)

## Bakgrund & syfte

Efter V30 (`e90d41b`, "auto-trigger handleStart när positionOverride är satt") fungerar AR-starten korrekt i både simulerat och GPS-läge — användaren möter numera AR-vyn direkt utan att behöva trycka "Starta visualisering". Tre kvarstående UX-buggar rapporterade av användaren:

1. **"Skulle behöva en nedräkn när man går in i AR-versionen direkt men man ser inga vindkraftverk, typ från 30 sek neråt tills man ser verk"** — utan visuell feedback under de ~20-25 sekunder pipeline tar att hitta verken första gången.
2. **"Det är dubbla info om avstånd va? Eller nästan trippla"** — samma avstånd till närmaste verk visas på 2-3 ställen i AR-vyn.
3. **"Gula fältet som kan komma angående svag kompass eller position skulle nog behöva var ovanför den blåa rutan där nere istället"** — gul varning hamnar under blå simulerad position-pill i botten-baren.

V31 fixar alla tre i samma commit eftersom de delar samma fil (Home.tsx) och samma review-ytor (AR-HUD + botten-bar).

## Konkreta ändringar

### Ändring 1 — `searchElapsedSec`-state + tick-effekt (Home.tsx ~rad 532-560)

Ny state-variabel och en `useEffect` som uppdaterar den varje sekund:

```ts
// V31 (produktkrav, ny omgång): live-sekundräknare som visar hur länge
// användaren stirrat på en tom AR-vy i väntan på att verken ska bli
// synliga. ...
const [searchElapsedSec, setSearchElapsedSec] = useState(0);
useEffect(() => {
  // Bara ticka när AR är synlig OCH inget verk ännu räknats synligt —
  // så fort verken visats sig ska räknaren FÖRSVINNA (inte fortsätta i
  // bakgrunden och blinka upp igen om användaren tittar bort).
  if (!arSessionVisible || arStartedAtMs === null) {
    setSearchElapsedSec(0);
    return;
  }
  if (arDebugStats.trueVisibleTurbineCount > 0) {
    setSearchElapsedSec(0);
    return;
  }
  const tick = () => {
    setSearchElapsedSec(Math.floor((Date.now() - arStartedAtMs) / 1000));
  };
  tick();
  const id = window.setInterval(tick, 1000);
  return () => window.clearInterval(id);
}, [arSessionVisible, arStartedAtMs, arDebugStats.trueVisibleTurbineCount]);
```

**Viktigt:** `arStartedAtMs` är redan satt när LoadingSequence stänger (se V27/V30-kommentarer) — så timern räknar från det ögonblick användaren ser AR-vyn, inte från GPS-fix. Det är exakt vad vi vill ha.

### Ändring 2 — `TurbineSearchHint`-överlägg (Home.tsx ~rad 2050-2072)

Centrerat, halvtransparent överlägg (z-30, `pointer-events-none`) som renderas BARA när `arSessionVisible && arStartedAtMs !== null && arDebugStats.trueVisibleTurbineCount === 0 && inFrontOfCameraCount === 0`:

```tsx
{arSessionVisible &&
  arStartedAtMs !== null &&
  arDebugStats.trueVisibleTurbineCount === 0 &&
  inFrontOfCameraCount === 0 && (
    <div
      className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center"
      aria-live="polite"
    >
      <div className="rounded-2xl border border-white/20 bg-black/55 px-5 py-3 text-center shadow-2xl backdrop-blur-md">
        <p className="text-sm font-semibold text-white">
          🔍 Hittar vindkraftverken…
        </p>
        <p className="mt-0.5 text-xs text-white/70">
          {searchElapsedSec}s — peka kameran runt så fixar jag positionen
        </p>
      </div>
    </div>
  )}
```

**Auto-dölj:** Så fort `trueVisibleTurbineCount > 0` → effekten sätter `searchElapsedSec = 0` → overlay försvinner (alla fyra villkoren blir `false`). Användaren behöver aldrig stänga den manuellt.

**Z-index-hierarki (förstår du inte detta kommer overlays visas i fel ordning):**
- z-30: statusbanners, photoError, **TurbineSearchHint** (NY)
- z-45: topp-bar + botten-bar (knappar)
- z-50: NearestTurbineArrow (AR-pilen)
- z-55: Meny-modal

### Ändring 3 — Dedupe avståndsinfo i topp-bar (Home.tsx ~rad 1953-1965)

**BORTAGET:**

```tsx
{/* Rad 3: Närmaste verk-information */}
{nearestTurbineInfo && (
  <div className="text-[11px] leading-none text-white/60">
    🌬️ Närmaste verk ·{" "}
    {nearestTurbineInfo.distanceM >= 1000
      ? `${(nearestTurbineInfo.distanceM / 1000).toFixed(1)} km`
      : `${Math.round(nearestTurbineInfo.distanceM)} m`}
    {" · "}
    {["N","NNÖ","NÖ","ÖNÖ","Ö","ÖSÖ","SÖ","SSÖ","S","SSV","SV","VSV","V","VNV","NV","NNV"][
      Math.round(((nearestTurbineInfo.bearingDeg % 360) + 360) % 360 / 22.5) % 16
    ]}
  </div>
)}
```

**KOMMENTAR ISTÄLLET:**

```tsx
{/* V31 (produktfeedback, ny omgång: "det är dubbla info om
    avstånd, nästan trippla"): den tidigare "Rad 3: Närmaste
    verk · 1.8 km · ÖSÖ"-raden togs BORT — exakt samma info
    (avstånd + kompassiktning till närmaste verk) visas redan
    i den stora NearestTurbineArrow-rutan på höger sida, och
    skulle bara upprepas en tredje gång när sökhint-överlägget
    visar sig. Vi behåller pilen som enda AVSTÅNDS-källa i
    topp-baren; knappraden nedan följer direkt på rad 2. */}
{/* Rad 3 (fd. rad 4): Ljud · Ute/Inne · Dölj status · ⚙️ */}
```

**Vad som BLIR KVAR som avståndskällor:**
- `NearestTurbineArrow` (höger sida, stor box): "Närmaste verk / 1.8 km bort / Vrid mobilen åt detta håll"
- Eventuell orange tooltip "3.1 km — vrid 113°" (om den finns i framtida builds) — separat scope, 3 närmaste vs 1 närmaste

**Inget annat ändras i topp-baren.** Rad 1 (titel + info-knapp) och rad 2 (GPS · Kompass · AR · Fri sikt) är orörda.

### Ändring 4 — Reorder botten-bar (Home.tsx ~rad 2068-2090)

**TIDIGARE ordning (fel):**
1. Blå "Simulerad position"-pill
2. Statusbanner (gul Svag positionering / Kompass svag)
3. SoundLevelPanel
4. Action-knappar (Skriv på, Meny)

**NY ordning (V31):**
1. **Statusbanner** (säkerhetskritisk varning) ← FÖRST
2. Blå "Simulerad position"-pill (sekundär info)
3. SoundLevelPanel
4. Action-knappar (Skriv på, Meny)

Koden flyttar statusbanner-blocket före positionOverride-blocket i JSX. Inga beteendeändringar — bara visuell prioritetsordning.

## Verifiering

### TypeScript
`npx tsc --noEmit` rapporterar ENDAST pre-existing missing type defs (`@types/node`, `vite-plugin-pwa/client`, `vite/client`) — inga fel från V31-ändringarna.

### Visuell verifiering (att göra på Replit)
1. **Sökhint-test (simulerat läge, positionOverride):**
   - Öppna `/placera` (eller "Placera ut" i menyn) → ange position → tryck "Se i AR"
   - LoadingSequence hoppas över (`hasOnboarded=true`)
   - Så fort AR-vyn syns, men INGA verk ännu: centrerat "🔍 Hittar vindkraftverken… Xs — peka kameran runt så fixar jag positionen" visas
   - Tickar varje sekund (0s, 1s, 2s, …)
   - Så fort `trueVisibleTurbineCount > 0` (kan vara den 2-sekunders safety fallback som tvingar fram 3 närmaste, eller pipeline som hittar dem naturligt): overlay FÖRSVINNER
2. **Dedupe-test:**
   - I AR-vyn, titta på topp-baren — ska INTE visa "🌬️ Närmaste verk · X km · ÖSÖ" under statusraderna
   - NearestTurbineArrow till höger visar fortfarande avstånd + bäring
3. **Prioritetstest (varning ovanför blå):**
   - Stå i AR i en miljö med dålig GPS (inomhus, eller `positionOverride` med svag simulering) → "Svag positionering" gul banner visas
   - Verifiera: gul banner är ÖVERST i botten-baren, blå "Simulerad position" UNDER
   - Ta bort simuleringen → blå pill försvinner, gul kvarstår om signalen fortfarande svag

### Regression-check
- `NearestTurbineArrow` oförändrad — visar fortfarande 1-närmaste-info som förut
- `statusBanner`-prioritetslogik oförändrad — bara visningsordningen i DOM:en är ny
- `arStartedAtMs`-mekanism oförändrad
- Inga ändringar i `ARScene.tsx`, `useArTrackingStability.ts` eller andra komponenter
- V30 auto-start fungerar fortfarande (V31-ändringarna rör bara rendering, inte start-logik)

## Tekniska detaljer

### Varför `trueVisibleTurbineCount === 0` ensamt räcker

`inFrontOfCameraCount` är en mer restriktiv check (bara verk FYSISKT framför kameran just nu), `trueVisibleTurbineCount` är den opacitetsbaserade räkningen (även delvis dolda verk räknas). Vi kräver BÅDA = 0 för att visa sökhint eftersom:
- Om `trueVisibleTurbineCount > 0` → något är på väg att synas → vänta lite till
- Om `trueVisibleTurbineCount === 0` men `inFrontOfCameraCount > 0` → konstigt mellanläge, visar hellre safety fallback-beteendet

Båda = 0 innebär "vyn är tom OCH inget är på väg in" — då behöver användaren veta att vi letar.

### Varför centrerat och inte topp/botten

Den centrerade positionen är minst i vägen för:
- Topp-barens statusrader (z-index-hierarki tillåter overlap men visuellt distraherande)
- Botten-barens handlingsknappar (som MÅSTE vara tryckbara)
- NearestTurbineArrow (höger sida, kan täckas delvis men overlayen är `pointer-events-none`)

`pointer-events-none` är viktigt — användaren ska kunna interagera med AR-pilen och knapparna UNDER sökhint-rutan.

### Varför vi inte animerar uttoningen

Enkel setInterval-state-tick räcker. Animationsbibliotek skulle lägga till komplexitet utan att förbättra UX (användaren tittar på kameran, inte på räknaren). Om `trueVisibleTurbineCount` fluktuerar (vilket det kan — en verk tonas in/ut), försvinner/visas overlayen direkt utan fade — det är OK eftersom det fångar exakt rätt ögonblick.

## Reserverade framtida förbättringar (utanför V31-scopet)

- Om `searchElapsedSec > 30` och `arDebugStats.trueVisibleTurbineCount === 0`: visa ett "Detta dröjer ovanligt länge — kontrollera att du är utomhus och har fri sikt"-meddelande. Implementeras enkelt genom att lägga till en andra state-rad i `statusBanner`-logiken eller ett nytt villkor i sökhint-överlägget.
- Om `positionOverride` är satt och `arDebugStats.renderMode === "safety-fallback"`: visa en kort "Vi visar 3 närmaste verk som referens" istället för "Hittar vindkraftverken…". Kräver läsning av `arDebugStats.renderMode` (som redan finns i SensorDebugPanel).

## Checklista för Replit

- [ ] Pull `5ae7c09`
- [ ] Kör `npm install` (om det behövs efter pull)
- [ ] Verifiera typecheck: `npx tsc --noEmit` (förväntat: bara pre-existing missing-type-fel)
- [ ] Bygg: `npm run build` (förväntat: OK)
- [ ] Dev-server: `npm run dev` (eller motsvarande)
- [ ] Gå igenom de tre verifieringsstegen ovan
- [ ] Om något inte beter sig som beskrivet: kolla webbläsarens DevTools-konsol för AR-pipeline-loggar (samma format som V30-verifieringen)
- [ ] Commit:a inget på Replit-sidan — V31 är redan commitad lokalt
