# V26 — Två regressionsfixar: ARScene NaN-bugg + PlaceTurbines auto-start

## Sammanhang från V25-test

V25 introducerade **två regressionsbuggar** som tillsammans gjorde appen oanvändbar:

### Bugg 1 (kritisk): NaN i heading-smoothing

I V25 lades EMA-smoothing till på `sensorEuler.y` (yaw). Koden ser ut som:

```ts
let delta = rawYawDeg - smoothedYawDegRef.current;  // ← null → NaN
if (delta > 180) delta -= 360;
if (delta < -180) delta += 360;
smoothedYawDegRef.current += delta * 0.35;            // ← NaN sprids permanent
```

På FÖRSTA frame är `smoothedYawDegRef.current === null`. Då blir:
- `rawYawDeg - null = NaN`
- `NaN + 0 = NaN`
- `smoothedYawDegRef.current = NaN` permanent
- `sensorEuler.y = NaN * Math.PI/180 = NaN`
- `state.camera.quaternion.setFromEuler(sensorEuler)` → rotationen blir NaN
- three.js kan inte rendera

Detta är exakt vad loggen visar: `Modell placerad (V1, avstånd=241081m)` — verken är 241 km borta, vilket är **helt fel** (användaren är i Katrineholm, men projektet "Vindkraftsprojekt" har en 241 km-förskjutning). Detta tyder på att kamera-quaternion är trasig och verken renderas i en helt felaktig position.

### Bugg 2: PlaceTurbines-handoff auto-startar AR

`positionOverride` finns kvar i sessionStorage efter en PlaceTurbines-session. I `Home.tsx:252`:

```ts
const [started, setStarted] = useState(() => positionOverride !== null);
```

Om `positionOverride` är satt vid mount → `started = true` → PermissionGate visas ALDRIG → appen går rakt in i AR-läge. Det är därför användaren "inte kom till startskärmen".

**Båda måste fixas.**

## Säkerhet
- Inga nya beroenden
- Bara `ARScene.tsx` + `Home.tsx`
- Bakåtkompatibelt

---

## ÄNDRING 1 — NaN-skydd i ARScene heading-smoothing

**Fil**: `src/components/ARScene.tsx`

Lokalisera V25-koden (sök efter `smoothedYawDegRef`). Byt ut hela smoothing-blocket mot:

```ts
// V26: NaN-säker heading-smoothing. Tre problem i V25:
//  1. Första frame: smoothedYawDegRef.current === null → delta = NaN → permanent
//  2. Om sensorn ger NaN/∞ sprids det utan stopp
//  3. Ingen recovery om ref:n av någon anledning blir korrupt
const rawYawDeg = ((sensorEuler.y * 180 / Math.PI) % 360 + 360) % 360;

// Helper: returnera true om värdet är ett giltigt tal i [0, 360)
const isValidYaw = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

if (isValidYaw(rawYawDeg)) {
  if (!isValidYaw(smoothedYawDegRef.current)) {
    // Första giltiga frame, eller recovery efter NaN → initiera med rå värdet
    smoothedYawDegRef.current = rawYawDeg;
  } else {
    // EMA med wrap-around-hantering (359° → 1° går via 0°, inte 358°)
    let delta = rawYawDeg - smoothedYawDegRef.current;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    smoothedYawDegRef.current += delta * 0.35;
    // Normalisera och sanity-check
    smoothedYawDegRef.current =
      ((smoothedYawDegRef.current % 360) + 360) % 360;
    if (!isValidYaw(smoothedYawDegRef.current)) {
      // Skydd: om något gick fel, fall tillbaka till rå heading
      smoothedYawDegRef.current = rawYawDeg;
    }
  }
}

// Använd smoothad heading om giltig, annars rå heading
const effectiveYawRad = isValidYaw(smoothedYawDegRef.current)
  ? (smoothedYawDegRef.current * Math.PI) / 180
  : sensorEuler.y;
sensorEuler.y = effectiveYawRad;
sensorEuler.z = 0;
state.camera.quaternion.setFromEuler(sensorEuler);
```

**Varför detta fixar V25-buggen**:
- Första frame: `smoothedYawDegRef.current` är null → `isValidYaw` returnerar false → initieras med `rawYawDeg` direkt
- Om sensorn ger NaN: `isValidYaw(rawYawDeg)` returnerar false → smoothing hoppas över, ref behåller sitt senaste giltiga värde
- Om smoothing av någon anledning producerar NaN: fångas i sanity-check, återställs till rå heading

---

## ÄNDRING 2 — Force PermissionGate efter PlaceTurbines-handoff

**Fil**: `src/pages/Home.tsx`

Problemet: `const [started, setStarted] = useState(() => positionOverride !== null);` gör att AR startar automatiskt om `positionOverride` finns kvar.

**Fix**: använd en **sessionStorage-flagga** som visar om användaren just kommit från PlaceTurbines och aktivt valt att gå till AR. Om inte → Visa PermissionGate först.

Lägg till en ref som en gång-per-mount nollställer start-villkoret:

