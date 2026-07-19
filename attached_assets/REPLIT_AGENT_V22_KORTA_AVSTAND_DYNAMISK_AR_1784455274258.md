# V22 — Korta avstånd + dynamisk skalning + riktningsindikator

## Kontext
Logganalys av V21-test: Användaren befinner sig 25 km från Ericsbergs planer (id=10001). Alla 29 verk rapporteras som "synliga" (`29/29 verk synliga`) men avstånden är 1300-14000m och skalorna 0.4-0.6. Verken är **på rätt plats** men **för långt borta** — de syns som små prickar eller inte alls.

**Kärnproblemet**: 200m vindkraftverk på 25km avstånd = 0.5px på skärmen. Inte användbart.

## Mål
- Visa bara verk inom **3 km radie** (närmaste, tydligast synliga)
- **Skala exponentiellt** så verk på 3km syns lika tydligt som på 100m
- Visa **pil + avståndsbadge** mot närmaste verk som är utanför 3km
- Verken ska kunna **flyttas/flyttas om** automatiskt om användaren rör sig

## Säkerhet
- Inga nya beroenden
- Bara `Home.tsx` + `ARScene.tsx`
- Bakåtkompatibelt: gamla props fungerar fortfarande

---

## ÄNDRING 1 — Filtrera + skala om verk i ARScene

`src/components/ARScene.tsx`

I `setup`-effekten, EFTER att `state.objects` skapats, applicera avståndsbaserad filtrering och skalning:

```ts
// V22: Avståndsbaserad rendering
// - Visa bara verk inom 3km synligt (turbines utanför 3km är "osynliga" men räknas)
// - Skala om exponentiellt: nära verk (100m) = skala 1.0, långt (3km) = skala 1.5
// - Allt utanför 3km → osynligt, men riktningsindikatorn (Home.tsx) pekar dit

const VISIBLE_RADIUS_M = 3000;
const REFERENCE_DISTANCE_M = 500; // avstånd där skala = 1.0

for (const obj of state.objects) {
  const distM = obj.distanceM ?? 0;
  if (distM > VISIBLE_RADIUS_M) {
    // Utanför synligt område — gör osynlig
    obj.group.visible = false;
  } else {
    // Inom synligt område — skala om exponentiellt
    // Vid REFERENCE_DISTANCE_M → skala 1.0
    // Vid VISIBLE_RADIUS_M → skala ~1.5
    const scale = Math.max(0.6, REFERENCE_DISTANCE_M / Math.max(distM, 50));
    obj.group.scale.setScalar(scale);
  }
}
```

**Obs**: `obj.distanceM` måste finnas på varje objekt. Om det inte redan finns, lägg till det i `layoutObjects()`:

```ts
// I layoutObjects, efter att ha beräknat distance:
obj.distanceM = distM; // spara för V22-skalning
```

---

## ÄNDRING 2 — Riktningsindikator + avståndsbadge (Home.tsx)

`src/pages/Home.tsx`

Lägg till state som visar **närmaste verk utanför 3km** med riktning:

```ts
const [nearestFarTurbine, setNearestFarTurbine] = useState<{
  bearing: number; // 0-360°
  distanceM: number;
  name: string;
} | null>(null);
```

Beräkna i en useEffect som triggas när `activeTurbines` ändras:

```ts
useEffect(() => {
  if (!geo.lat || !geo.lon || activeTurbines.length === 0) {
    setNearestFarTurbine(null);
    return;
  }
  // Hitta närmaste verk UTANFÖR 3km (för att visa pil dit)
  const VISIBLE_RADIUS_M = 3000;
  let nearest: typeof activeTurbines[0] | null = null;
  let nearestDist = Infinity;
  for (const t of activeTurbines) {
    const dist = distanceMeters(geo.lat, geo.lon, t.lat, t.lng);
    if (dist > VISIBLE_RADIUS_M && dist < nearestDist) {
      nearest = t;
      nearestDist = dist;
    }
  }
  if (nearest) {
    const bearing = bearingDegrees(geo.lat, geo.lon, nearest.lat, nearest.lng);
    setNearestFarTurbine({ bearing, distanceM: nearestDist, name: nearest.name || "Vindkraftverk" });
  } else {
    setNearestFarTurbine(null);
  }
}, [geo.lat, geo.lon, activeTurbines]);
```

