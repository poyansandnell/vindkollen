# Replit Agent-instruktioner: V34 — AR-verk syns inte, överlappande HUD, NationalMap Load failed

## Bakgrund (från iPhone-test 2026-07-19 ~19:28)

Tre separata problem observerades samtidigt. Bygg-ID i loggen:
`buildId: "d74fcd7@2026-07-19 17:27"` — **detta är EN ANNAN commit än V33 (`79caacd`)**. Säkerställ att V33 redan är incheckat innan V34, annars får ni intressekonflikt i sökhint-UI.

### Symptom i logg + skärmdumpar

1. **AR: "inga vindkraftverk fram"**
   - Pipeline fungerar: `Loaded 29 turbines`, alla modeller skapas och "Modell synlig (... opacitet=1.00 ...)".
   - MEN: **varje verk loggar `frustumVisible=false`** vid första synlighetslogg.
   - Säkerhetsnätet triggas: `[AR][safety] No turbines in camera FOV for 2000ms — force-showing 3 nearest turbines` (upprepas).
   - Diagnostik: `29/29 verk synliga denna bildruta` (opacitet) men användaren ser **inget** (inomhus-screenshot) ELLER bara små streck långt bort (utomhus-screenshot).
   - Närmaste verk: V5-2 ~3230 m, bäring ~89°. Användarens heading ~90–110°. Avstånd 3–14 km.
   - `hasOnboarded=true — hoppar över LoadingSequence` (avsiktligt efter V24/V27, men upplevs som "laddningssidan fungerade inte").

2. **HUD: all info ovanpå varandra**
   - Skärmdump visar **två** "🔍 Hittar vindkraftverken…"-boxar samtidigt (en med progress-stapel + "0s kvar", en äldre gul/orange).
   - Dessutom staplas: `🧭 Kalibrera kompassen` (osäkerhet ±42°), blå projekt-pill, orange bottom-status, top-badges (`Svag GPS · GARANTERAD DIREKT · På · 🌡️ · 📶`).
   - Meny nertill rosade fortfarande i tidigare feedback.

3. **Sverigekartan: Live-data kunde inte hämtas**
   ```
   [NationalMap] Hämtar projekt { apiBase: "https://b9014749-…riker.replit.dev", … }
   [NationalMap] GeoJSON features: 20 ( 20 proj)   ← pilotdataset OK
   [NationalMap] Projekt-API misslyckades {
     url: "…/api/wind/project-areas?…",
     error: {},
     native: true,
     httpStatus: null,   ← nätverksfel INNAN HTTP-svar
     ms: "617"
   }
   ```
   - UI visar korrekt fallback: `⚠️ Live-data kunde inte hämtas — pilotdataset visas` + `Orsak: Load failed`.
   - Från server: samma Replit-tunnel returnerar **HTTP 502** just nu. Tunneln är död/vilande.

---

## Förberedelser

```bash
cd artifacts/vindkraft-ar-katrineholm
pnpm install
# Kontrollera att V33 redan finns:
rg -n "searchRemainingSec|SEARCH_HINT_TIMEOUT_SEC" src/pages/Home.tsx
# Om saknas: applicera först REPLIT_AGENT_V33_AR_HUD_COUNTDOWN_LAYOUT.md
```

**Rör INTE** (om du inte uttryckligen fixar forceVisible-render):
- `forceVisibleIds` / `NEAR_CENTER_FORCE_DEG` / frustum-startlogik i grunden (V27/V29/V30/V32) — byt bara det som listan nedan kräver.
- `hasOnboarded`/localStorage-skip av LoadingSequence utan ersättande UX.

---

## DEL A — NationalMap API (Load failed)

### A1. Verifiera och byt API-bas

Fil: `.env.native`

Nuvarande:
```
VITE_API_BASE_URL=https://b9014749-0395-4a74-81ac-8deb3fc86054-00-1te953tm13n9f.riker.replit.dev
```

`riker.replit.dev`-tunnlar dör när Replit sover → iOS får `httpStatus: null` / TypeError "Load failed".

**Gör så här:**
1. Hitta en **stabil** publik bas-URL (Replit `*.replit.app` produktion eller custom-domän) som svarar 200 på:
   ```
   GET /api/wind/project-areas?minLat=55&maxLat=70&minLng=10&maxLng=25
   ```
2. Sätt den i `.env.native`:
   ```
   VITE_API_BASE_URL=https://<stabil-produktion>.replit.app
   ```
