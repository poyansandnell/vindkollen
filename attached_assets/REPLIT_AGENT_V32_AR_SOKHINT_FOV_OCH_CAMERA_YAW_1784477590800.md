# V32 — AR: FOV-baserad sökhint + optisk camera-yaw-logg

**Commit (redan i repo):** `b07493c`  
(`b07493cb57e825026613e1a8adea7b4b100e4ed4`)  
**Meddelande:** `V32: FOV-baserad AR-sökhint + optisk camera-yaw i diagnostik`

**Filer (endast dessa två):**
- `artifacts/vindkraft-ar-katrineholm/src/pages/Home.tsx`
- `artifacts/vindkraft-ar-katrineholm/src/components/ARScene.tsx`

**Föregående:** V31 `5ae7c09` (sökhint + HUD-dedupe + gul banner ovanför blå).  
V32 **ersätter inte** V31 — den **fixar** sökhint-gaten och diagnostiken.

---

## Sammanfattning (läs först)

Tre användarproblem efter V31-build på enhet:

| # | Symptom | Root cause | V32-åtgärd |
|---|---------|------------|------------|
| 1 | Centrerad “Hittar vindkraftverken…” syns sällan/aldrig i **vanlig AR** trots tom skärm | Gate krävde `trueVisibleTurbineCount === 0` **och** FOV-tom. `trueVisible` = material-opacitet > ~0.02 (kan vara 29/29 “synliga” när man tittar åt sidan). | Gate på **bara** `inFrontOfCameraCount === 0` (FOV). |
| 2 | Dubbelt avstånd: “3,3 km — vrid…” vs pil “1,3 km” | **Stale native-build** (pre-V31). I källkod finns chipet redan borttaget i V31. | **Ingen kodändring.** Rebuild från `b07493c` (inkl. V31). |
| 3 | Verk känns “sega/fastnat”; logg visar 90–180° Predictive mellan Heading och Camera yaw | Camera yaw togs som Euler-Y (YXZ) ur full camera-quaternion (inkl. Q1 −90° X + skärm) — **konventionsfel**, inte nödvändigtvis lag. | Camera yaw = optisk axel `atan2` på `(0,0,-1)` transformerad med camera quaternion. **Heading-filter/tau orörd.** |

---

## Vad du ska göra på Replit

### Alternativ A — preferred (om git har committen)

```bash
cd ~/vindkollen   # eller er repo-root
git fetch
git log --oneline | head -10   # sök b07493c / "V32:"
git cherry-pick b07493c        # eller merge/pull main om ni redan är ahead/sync
```

Om `b07493c` redan finns på den branch ni jobbar på: dfs endast till **Verifiering** nedan.

### Alternativ B — manuella patches (om commit saknas)

Applicera exakt följande i `artifacts/vindkraft-ar-katrineholm/`.

---

## Ändring 1 — `Home.tsx`: FOV-gate för sökhint

### 1a. Flytta `inFrontOfCameraCount` **före** `searchElapsedSec`

**Varför:** V32-sök-effekten läser `inFrontOfCameraCount`. Om state/poll ligger **efter** sök-effekten i filen får du `TS2448` (used before declaration).

**Hitta** det gamla blocket (ca efter `turbinesInRangeCount` / före debug-poll) som ser ut så här och **ta bort det där**:

```ts
  const [inFrontOfCameraCount, setInFrontOfCameraCount] = useState(0);
  useEffect(() => {
    if (!started) return;
    const id = window.setInterval(() => {
      setInFrontOfCameraCount(arSceneRef.current?.getInFrontOfCameraCount() ?? 0);
    }, 250);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);
```

**Klistra in samma block** direkt **före** `searchElapsedSec`-kommentaren / state (ca efter `arSessionVisible`-foto-effekten, ~rad 529). Lägg gärna V32-kommentar:

```ts
  // V32: auktoritativ FOV-räkning från ARScene (samma 3D-optiska-axel-
  // vinkel som styr "rakt fram"-garantin). Används både för
  // kalibreringsfallbacken och för sökhinten, så de aldrig blir oense om
  // vad som faktiskt syns.
  const [inFrontOfCameraCount, setInFrontOfCameraCount] = useState(0);
  useEffect(() => {
    if (!started) return;
    const id = window.setInterval(() => {
      setInFrontOfCameraCount(arSceneRef.current?.getInFrontOfCameraCount() ?? 0);
    }, 250);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);
```

