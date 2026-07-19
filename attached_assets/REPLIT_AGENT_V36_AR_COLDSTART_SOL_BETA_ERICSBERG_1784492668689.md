# Replit Agent — V36: AR-kallstart synlighet, sol-tracking, Beta-label, Ericsberg PDF

## Mål (feedback efter V35-test)

1. **Verkliga AR-verk syns inte vid kallstart** — simulerade verk fungerar men i riktig AR dyker de inte upp förrän användaren råkar peka telefonen exakt åt rätt håll.
2. **Solen/sprite sitter fast på skärmen** — följer inte kamerans rotation, speciellt efter att ha legat still en stund.
3. **Beta-märkning saknas** före versionsnumret.
4. **Ericsberg-sektionen och PDF-knapp visas för ALLA projekt** (inte bara Ericsberg), och PDF:en kan inte öppnas på iOS (WKWebView kan inte hantera PDF).

Arbeta i `artifacts/vindkraft-ar-katrineholm/`. Commit: jämför gärna med `V36` i git om den finns; annars applicera nedan 1:1.

---

## Fix 1 — Kallstart: force-visible verk syns direkt i riktig AR

### Problem
Under AR-sessionens första sekunder (`worldLockBlend < 1`) triggas `forceVisibleIds` från kalibreringsfallbacken (800 ms). Men i `animate`-loopen gällde `forceDraw = obj.forceVisible && viewPresence > 0.02` — och `viewPresence` kräver att kameran pekar *nära* turbinen. När telefonen pekas nedåt vid start (vanligt) är `viewPresence = 0` → `forceDraw = false` → inga turbiner ritas. Kunde ta 10+ sekunder innan något syntes om användaren råkade peka åt fel håll.

### Lösning — tre ändringar

**A) `ARScene.tsx` — `forceVisibleCold` i `applyFinalOpacities` (runt rad 1397)**

Hitta:
```ts
      const presence = Math.min(1, Math.max(0, obj.viewPresence));
      const naturalGlobalFactor = occlusionDisabled
        ? 1
        : obj.forceVisible
          ? presence
```

Ersätt med:
```ts
      const presence = Math.min(1, Math.max(0, obj.viewPresence));
      // V36: under de första sekunderna av en AR-session (worldLockBlend < 1)
      // tvingar vi force-visible-verk (rakt-fram-garantin + kalibrerings-
      // fallbacken) till full närvaro oavsett om användaren pekat telefonen
      // exakt åt rätt håll. Det gör att turbinerna dyker upp direkt i
      // verklig AR, men fades fortfarande korrekt mot vinkelstyrd opacitet
      // när blenden går mot 1.
      const forceVisibleCold = obj.forceVisible && worldLockBlendRef.current < 1;
      const effectivePresence = forceVisibleCold ? 1 : presence;
      const naturalGlobalFactor = occlusionDisabled
        ? 1
        : obj.forceVisible
          ? effectivePresence
```

Samma block, lite längre ner — hitta:
```ts
      const forcedSky = obj.forceVisible ? presence : obj.skyFactor;
```

Ersätt med:
```ts
      const forcedSky = obj.forceVisible ? effectivePresence : obj.skyFactor;
```

**B) `ARScene.tsx` — slappna av `forceDraw`-gate under kallstart (runt rad 1818)**

Hitta:
```ts
        // Behåll frustumCulled=false bara medan force fortfarande syns påriktigt
        // (presence > 0) — annars ritas off-axis force-verk som "fastklistrade".
        const forceDraw = obj.forceVisible && viewPresence > 0.02;
```

Ersätt med:
```ts
        // Behåll frustumCulled=false medan force syns, eller under cold-start
        // (worldLockBlend < 1) så kalibreringsfallbackens närmaste verk
        // faktiskt ritas även om de ligger utanför FOV just nu.
        const forceDraw =
          obj.forceVisible && (viewPresence > 0.02 || worldLockBlendRef.current < 1);
```

**C) `Home.tsx` — snabbare kalibreringsfallback (rad 933)**