3. Kör `pnpm native:build` så att `import.meta.env.VITE_API_BASE_URL` bakas in.

### A2. Robustare native-fetch i `NationalMapView.tsx`

Fil: `src/components/NationalMapView.tsx` (~rad 290–360)

Problem: kapsules `fetch` från `capacitor://localhost` mot HTTPS kan ge tom `error: {}` och `httpStatus: null` (CORS/ATS/nät) utan användbar text. Dessutom är retries saknade.

**Krav:**
1. Logga alltid `String(error)`, `error?.name`, `error?.message`, `error?.cause`.
2. Vid native: prova **CapacitorHttp** om tillgängligt (`@capacitor/core` Http-plugin), annars `fetch`.
3. En (1) automatisk retry efter 800 ms vid nätverksfel.
4. Visa i den gula fel-boxen:
   - `Orsak: <mänsklig text>` (t.ex. `Nätverksfel (ingen HTTP-status)` eller `HTTP 502`)
   - inte bara `Load failed`
5. Knappen **Försök igen** ska anropa samma load-effekt (extrahera fetch till `reloadProjects()` och anropa den).

Pseudokod:

```ts
async function fetchProjects(url: string): Promise<ApiProjectArea[]> {
  const attempt = async () => {
    // Prefer CapacitorHttp on native if present
    if (isNative() && CapacitorHttp?.get) {
      const res = await CapacitorHttp.get({ url, headers: { Accept: 'application/json' } });
      if (res.status < 200 || res.status >= 300) throw Object.assign(new Error(`HTTP ${res.status}`), { httpStatus: res.status });
      const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
      return Array.isArray(data) ? data : [];
    }
    const r = await fetch(url);
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { httpStatus: r.status });
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  };
  try {
    return await attempt();
  } catch (e1) {
    await new Promise(r => setTimeout(r, 800));
    return await attempt();
  }
}
```

Sätt `lastApiError` till något läsbart:
```ts
const msg =
  error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : 'Nätverksfel (ingen HTTP-status)';
```

Visa i UI:
```
⚠️ Live-data kunde inte hämtas — pilotdataset visas
Orsak: HTTP 502   // eller Nätverksfel …
[ 🔄 Försök igen ]
```

### A3. ATS / allowlist (iOS)

Om produktion använder annan host: säkerställ att `Info.plist` tillåter HTTPS (default OK). Blanda inte HTTP. Inga ATS-exception behövs för riktig HTTPS.

### A4. Verifiering NationalMap

```bash
# 1. API lever
curl -sS -o /dev/null -w "%{http_code}\n" "$VITE_API_BASE_URL/api/wind/project-areas?minLat=55&maxLat=70&minLng=10&maxLng=25"
# förväntat: 200

# 2. Ny native-build
pnpm native:build && npx cap sync ios

# 3. På enhet: öppna Sverigekartan
# Logg ska visa:
#   [NationalMap] Live-data hämtad { rawCount: >20, … }
# UI: "· live" i headern, INTE gul "Load failed"-box
```

---

## DEL B — Överlappande AR-HUD (måste fixas)

### B1. ENDAST EN sökhint — ta bort dubbletter

Fil: `src/pages/Home.tsx`

**Problem:** V33-overlay ("Hittar vindkraftverken… Xs kvar" + progress) kan ligga samtidigt som:
- äldre gul sökhint (om d74fcd7/V31 delvis mergad)
- `statusBanner` med `"Verken ligger åt pilens riktning – vrid mobilen"` (rad ~1220-ish)
- `ArStartBanner` ("🌀 Vindkraftverken syns nu! / Peka kameran runt…") i samma z-zon
- kompasskalibreringsbanner (`🧭 Kalibrera kompassen`) under safe-area + topbar

**Krav (en enda sanning):**
1. Sök i hela `src/`:
   ```bash
   rg -n "Hittar vindkraftverken|Peka kameran runt|searchElapsedSec|searchRemainingSec" src/
   ```
2. Det får bara finnas **EN** "Hittar vindkraftverken"-UI: V33-varianten med nedräkning + progress (`z-[55]`, `top: max(120px, 22vh)`).
3. Auth statusBanner-raden `"Verken ligger åt pilens riktning – vrid mobilen"` **helt** (den dubblerar sökhinten). När FOV är tom: visa **bara** V33-sökhinten.
4. `ArStartBanner`: visa den **bara** om `inFrontOfCameraCount > 0` (dvs. verk faktiskt i sikte). Om FOV är tom: visa aldrig "Vindkraftverken syns nu!".
5. Kompasskalibreringsbanner:
   - Flytta ner under sökhinten ELLER
   - dölj den medan sökhinten är aktiv (`inFrontOfCameraCount === 0 && arSessionVisible`)
   - alternativt: fäll ihop till en-radig pill i botten-`statusBanner` (prioritet under kritiska fel).