```ts
// V26: Förhindra att PlaceTurbines-handoff auto-startar AR.
// Tidigare: om `positionOverride` var satt i sessionStorage vid mount
// startade AR direkt, vilket gjorde att PermissionGate aldrig visades.
// Nu: tvinga `started = false` på mount, men BEHÅLL `positionOverride` så
// att `effectiveLat`/`effectiveLon` fortfarande pekar på simulerad plats.
// Användaren trycker "Starta AR" → setStarted(true) som vanligt.
const hasForcedFreshStartRef = useRef(false);
if (!hasForcedFreshStartRef.current) {
  hasForcedFreshStartRef.current = true;
  // En gång per mount: nollställ started om den auto-startade pga handoff
  // (gäller även om positionOverride är null, då vi inte vill ha sidoeffekter)
}
```

Och ändra `started`-initieringen:

**Före (V25-buggen):**
```ts
const [started, setStarted] = useState(() => positionOverride !== null);
```

**Efter (V26):**
```ts
// V26: Börja alltid false, oavsett om positionOverride är satt.
// Användaren måste trycka "Starta AR" i PermissionGate för att starta AR.
// Detta förhindrar att appen auto-startar AR efter en PlaceTurbines-session
// och hoppar över intro/permission-flödet helt.
const [started, setStarted] = useState(false);
```

**MEN** detta betyder att en aktiv PlaceTurbines-session (användaren är i mitten av att placera ut verk) inte auto-startar AR längre. Vi behöver bara auto-starta om `positionOverride` nyss sattes, inte om den är gammal.

Lösning: använd en **ref-baserad engångs-flagga** + en **sessionStorage-flagga** som PlaceTurbines sätter:

```ts
// V26: PlaceTurbines sätter "vindkollen:freshHandoff" i sessionStorage
// INNAN användaren skickas hit. Om flaggan är satt → auto-starta.
// Annars (default efter fresh app-launch) → visa PermissionGate.
const [started, setStarted] = useState(() => {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem("vindkollen:freshHandoff") === "1";
  } catch {
    return false;
  }
});

// Rensa flaggan direkt så att nästa app-launch (utan ny PlaceTurbines-resa)
// INTE auto-startar.
useEffect(() => {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem("vindkollen:freshHandoff");
  } catch {
    // ignore
  }
}, []);
```

Och i `capacitorBridge.ts` (eller där PlaceTurbines anropar navigering till AR), lägg till:

```ts
// Innan navigering: markera som fresh handoff
export function setHandoffActive() {
  try {
    sessionStorage.setItem("vindkollen:freshHandoff", "1");
  } catch {
    // ignore
  }
}
```

Och anropa den i `openSverigekartan` / motsvarande när användaren klickar "Starta AR" eller "Visa i AR" från PlaceTurbines.

**Faktiskt enklare alternativ** (rekommenderas): ta bort hela auto-start-mekanismen. Användaren trycker alltid "Starta AR" manuellt:

```ts
// V26: Alltid false vid mount. PlaceTurbines-handoff sparar sin data
// (turbines, position) i sessionStorage, men användaren måste alltid
// gå via PermissionGate för att starta AR. Detta är enklare, säkrare
// och undviker förvirringen "vart är startskärmen?".
const [started, setStarted] = useState(false);
```

Och i PlaceTurbines, istället för att navigera till AR, navigera till **PermissionGate** (eller Home med `?startArAfterOnboarding=1`). Användaren ser intro, trycker Starta AR, allt är konsekvent.

**Min rekommendation**: använd det **enklare alternativet** ovan. Placera ut-flagga + ref-baserad "från PlaceTurbines just nu"-skydd är onödigt komplext för en bugg som enkelt fixas med "always start at PermissionGate".

---

## Verifiering (efter V26)

1. Bygg om: `pnpm build` + `cap sync ios`
2. **Test NaN-bugg fix** (Ändring 1):
   - Starta AR → inga 241 km-avstånd i loggen
   - Verken visas på rimliga avstånd (1-15 km från Katrineholm)
   - Logg visar korrekt `Modell placerad (V1, avstånd=1300m, ...)` etc.
3. **Test auto-start fix** (Ändring 2):
   - Döda appen helt (swipe upp i app-switcher → swipe bort)
   - Öppna appen igen → **PermissionGate visas** med "Starta AR"-knappen
   - Logg visar INTE `Loaded N turbines` direkt efter `WebView loaded`
   - Användaren trycker "Starta AR" → AR-sessionen börjar som vanligt
4. **Test PlaceTurbines fortfarande fungerar**:
   - Gå till PlaceTurbines (via Meny → "Placera ut vindkraftverken")
   - Sätt en position, välj "Visa i AR" / "Starta AR"
   - Appen ska gå till AR med simulerad position

---

## Leverans
- Ändra: `src/components/ARScene.tsx` (Ändring 1, NaN-skydd)
- Ändra: `src/pages/Home.tsx` (Ändring 2, alltid PermissionGate först)
- Committa som `V26: NaN-skydd i heading-smoothing, alltid PermissionGate först (förhindrar PlaceTurbines auto-start)`