Hitta:
```ts
  const CALIBRATION_FALLBACK_DELAY_MS = 2000;
```

Ersätt med:
```ts
  const CALIBRATION_FALLBACK_DELAY_MS = 800;
```

### Förväntat beteende
| Situation | Innan V36 | Efter V36 |
|---|---|---|
| Kallstart, pekar nedåt | Inga verk syns (viewPresence=0) | Närmaste verk syns direkt |
| Kallstart, pekar mot verk | Verk syns | Verk syns (oförändrat) |
| Efter 5s, vrider bort | Mjuk fade | Mjuk fade (oförändrat) |

---

## Fix 2 — Sol/sprite fastnar inte på skärmen

### Problem
Kamerans rotation filtrerades med `CAMERA_SLERP_TAU = 0.07` (~210 ms till 95%), vilket är för långsamt — solen "släpar efter" när man vrider telefonen. Dessutom kände `ARScene` inte till `orientationStalled` från `useDeviceOrientation` — om sensorn tillfälligt tystnar (vanligt på iOS) och sen återupptas, hoppar kvaternionen plötsligt men slerp:en mjukar ut hoppet långsamt.

### Lösning

**A) `ARScene.tsx` — prop + interface för `orientationStalled`**

Lägg till i `ARSceneProps`-interfacet, efter `summaryMode?: boolean;` (runt rad 146):
```ts
  /**
   * Juli 2026-fix (V36, "solen sitter fast på skärmen"): signal från
   * `useDeviceOrientation` att inga nya sensor-event har kommit på ett tag.
   * När detta är sant snappar kameran direkt till senaste kända kvaternion
   * istället för att mjuka ut, så sol/sprite inte fastnar kvar om sensorn
   * tillfälligt tystnat.
   */
  orientationStalled?: boolean;
```

**B) Destrukturera + inkludera i BÅDA `modeRef`-ställena**

Första stället — i funktionsparametrarna (runt rad 619), lägg till efter `turbinesVisible = true,`:
```ts
    orientationStalled = false,
```

Andra stället — i `useRef`-initialiseringen (runt rad 652), lägg till efter `turbinesVisible: turbinesVisible ?? true,`:
```ts
    orientationStalled: orientationStalled ?? false,
```

Tredje stället — i `useEffect` för `visible` (runt rad 792), lägg till efter `turbinesVisible: turbinesVisible ?? true,`:
```ts
    orientationStalled: orientationStalled ?? false,
```

**C) Sänk slerp-tau + snappa vid stalled (runt rad 1537)**

Hitta:
```ts
        const CAMERA_SLERP_TAU = 0.07;
        const slerpFactor = dt > 0 ? 1 - Math.exp(-dt / CAMERA_SLERP_TAU) : 1;
        state.camera.quaternion.slerp(cameraTargetQuatRef.current, slerpFactor);
```

Ersätt med:
```ts
        const CAMERA_SLERP_TAU = 0.04;
        // V36: om sensorerna tystnat (rapporterat från useDeviceOrientation)
        // snappar vi kameran direkt till senaste kända kvaternion så att
        // sol/sprite inte fastnar på skärmen.
        const stalled = modeRef.current.orientationStalled;
        const slerpFactor = dt > 0 ? 1 - Math.exp(-dt / CAMERA_SLERP_TAU) : 1;
        state.camera.quaternion.slerp(cameraTargetQuatRef.current, stalled ? 1 : slerpFactor);
```

**D) `Home.tsx` — skicka `orientationStalled` till ARScene (runt rad 1654)**

Hitta:
```tsx
            forceVisibleIds={forceVisibleIds}
            debugForceNearest={debugForceNearest}
```

Ersätt med:
```tsx
            forceVisibleIds={forceVisibleIds}
            orientationStalled={orientation.orientationStalled}
            debugForceNearest={debugForceNearest}
```

### Rör INTE
- `useDeviceOrientation`-logiken som sätter `orientationStalled`
- Slerp-konceptet i sig — bara parametrarna

---

## Fix 3 — Beta-label före versionsnummer (`PermissionGate.tsx`)

