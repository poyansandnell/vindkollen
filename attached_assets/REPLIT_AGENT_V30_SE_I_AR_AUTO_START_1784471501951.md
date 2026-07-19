# V30 — "Se i AR" auto-start vid positionOverride (regression från V27)

## Sammanfattning
Efter V27 fungerar inte längre flödet **PlaceTurbines → "👤 Se härifrån" → ✓ bekräfta position → "👁️ Se i AR"**. Användaren möts av PermissionGate igen utan att förstå att de måste klicka "Starta AR" en gång till. V30 auto-startar AR i simulerat läge så att flödet öppnar AR-vyn direkt.

---

## Bakgrund — varför hände detta?

I V27 ändrades `Home.tsx` rad 252:
```ts
// FÖRE (V26):
const [started, setStarted] = useState(() => positionOverride !== null);

// EFTER (V27):
const [started, setStarted] = useState(false);
```

**V26 var trasigt** — när `positionOverride` var satt (PlaceTurbines-handoff) så sattes `started=true` vid mount → `handleStart()` kördes aldrig → `startCalibrationTracking()` anropades aldrig → `arSessionVisible` förblev `false` → simulator-AR startade aldrig.

**V27 fixade det** genom att alltid börja i `started=false` så att användaren måste klicka "Starta AR" i PermissionGate. Detta fungerar i manuellt läge, men **bryter auto-flödet** från PlaceTurbines — användaren förväntar sig att "Se i AR" öppnar AR-vyn direkt.

---

## Mål
`handleStart()` ska köras automatiskt vid mount i de fall där användaren uttryckligen bad om AR via PlaceTurbines (`positionOverride !== null`), men **aldrig** vid mount i vanligt "närmaste verk"-flöde (där positionOverride är null).

---

## Exakta ändringar i `src/pages/Home.tsx`

### Ändring 1 — Lägg till `autoStartRef` direkt efter `starting`-state (ca rad 254)

Hitta:
```ts
  const [started, setStarted] = useState(false); // V27: Alltid false vid mount, oavsett positionOverride
  const [starting, setStarting] = useState(false);
  // Fel från sekventiell native behörighetsförfrågan — visas i PermissionGate.
  const [nativePermError, setNativePermError] = useState<string | null>(null);
```

Lägg till detta block direkt efter `const [starting, setStarting] = useState(false);`:
```ts
  // V30: autoStartRef förhindrar att auto-start-effekten kör handleStart mer
  // än en gång per mount (även om positionOverride/startats skulle fluktuera
  // p.g.a. asynkrona state-uppdateringar). Utan detta kan användaren råka
  // utdubblera permission-prompts och LoadingSequence.
  const autoStartRef = useRef(false);
```

**Krav**: `useRef` måste redan vara importerat. Om inte, lägg till `useRef` i befintlig `import { useState, useEffect, useRef, ... }` från `react` överst i filen.

### Ändring 2 — Lägg till auto-start useEffect direkt efter det befintliga `useEffect` som slutar med `}, [orientation, starting, hasOnboarded]);` (ca rad 1378)

Hitta slutet av det useEffect som hanterar `setStarting` beroende på `orientation`:
```ts
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orientation, starting, hasOnboarded]);
```