### B2. Statusfält prioritering (en box åt gången)

Redan finns `statusBanner`-prioritet. Utöka den:

| Prioritet | Villkor | Visa |
|---|---|---|
| 1 | errors | röd fel |
| 2 | orientationStalled | röd |
| 3 | compassAccuracyDeg > 35 | gul "Kalibrera kompass (±N°)" — **ersätt** den flytande orange boxen |
| 4 | headingFallback / weakSignal | gul |
| 5 | indoors | gul skymd |
| 6 | nearestOnTarget | grön |
| 7 | wind/calibrated | orange engång |
| — | FOV tom | **ingen** statusBanner → V33-sökhint tar skärmen |

Ta bort den absoluta `🧭 Kalibrera kompassen`-boxen (**rad ~1675–1690**) när den finns i statusBanner, så de inte staplas.

### B3. Top-badges kompakteras

Skärmdump top-vänster: `Svag GPS · GARANTERAD DIREKT` + `På` + termometer + signal staplade över projektet.

**Krav:**
- I vanlig AR (ej `showDebugStrip`): visa max **en** kompakt rad badges (GPS | Kompass | AR) med fast `gap-1`, `text-[10px]`, ingen wrap till 3 rader.
- "GARANTERAD DIREKT" / force-visible-läget: om det visas, max en liten grå/orange pill i **botten** nära statusBanner — inte i toppen där den krockar med projektnamn.
- `SoundLevelBadge` / `NoiseImpactBadge` får inte lägga sig ovanpå sökhint eller kompassbanner. Placera dem i botten-raden bredvid Meny om de måste vara kvar.

### B4. Bottenlayout (bekräfta V33-padding)

Bekräfta (V33):
```
pb-[max(4.5rem,calc(env(safe-area-inset-bottom)+1.25rem))]  // bottenkontroller
pb-[max(3.5rem,env(safe-area-inset-bottom))]                 // meny-sheet
```

Inga andra fasta `bottom: 0` overlays utan safe-area.

---

## DEL C — AR-verk syns inte trots Loaded 29

### C1. Diagnos (läs loggen ni får)

| Observation | Tolkning |
|---|---|
| `Loaded 29 turbines` + Model loaded | Pipeline + modeller OK |
| `opacitet=1.00` men `frustumVisible=false` | Verk utanför kamerans view-frustum ELLER world/camera-matris fel |
| `force-showing 3 nearest` upprepas | FOV-räkning (`inFrontOfCameraCount`) förblir 0 |
| Avstånd 3–14 km | På riktig skala = **pixlar** stora objekt — lätta att "missen" |
| Heading ~100°, bäring närmaste ~89° | Användaren tittar ungefär rätt horisontellt |
| `cameraForward.y` ≈ −0.4 till −0.6 | Telefonen pekar **nedåt** → optisk axel missar horisontverk |

### C2. Minimalt, säkert fixpaket (röra så lite V29 som möjligt)

Filer: `src/components/ARScene.tsx`, `src/pages/Home.tsx`

**C2a. Force-show ska vara uppenbart synligt**
När `forceVisibleIds` är aktivt för de 3 närmaste:
1. Behåll befintlig `frustumCulled = false` (V29 — rör inte bort).
2. Lägg till en **tillfällig skärmförankring / minimal billboard-förstärkning** enbart för force-visible verk:
   - Om verkets projicerade skärm-höjd < ~40 px: boosta lokal skala (clamp max 3×) ELLER rita en tunn orange **debug-line + label** (redan finns debug-geometry i ARScene — aktivera den för forceVisible även utan showSensorDebug).
3. När `inFrontOfCameraCount > 0` i ≥ 1 s: stäng av skal-boost (behåll forceVisible opacity=1 tills naturlig FOV funkar).