### 1b. Byt gate i `searchElapsedSec`-effekten

**FÖRE (V31 — FEL för “vanlig AR”):**
```ts
    if (arDebugStats.trueVisibleTurbineCount > 0) {
      setSearchElapsedSec(0);
      return;
    }
  // ...
  }, [arSessionVisible, arStartedAtMs, arDebugStats.trueVisibleTurbineCount]);
```

**EFTER (V32):**
```ts
    // V32: räknaren ska spegla användarens upplevelse — "inga verk i
    // sikte". Därför går vi på FOV-räkningen (`inFrontOfCameraCount`) från
    // ARScene, inte på `trueVisibleTurbineCount` (som räknar material med
    // opacitet > ~0.02 och därför kan vara >0 även när användaren tittar
    // åt ett helt annat håll). Så fort minst ett verk ligger inom kamerans
    // optiska axel försvinner räknaren.
    if (inFrontOfCameraCount > 0) {
      setSearchElapsedSec(0);
      return;
    }
  // ...
  }, [arSessionVisible, arStartedAtMs, inFrontOfCameraCount]);
```

Uppdatera även kommentaren ovanför `const [searchElapsedSec, …]` så den säger att timern stannar när `inFrontOfCameraCount > 0` (inte `trueVisibleTurbineCount`).

### 1c. Overlay-villkor + copy

**FÖRE:**
```tsx
          {arSessionVisible &&
            arStartedAtMs !== null &&
            arDebugStats.trueVisibleTurbineCount === 0 &&
            inFrontOfCameraCount === 0 && (
              // ...
                  <p className="mt-0.5 text-xs text-white/70">
                    {searchElapsedSec}s — peka kameran runt så fixar jag positionen
                  </p>
```

**EFTER:**
```tsx
          {/* V32: sökhint visas så länge INGET verk ligger inom kamerans
              FOV (`inFrontOfCameraCount === 0`), oavsett om något material
              fortfarande har opacitet >0.02 när man tittar åt sidan. */}
          {arSessionVisible &&
            arStartedAtMs !== null &&
            inFrontOfCameraCount === 0 && (
              // ... samma wrapper/yta ...
                  <p className="mt-0.5 text-xs text-white/70">
                    {searchElapsedSec}s — inga verk i siktfältet, peka kameran runt
                  </p>
```

**Z-index oförändrad:** z-30 hint, z-45 bars, z-50 pil.

---

## Ändring 2 — `ARScene.tsx`: optisk camera yaw i debuglogg

### 2a. Ta bort `cameraYawEuler`-allokeringen

Hitta och **ta bort** (fanns nära andra återanvända `Vector3` i render-loopen):

```ts
    const cameraYawEuler = new THREE.Euler();
```

(inkl. den långa juni-kommentaren som bara handlade om Euler-YXZ).

### 2b. Byt beräkning där `cameraYawDeg` sätts (i per-frame debug-blocket)

**FÖRE:**
```ts
      cameraYawEuler.setFromQuaternion(state.camera.quaternion, "YXZ");
      const cameraYawDeg = ((-cameraYawEuler.y * 180) / Math.PI + 360) % 360;
```

**EFTER:**
```ts
      // V32: "Camera yaw" = optisk axel i världen, samma konvention som
      // cameraForward / synlighetslogik. Euler-Y ur full camera-quat (Q1
      // −90° X + skärm) gav ofta ~90–180° fel vs heading trots att
      // AR-scenen följde sensorn.
      const cameraForwardForYaw = new THREE.Vector3(0, 0, -1).applyQuaternion(
        state.camera.quaternion,
      );
      const cameraYawDeg =
        ((Math.atan2(cameraForwardForYaw.x, -cameraForwardForYaw.z) * 180) /
          Math.PI +
          360) %
        360;
```

**Rör INTE:**
- `useDeviceOrientation` (HEADING_* tau, gyro confirm)
- `CAMERA_SLERP_TAU` / `quaternion.copy` till camera
- V29 `frustumCulled` / `forceVisible` / `cachedMeshes`
- V30 `autoStartRef` / auto-`handleStart`
- V31 borttagning av topp-bar “Närmaste verk · X km” / gul-ovanför-blå