Lägg till detta block direkt efter det:
```ts

  // V30: Auto-starta AR i simulerat läge (PlaceTurbines "Se härifrån" →
  // "Se i AR"-flödet). V27 ändrade useState till false så att alltid
  // PermissionGate visas först — detta var nödvändigt för att handleStart()
  // skulle köras (annars sattes aldrig startCalibrationTracking och
  // arSessionVisible förblev false). Men det bröt auto-flödet från
  // PlaceTurbines: användaren tryckte "Se i AR" och såg PermissionGate igen
  // utan att förstå att de behövde klicka "Starta AR" en gång till.
  //
  // Lösningen: när positionOverride är satt (PlaceTurbines-handoff), anropa
  // handleStart() automatiskt vid mount. handleStart() triggar precis samma
  // finish()-väg som ett manuellt klick (web path: parallella geo/media-
  // permissions, sedan finish → setStarted(true)) — så V27-fixen bevaras
  // och PlaceTurbines-flödet fungerar igen.
  useEffect(() => {
    if (positionOverride === null) return; // inte simulerat läge
    if (started || starting) return; // redan startat
    if (autoStartRef.current) return; // redan försökt
    autoStartRef.current = true;
    console.log("[AR] V30: auto-starting handleStart (simulated mode from PlaceTurbines)");
    // Mikrosekund-fördröjning: låt PermissionGate hinna mountas en frame så
    // setStarting(true) i handleStart inte konkurrerar med PermissionGate:s
    // disabled={starting}-tillstånd i samma batch.
    const t = window.setTimeout(() => { handleStart(); }, 50);
    return () => window.clearTimeout(t);
  // handleStart är stabil useCallback — vi vill bara köra en gång per mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

---

## Verifiering

### 1. TypeScript-kompilering
Kör:
```bash
cd artifacts/vindkraft-ar-katrineholm && npx tsc --noEmit 2>&1 | grep -v "Cannot find type definition" | head -30
```
**Förväntat**: inga utdata (eller enbart pre-existing missing types som `@types/node`, `vite-plugin-pwa/client`, `vite/client`).

### 2. Manuell verifiering
Kör appen i iOS-simulatorn och testa **exakt detta flöde**:
1. Öppna appen (visar "Välj projekt" eller landningsskärm)
2. Välj ett projekt (helst **Katrineholm Vind by Ericsberg** eller liknande nära — Vindkraftsprojekt 188 km bort syns knappt)
3. Tryck "👤 Se härifrån" på en turbin → position-pinnen flyttas
4. Tryck "✓" / bekräfta position
5. Tryck "👁️ Se i AR"

**Förväntat resultat**:
- Kort permission-prompt (web-bläddrarens standarddialog för location + camera, eller bara en kort loading om användaren redan godkänt tidigare)
- LoadingSequence visas (3-2-1 + checklista)
- AR-scenen öppnas **direkt** med turbinen synlig framför kameran
- Console-loggen innehåller: `[AR] V30: auto-starting handleStart (simulated mode from PlaceTurbines)`

**Innan V30**: Användaren möttes av PermissionGate med knappen "📷 Starta AR" — ingenting hände om de inte klickade igen.

### 3. Negativ test — vanligt flöde ska INTE påverkas
Gå tillbaka till Home, välj "Vindkraftverk närmast dig" / "Närmaste verk" (det flöde som INTE kommer från PlaceTurbines).
**Förväntat**: PermissionGate visas som vanligt, användaren måste klicka "Starta AR" manuellt (V27-beteendet bevarat).
- `positionOverride` ska vara `null` i detta fall → V30-useEffect returnerar direkt → ingen auto-start.

### 4. dubbel-mount-säkerhet
Ladda om sidan mitt i PlaceTurbines-handoff (DevTools → Network: throttling "Slow 3G" → klicka "Se i AR" → refresh) och kontrollera att LoadingSequence inte startas två gånger och att permission-prompts inte dubbleras. `autoStartRef` ska skydda mot detta.

---

## Varför detta är rätt approach

| Alternativ | Problem |
|---|---|
| Återställ V26 (auto-`started=true` när positionOverride satt) | Hela V27-regressionen kommer tillbaka: `handleStart` körs inte, AR startar aldrig |
| Ta bort PermissionGate helt i simulerat läge | Tappar native permission-flödet som V18–V19 byggde upp; native iOS-promptar försvinner |
| **Auto-`handleStart` när positionOverride (V30)** | **Kör samma kod som manuellt klick — bevarar både V27-fix och PlaceTurbines-auto-flöde** |

`handleStart` är redan en stabil `useCallback`, så detta är ett minimum-invasive tillägg: en `useRef` + ett `useEffect` med tomma deps. Inga ändringar i `handleStart`, `PermissionGate`, `PlaceTurbines` eller `ARScene` behövs.

---

## Riskbedömning

- **Låg risk**: Effekten har tomma deps och skyddas av `autoStartRef.current`, så worst case är att den körs en extra gång i en åter-montering → PermissionGate blinkar till men ingen korrupt data.
- **Ingen påverkan på native (iOS)**: `handleStart` har redan native-fallbacks (Capacitor Permissions, etc.) — inget nytt fel-läge introduceras.
- **Ingen påverkan på vanligt flöde**: `positionOverride === null`-grenen returnerar omedelbart, så effekten är en no-op för icke-simulerat läge.

---

## Commit-meddelande
```
V30: auto-trigger handleStart when positionOverride is set at mount

Restores PlaceTurbines "Se härifrån → Se i AR" auto-flow that V27's
always-show-PermissionGate change inadvertently broke.

V27 was correct in principle — V26's auto-started=true at mount
when positionOverride was set skipped handleStart(), so
startCalibrationTracking() never ran and arSessionVisible stayed
false. V30 preserves that fix by explicitly calling handleStart()
once per mount when positionOverride is set, so the same finish()
path as a manual click runs (parallel geo/media permissions, then
finish → setStarted(true)).

Adds a useRef (autoStartRef) guard to prevent double-execution
during async state churn, and a 50ms setTimeout so PermissionGate
mounts one frame before setStarting(true) flips its button.
```