**C2b. Telemetri som faktiskt hjälper**
Utöka den periodiska diagnostiken (var 60:e frame) med för det NÄRMASTE force/ordinary-verket:
```
nearest: name, bearing, heading, cameraYaw, angleFromOpticalAxisDeg,
screenX/Y, screenHeightPx, forceVisible, frustumVisible, opacity
```
Logga EN rad:
```
[AR][v34] nearest=V5-2 dist=3230m ang=42° scr=(180,900) hPx=12 force=1 frust=0
```
Så nästa iPhone-logg direkt visar om problemet är "för litet på skärmen" vs "bakom kamera" vs "fel ENU".

**C2c. Pitch-fälla**
Om `cameraForward.y < -0.35` (telefon pekar kraftigt ned) OCH `inFrontOfCameraCount === 0`:
- Låt V33-sökhinten byta copy till:
  `Peka mer mot horisonten — verken ligger långt bort i marknivå`
- Inte bara "peka kameran runt".

**C2d. INTE göra**
- Inte mass-force-showa alla 29.
- Inte återinföra dual distance-chip ("3,2 km — vrid").
- Inte ändra `MAX_RENDER_DISTANCE_M`, ENU-konvertering eller Q1-rotation utan ny bevisad logg.

### C3. LoadingSequence-skip (UX, inte bug i grunden)

`hasOnboarded=true` hoppar avsiktligt över LoadingSequence. Användare tolkar det som "laddning funkar inte".

**Krav:**
- Behåll snabbstart EFTER första gången.
- Visa en **engångs 1,5 s toast** när AR startar med skip:
  `Startar AR…` (försvinner automatiskt)
- ELLER: om `withinRangeTurbineCount === 0` efter 3 s sedan GPS-fix, visa sökhinten (redan V33) — det räcker.

Rensa onboarding för QA:
```js
localStorage.removeItem('vindkollen:hasOnboarded')
```

---

## DEL D — Bygg, commit, test

### Bygg
```bash
pnpm tsc --noEmit
pnpm native:build
# Verifiera ny build-id INTE är d74fcd7 och att API-basen är den stabila:
rg -n "VITE_BUILD_ID|riker.replit.dev|replit.app" dist-native/assets/*.js | head
npx cap sync ios
```

### Commit (endast V34-filer)
```bash
git add \
  .env.native \
  src/pages/Home.tsx \
  src/components/NationalMapView.tsx \
  src/components/ARScene.tsx \
  dist-native/
# + eventuellt package.json om CapacitorHttp lades till
git commit -m "V34: NationalMap robust fetch+stabil API, HUD-dedupe, AR force-show synlighet"
```

Lämna övriga dirty-filer (`PlaceTurbines.tsx`, `capacitor.config.ts` om ej behövd, etc.) orörda.

### Testmatris på iPhone

| # | Scenario | Förväntat |
|---|---|---|
| 1 | Öppna Sverigekartan online | Ingen gul Load failed; header visar `· live`; >20 projekt om API har mer |
| 2 | Airplane mode → Sverigekartan | Pilotdataset + tydlig Orsak + Försök igen funkar när nät är tillbaka |
| 3 | Starta AR första gång / efter clear hasOnboarded | LoadingSequence ELLER kort "Startar AR…" |
| 4 | Starta AR hasOnboarded | Ingen dubblett-sökhint; max en "Hittar vindkraft…" |
| 5 | AR inomhus, peka horisont österut (~90°) | Inom 2–4 s syns minst de 3 närmaste (force-show), eller tydlig "peka mot horisonten" |
| 6 | AR utomhus samma | Verk syns som 3D; sökhint försvinner när FOV > 0; nedräkning reset 30→ |
| 7 | Öppna Meny | Inte avklippt nertill (V33-padding) |
| 8 | Kalibrera-kompass-läge | En status, inte mitt i sökhinten |

### Logg att bifoga om det fortfarande failar
```
[AR][v34] nearest=…
[AR][frustum-diag] …
[AR][safety] force-showing …
[NationalMap] Live-data hämtad … / Projekt-API misslyckades { httpStatus, message }
```

---

## Kort sammanfattning för agenten

1. **Byt + hårdna API** till stabil bas; bättre feltext + retry + Försök igen; native Http om möjligt.  
2. **Dedupe HUD**: en sökhint, en statusBanner, ArStartBanner bara när FOV>0, flytta/komprimera kalibrering + badges.  
3. **AR force-show**: telemetri på nearest + gör force-visible verk faktiskt uppenbara (skal-boost/label) när skärmhöjd är < ~40 px; pitch-copy.  
4. **Bygg om native**, committa, testa matrisen.

V33 (countdown/layout) ska redan finnas — slå ihop, duplicera inte sökhinten igen.
