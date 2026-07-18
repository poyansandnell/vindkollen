# V13: Fixa "Öppna Sverigekartan"-knappar på native

Klistra in hela detta dokument i Replit Agent. Applicera ALLA ändringar exakt.

---

## BAKGRUND

Det finns **5 ställen** som anropar `openSverigekartan()`. På native gör denna funktion:
1. Öppnar SFSafariViewController via `@capacitor/browser` → **misslyckas med UNIMPLEMENTED** (plugin fungerar inte i denna build)
2. Faller tillbaka till `window.location.hash = "/placera"`
3. Men eftersom `placeraFresh` sätts → PlaceTurbines mountas → showWelcome=true → NationalMapView renderas → ser ut som **inget hände**

Detta är varför knapparna "gör inget" på din iPhone — de navigerar till samma sida du redan är på.

**Fix:** Ersätt `openSverigekartan()` med rätt direkt navigation beroende på kontext.

---

## ÄNDRING 1: `src/lib/capacitorBridge.ts` — Lägg till ny funktion

**Hitta** funktionen `openSverigekartan()` (runt rad 32). **Ersätt HELA funktionen** med denna utökade version som även hanterar "gå tillbaka till kartan"-fallet:

```ts
/**
 * Öppnar Sverigekartan.
 *
 * - Webb: navigerar direkt till /vindkraft-karta/ (path routing).
 * - Native: öppnar vindkollen.com/vindkraft-karta/ i ett in-app
 *   SFSafariViewController-ark via @capacitor/browser. När det pluginet
 *   inte är tillgängligt (vilket är fallet i vår nuvarande build) faller
 *   vi tillbaka till native PlaceTurbines (MapLibre + projektväljaren)
 *   med auto-fokus på närmaste projekt.
 */
export async function openSverigekartan(): Promise<void> {
  if (isNative()) {
    const url = "https://vindkollen.com/vindkraft-karta/";
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url, presentationStyle: "fullscreen" });
    } catch (err) {
      console.warn("[Vindkollen] Browser.open misslyckades, faller tillbaka till /placera:", err);
      void stopNativeCameraPreview();
      // V13: sätt FOKUS-flagga också, så NationalMapView auto-fokuserar på närmaste projekt
      sessionStorage.setItem("vindkollen:sverigekartanFocusNearest", "1");
      sessionStorage.setItem("vindkollen:placeraFresh", "1");
      window.location.hash = "/placera";
    }
  } else {
    window.location.href = "/vindkraft-karta/";
  }
}
```

Viktigt: vi behöver INTE skapa en ny funktion — vi ändrar bara fallback-vägen i `openSverigekartan()` så att den sätter fokus-flaggan också.

---

## ÄNDRING 2: `src/pages/PlaceTurbines.tsx` — Fixa "← Sverigekartan"-knappen

Detta är knappen som visas i editorn när man zoomar ut (latSpan > 0.18).

**Hitta** (runt rad 898–901):

```tsx
<button
  onClick={openSverigekartan}
  ...
>
  🗺️ Vill du gå tillbaka till Sverigekartan?
</button>
```

**Ersätt med** (vi är redan på /placera — behöver bara visa NationalMapView):

```tsx
<button
  onClick={() => setShowWelcome(true)}
  ...
>
  🗺️ Vill du gå tillbaka till Sverigekartan?
</button>
```

---

## ÄNDRING 3: `src/pages/PlaceTurbines.tsx` — Ta bort dubbletten i useEffect

**Hitta** (runt rad 650–657) — en useEffect som både sätter showWelcome=true OCH anropar openSverigekartan:

```tsx
// Vi är redan på #/placera — setShowWelcome(true) visar NationalMapView
setShowWelcome(true);
openSverigekartan();
```

**Ersätt med** (ta bort `openSverigekartan()`-anropet, det är redundant och fel):

```tsx
// Vi är redan på #/placera — setShowWelcome(true) visar NationalMapView
setShowWelcome(true);
```