(Obs: `distanceMeters` och `bearingDegrees` finns i `@/lib/geo`.)

UI — en badge som visar "Vindkraftpark 25 km bort åt N":

```tsx
{nearestFarTurbine && (
  <div className="pointer-events-none absolute left-1/2 top-24 z-30 -translate-x-1/2 rounded-full border border-[#FF8B01]/40 bg-black/80 px-4 py-2 text-sm text-white shadow-lg">
    <div className="flex items-center gap-2">
      <svg width="20" height="20" viewBox="0 0 24 24" className="text-[#FF8B01]" style={{ transform: `rotate(${nearestFarTurbine.bearing}deg)` }}>
        <path d="M12 2 L8 12 L12 9 L16 12 Z" fill="currentColor" />
      </svg>
      <span>
        <strong>{Math.round(nearestFarTurbine.distanceM / 100) / 10} km</strong> bort — vrid dig {Math.round(nearestFarTurbine.bearing)}°
      </span>
    </div>
  </div>
)}
```

**Bonus**: När användaren vrider telefonen mot rätt riktning, inom 3km radie, försvinner badget och verken syns (eller flyttas dit).

---

## ÄNDRING 3 — Fixa meny-avklippning

`src/pages/PlaceTurbines.tsx`

**Diagnos**: V20 ändrade `h-[100svh]` till `h-[100dvh]`. Detta var FEL — `100dvh` expanderar när URL-bar/minimized Safari-bar försvinner, vilket gör att innehållet kan "bli avklippt" om layouten är statisk.

**Återställ till `h-[100svh]`** (Small Viewport Height = stabil höjd även när URL-bar försvinner):

```tsx
// Före (V20):
<div className="flex h-[100dvh] w-screen flex-col overflow-hidden">

// Efter (V22):
<div className="flex h-[100svh] w-screen flex-col overflow-hidden">
```

ELLER, om `100svh` inte fungerar heller, använd `h-screen overflow-y-auto` med explicit `pb-[env(safe-area-inset-bottom)]`:

```tsx
<div className="flex h-screen w-screen flex-col overflow-y-auto pb-[env(safe-area-inset-bottom)]">
```

---

## Verifiering

1. **Bygg om** med `PORT=5173 pnpm build` + `cap sync ios`
2. **Starta AR från PermissionGate (riktig AR)**:
   - Logg visar 29 verk, alla inom 25km radie
   - Om alla är >3km borta: badge "25 km bort — vrid dig 180°" högst upp
   - Vrid telefonen mot norr → verken kommer inom synligt område (om avståndet är <3km)
   - Om alla är inom 3km: verken syns direkt, ingen badge
3. **Verkstorlek**:
   - 100m avstånd: skala 1.0 (normal)
   - 1km avstånd: skala 0.5
   - 3km avstånd: skala ~0.17 (men med `Math.max(0.6, ...)` blir det 0.6)
   - Synligt på långt håll men inte gigantiskt
4. **Meny** längst ner: inte avklippt, alltid synlig

---

## Diagnostik (om V22 inte hjälper)

Lägg till i `animate()`:

```ts
if (frameCountRef.current % 60 === 0) {
  const visible = state.objects.filter(o => o.group.visible).length;
  const scales = state.objects.map(o => o.group.scale.x).join(",");
  console.info(`[AR][pipeline] Frame ${frameCountRef.current}: ${visible}/${state.objects.length} synliga, scales=[${scales}]`);
}
```

Detta loggar var 60:e frame hur många verk som är synliga och deras skalor.

---

## Leverans
- Ändra: `src/components/ARScene.tsx` (Ändring 1)
- Ändra: `src/pages/Home.tsx` (Ändring 2)
- Ändra: `src/pages/PlaceTurbines.tsx` (Ändring 3)
- Inga nya filer
- Committa som `V22: korta avstånd i AR, exponentiell skalning, riktningsindikator, fixad meny`