Hitta (runt rad 152):
```tsx
                Version {VERSION} · Build {SHORT_HASH}
```

Ersätt med:
```tsx
                Beta Version {VERSION} · Build {SHORT_HASH}
```

---

## Fix 4 — Ericsberg-sektion endast för Ericsberg + PDF via Capacitor Browser

### Problem
`InfoPanel` visade Ericsberg-specifik information och PDF-knapp oavsett vilket projekt användaren tittade på. `window.open()` fungerar inte för PDF:er på iOS eftersom Capacitors WKWebView inte kan öppna/ladda ner PDF-filer.

### Lösning

**A) `InfoPanel.tsx` — acceptera `projectId`, gata Ericsberg-sektionen**

Ersätt hela filens innehåll med:
```tsx
import { KATRINEHOLM_PROJECT } from "@/lib/bundledProjects";
import { openPdf } from "@/lib/capacitorBridge";

export function InfoPanel({ onClose, projectId }: { onClose: () => void; projectId?: number | string }) {
  const showEricsberg =
    projectId != null && String(projectId) === String(KATRINEHOLM_PROJECT.id);

  return (
    <div className="absolute inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md rounded-t-3xl bg-[#111111] p-6 shadow-2xl sm:rounded-3xl">
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-xl font-semibold text-white">Om Vindkollen</h2>
          <button
            onClick={onClose}
            className="shrink-0 rounded-full bg-white/10 p-1.5 text-white hover:bg-white/20"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1 text-sm leading-relaxed text-white/75">
          <p>
            Vindkollen hjälper invånare att se och förstå hur planerade vindkraftsetableringar kan påverka
            landskapet, närboende och lokalsamhället.
          </p>
          <p>
            Genom Sverigekartan, lokala projektvyer och AR-visualisering kan användaren undersöka verkens
            placering, avstånd, riktning, ljudnivå och visuella påverkan direkt från den plats där man
            befinner sig.
          </p>
          <p>
            Målet är att göra information om planerade etableringar mer tillgänglig, tydlig och begriplig —
            så att fler kan bilda sig en egen uppfattning och delta i den lokala demokratiska processen.
          </p>
          <p>
            Vindkollen är utvecklad av{" "}
            <span className="font-medium text-[#FFB347]">@PoyanSandnell</span>. Den första versionen togs
            fram åt Katrineholm Framåt för att visa hur den planerade vindkraftsetableringen nära
            Katrineholms tätort kan påverka staden och dess invånare.
          </p>

          {showEricsberg && (
            <div className="mt-1 border-t border-white/10 pt-3">
              <h3 className="mb-2 text-sm font-semibold text-white">Ericsbergs planer — Katrineholms kommun</h3>
              <p>
                Denna projektvy har tagits fram åt Katrineholm Framåt för att tydliggöra hur den planerade
                etableringen norr om Katrineholm kan upplevas från olika delar av kommunen.
              </p>
              <p className="mt-2">
                Verktyget visar bland annat verkens riktning, avstånd, uppskattad ljudnivå och visuella
                påverkan. Syftet är att ge invånarna ett mer konkret underlag inför den fortsatta
                diskussionen om etableringen.
              </p>
              <button
                onClick={() => {
                  const base = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.trim() ?? "";
                  const url = base
                    ? `${base}/samradsyttrande-forsvarsmakten.pdf`
                    : `${window.location.origin}/samradsyttrande-forsvarsmakten.pdf`;
                  openPdf(url);
                }}
                className="mt-3 flex w-full items-center gap-2 rounded-xl border border-[#FF8B01]/30 bg-[#FF8B01]/10 px-3 py-2 text-left text-sm font-medium text-[#FFB347] hover:bg-[#FF8B01]/20"
              >
                📄 Försvarsmaktens samrådsyttrande (PDF)
              </button>
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          className="mt-5 w-full rounded-full bg-[#FF8B01] py-3 text-sm font-semibold text-[#090909] hover:bg-[#FFB347]"
        >
          Stäng
        </button>
      </div>
    </div>
  );
}
```

**B) `capacitorBridge.ts` — ny `openPdf()`-funktion**