**VIKTIGT:** Ta bort `import { openSverigekartan }` från toppen av PlaceTurbines.tsx om det inte används på andra ställen. Kontrollera med: `grep -n "openSverigekartan" pages/PlaceTurbines.tsx` — om det bara fanns på rad 656 och 901, ta bort hela importen.

---

## ÄNDRING 4: `src/components/PermissionGate.tsx` — B4-knappen

**Hitta** (runt rad 131–137):

```tsx
<button
  onClick={openSverigekartan}
  ...
>
  🗺️ Sverigekartan – Öppna kartverktyg
</button>
```

**Ersätt med** (sätt båda flaggorna + navigera):

```tsx
<button
  onClick={() => {
    sessionStorage.setItem("vindkollen:sverigekartanFocusNearest", "1");
    sessionStorage.setItem("vindkollen:placeraFresh", "1");
    if (isNative()) {
      void stopNativeCameraPreview();
    }
    window.location.hash = "/placera";
  }}
  ...
>
  🗺️ Sverigekartan – Öppna kartverktyg
</button>
```

**Lägg till** `stopNativeCameraPreview` till importen (om den inte redan finns):

```tsx
import { openPlaceraEditor, openSverigekartan, stopNativeCameraPreview } from "@/lib/capacitorBridge";
```

Och `isNative` om det inte finns:

```tsx
import { isNative } from "@/lib/capacitorBridge";
```

---

## ÄNDRING 5: `src/pages/Home.tsx` — Båda "🗺️ Öppna Sverigekartan"-knapparna

**Hitta** (runt rad 1822–1827 och 2121–2126), det finns två knappar med samma beteende. Båda har `onClick={openSverigekartan}`.

**Ersätt BÅDA** med:

```tsx
onClick={() => {
  sessionStorage.setItem("vindkollen:sverigekartanFocusNearest", "1");
  sessionStorage.setItem("vindkollen:placeraFresh", "1");
  if (isNative()) {
    void stopNativeCameraPreview();
  }
  window.location.hash = "/placera";
}}
```

**Lägg till** import för `isNative` och `stopNativeCameraPreview` om de inte redan finns i Home.tsx.

---

## SAMMANFATTNING

| Fil | Ändring |
|-----|---------|
| `src/lib/capacitorBridge.ts` | `openSverigekartan()`-fallback sätter nu FOKUS-flagga också |
| `src/pages/PlaceTurbines.tsx` rad 901 | `openSverigekartan` → `() => setShowWelcome(true)` |
| `src/pages/PlaceTurbines.tsx` rad 656 | Ta bort `openSverigekartan()`-anropet |
| `src/components/PermissionGate.tsx` rad 133 | `openSverigekartan` → inline direkt navigation |
| `src/pages/Home.tsx` rad 1824 + 2123 | `openSverigekartan` → inline direkt navigation |

---

## VALIDERINGSKRITERIER

Efter dessa ändringar:

1. **PermissionGate "🗺️ Sverigekartan – Öppna kartverktyg"** → navigerar till native PlaceTurbines (MapLibre + auto-fokus på närmaste projekt), INTE SFSafariViewController
2. **Home "🗺️ Öppna Sverigekartan – välj projekt"** → samma som ovan
3. **Home "🗺️ Sverigekartan – Öppna kartverktyg"** (i "Visa karta"-sektionen) → samma som ovan
4. **PlaceTurbines "🗺️ Vill du gå tillbaka till Sverigekartan?"** (visas när man zoomar ut i editorn) → visar NationalMapView med alla 3587 projekt, INTE laddar om samma editor-sida
5. **Inga `Browser.open misslyckades` i loggen** vid knapptryck

---

## EFTER ÄNDRINGAR

1. Visa diff för alla ändrade filer
2. Kör typecheck (`pnpm typecheck` eller `tsc --noEmit`)
3. Rör INGA andra filer
4. Bygg INTE om — vänta på OK
5. Committa med meddelande: `V13: fixa native-navigation för Sverigekartan-knappar`