---

## Medvetet ute-scope (gör inte i V32)

- Reverse countdown 30→0 (vi behåller elapsed uppåt)
- Consecutive empty-FOV-bas (timer nollställs från `arStartedAtMs` = sessionstart; om man ser verk, tittar bort, kan sekunderna hoppa — samma V31-bas)
- Filter/tau-tuning för “sega verk” **om** logg efter V32 visar liten Δ (då är det egen ticket)
- Orelaterade dirty filer: `capacitor.config.ts`, `index.html`, `index.css`, `PlaceTurbines.tsx`, `pnpm-lock.yaml` — **commita inte med V32**

---

## Verifiering

### Typecheck
```bash
cd artifacts/vindkraft-ar-katrineholm
# om TS6305 / lib refs:
pnpm run typecheck:libs   # eller npm run typecheck:libs
pnpm run typecheck        # ska vara rent
```

### Grep-sanity (ska matcha)
```bash
# Home: ingen trueVisible i sökhint-gate
rg -n "searchElapsedSec|inFrontOfCameraCount|trueVisibleTurbineCount" src/pages/Home.tsx

# ARScene: ingen cameraYawEuler / setFromQuaternion för yaw
rg -n "cameraYaw|cameraForwardForYaw|cameraYawEuler" src/components/ARScene.tsx
```

Förväntat:
- Sök-effekt + overlay: **bara** `inFrontOfCameraCount`
- Overlay-text innehåller `inga verk i siktfältet`
- `cameraYawDeg` från `atan2` + `(0, 0, -1)` — **inte** `setFromQuaternion(..., "YXZ")`

### Manuell på iPhone (MÅSTE rebuild native)

1. `npm run build` (eller er web-build) → Capacitor sync → install (**inte** gammal Jul 18 `dist-native`).
2. **Se härifrån / Se i AR** (sim) och **vanlig GPS-AR**:
   - Titta **bort** från verken → centroverlägg “Hittar vindkraftverken… / Ns — inga verk i siktfältet…”
   - Titta **mot** verk i FOV → overlay **försvinner** omedelbart
   - Overlay får gärna synas även om debug säger många “synliga” (opacitet)
3. **HUD avstånd:** bara **NearestTurbineArrow** som stort km (ingen “3,3 km — vrid…”-chip i topp)
4. **Gul weak-banner** fortfarande **över** blå “Simulerad position” (V31)
5. **Debuglogg:** `Heading` ≈ `Camera yaw` vid stillastående och trots snabb vridning (ingen systematiskt ~90°/180°-offset). Om verk fortfarande “fastnar” **och** Δ är liten → notera för sen tau-pass, inte regress i V32.

---

## Commit-meddelande (om ni patchar manuellt)

```
V32: FOV-baserad AR-sökhint + optisk camera-yaw i diagnostik

Sökhint/searchElapsedSec styrs bara av inFrontOfCameraCount (FOV),
inte trueVisibleTurbineCount (material-opacitet). Camera yaw i ARScene
beräknas från optisk axel (0,0,-1) så headingΔ-loggen inte ger falsk
90–180° offset från Euler-YXZ + Q1.
```

**Såg bara dessa två filer i commit.**

---

## Checklista för Replit Agent

- [ ] `b07493c` på branchen **eller** manuella patches 1a–1c + 2a–2b
- [ ] `pnpm run typecheck` / `tsc --noEmit` rent
- [ ] Grep-sanity grön
- [ ] Web build → native sync → device install (färsk bundle)
- [ ] Manuella steg 2–5 OK
- [ ] Inga orelaterade filer i commit
- [ ] V27/V29/V30/V31-logik orörd utöver ovan

---

## Kort “varför” ni kan klistra i PR/anteckning

V31 sökhint mätte “finns det mesh med opacity?” i stället för “finns det verk i **siktfältet**?”. I normal AR: safety/forceVisible kan hålla material “synliga” → hint dog. V32 = FOV-only. Dubbla km-chipet var redan dödat i V31; enhets-screenshot = stale build. Stuck-yaw-diagnosen Jagar Euler-Y på en pre-roterad camera-quat — optisk yaw gör loggen ärlig innan man rör filter-tau.