Lägg till före `openSverigekartan`-funktionen (runt rad 17):
```ts
/**
 * Öppnar en PDF i en extern visare.
 *
 * - Native (iOS/Android): använder @capacitor/browser för att öppna filen i
 *   Safari/Chrome, vilket ger korrekt nedladdning/visning av PDF:er.
 * - Webb: faller tillbaka på window.open() i en ny flik.
 */
export async function openPdf(url: string): Promise<void> {
  if (isNative()) {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url, presentationStyle: "popover" });
      return;
    } catch (err) {
      console.error("[Vindkollen] Browser.open failed:", err);
      // Fallback om plugin saknas/är trasigt.
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
```

**C) `Home.tsx` — skicka `projectId` till InfoPanel (runt rad 2294)**

Hitta:
```tsx
      {showInfo && <InfoPanel onClose={() => setShowInfo(false)} />}
```

Ersätt med:
```tsx
      {showInfo && <InfoPanel onClose={() => setShowInfo(false)} projectId={activeProject?.projectId} />}
```

**D) `@capacitor/browser` — installera plugin:**
```bash
pnpm add @capacitor/browser@^8.0.4
```

**E) `scripts/fix-ios-package-swift.js` — CapacitorBrowser symlink + inline target**

I `plugins`-arrayen (runt rad 68), lägg till efter `CapacitorCommunityCameraPreview`:
```js
  { name: 'CapacitorBrowser',               relativeTarget: '../../../../node_modules/@capacitor/browser' },
```

I Package.swift-generationen, lägg till inline target efter `CameraPreviewPlugin`:
```swift
        .target(
            name: "BrowserPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova",   package: "capacitor-swift-pm"),
            ],
            path: "symlinks/CapacitorBrowser/ios/Sources/BrowserPlugin"
        ),
```

Och lägg till `"BrowserPlugin"` i `CapApp-SPM`-targetens dependencies:
```swift
                "CameraPlugin",
                "GeolocationPlugin",
                "CameraPreviewPlugin",
                "BrowserPlugin",
```

**F) Kör native-sync efter alla ändringar:**
```bash
pnpm cap sync
```

Detta triggar automatiskt `fix-ios-package-swift.js` via `capacitor:sync:after`-hooken.

---

## Verifiering

1. `npx tsc --noEmit` rent — inga TypeScript-fel
2. `pnpm cap sync` körs utan fel, Package.swift innehåller BrowserPlugin
3. På enhet:
   - Öppna AR för första gången → verk syns direkt även om telefonen pekas nedåt
   - Vrid telefonen → sol/sprite följer kameran direkt (ingen eftersläpning)
   - Botten av startskärmen visar "Beta Version X · Build abc123"
   - Öppna InfoPanel för Katrineholm-projekt → Ericsberg-sektion syns
   - Öppna InfoPanel för annat projekt → Ericsberg-sektion syns INTE
   - Tryck på PDF-knappen → öppnas i Safari (inte fast i WKWebView)

---

## Commit-meddelande (förslag)

```
V36: real-AR early visibility, sun tracking, Beta label, Ericsberg PDF
```

## Filer som ändras
- `src/components/ARScene.tsx` — forceVisibleCold, effectivePresence, forceDraw cold-start, orientationStalled prop, slerp tau 0.04 + snap
- `src/pages/Home.tsx` — CALIBRATION_FALLBACK_DELAY_MS 800, orientationStalled passthrough, projectId passthrough
- `src/components/InfoPanel.tsx` — projectId-gating, openPdf()
- `src/lib/capacitorBridge.ts` — ny openPdf()
- `src/components/PermissionGate.tsx` — "Beta" prefix
- `package.json` + `pnpm-lock.yaml` — @capacitor/browser@^8.0.4
- `scripts/fix-ios-package-swift.js` — CapacitorBrowser symlink + BrowserPlugin target
- `ios/App/CapApp-SPM/Package.swift` — regenereras av cap sync + fix-ios
- `ios/App/CapApp-SPM/symlinks/CapacitorBrowser` — ny symlink (skapas av fix-ios)
