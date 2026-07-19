# Replit Agent — V35: force-fade + bottenmeny edge-to-edge

## Mål (feedback efter V34-test)

1. **Vindsnurror hänger kvar för länge** när man vrider bort telefonen. De kommer fram snabbt (bra) men ska bli **transparenta utanför FOV/kompassriktning**.
2. **Nedre menyn börjar fortfarande** — den svarta rutan ska följa **hela vägen ner** till skärmkanten (home-indicator).

Arbeta i `artifacts/vindkraft-ar-katrineholm/`. Commit: jämför gärna med `V35` i git om den finns; annars applicera nedan 1:1.

---

## Fix 1 — Vinkellänkad fade av force-visible (`ARScene.tsx`)

### Problem
`forceVisible` (rakt-fram ±25° **eller** `forceVisibleIds` från 2s-kalibreringsfallback) satte opacitet/sky till **1.0 oberoende av vinkel**. När användaren vred bort kameran fanns verken kvar som “fastklistrade”.

### Lösning
Lägg till:

```ts
const FORCE_FADE_OUT_DEG = IN_VIEW_HALF_ANGLE_DEG + 18; // ~50.5°
```

På `TurbineObject`:

```ts
viewPresence: number; // 0..1
```

Init: `viewPresence: 0`.

**I `animate`, efter `angleFromOpticalAxisDeg`:**

```ts
let viewPresence = 0;
if (angleFromOpticalAxisDeg !== null) {
  if (angleFromOpticalAxisDeg <= IN_VIEW_HALF_ANGLE_DEG) {
    viewPresence = 1;
  } else if (angleFromOpticalAxisDeg >= FORCE_FADE_OUT_DEG) {
    viewPresence = 0;
  } else {
    viewPresence =
      1 -
      (angleFromOpticalAxisDeg - IN_VIEW_HALF_ANGLE_DEG) /
        (FORCE_FADE_OUT_DEG - IN_VIEW_HALF_ANGLE_DEG);
  }
}
obj.viewPresence = viewPresence;

obj.forceVisible =
  (nearCenter && obj.renderDistM <= MAX_RENDER_DISTANCE_M) ||
  modeRef.current.forceVisibleIds.has(obj.turbine.id);

const forceDraw = obj.forceVisible && viewPresence > 0.02;
for (const mesh of obj.cachedMeshes) {
  mesh.frustumCulled = !forceDraw;
}
```

**I `applyFinalOpacities`:** när `forceVisible` — använd `presence` istället för hård `1`:

```ts
const presence = Math.min(1, Math.max(0, obj.viewPresence));
const naturalGlobalFactor = occlusionDisabled
  ? 1
  : obj.forceVisible
    ? presence
    : modeRef.current.hideAll
      ? INDOOR_DIM_FACTOR
      : Math.max(modeRef.current.globalVisibilityFactor, MIN_CONFIDENCE_VISIBILITY_FACTOR);

// Force-path hoppar worldLockBlend-boost till 1 (annars hänger fallback kvar off-axis)
const globalFactor = obj.forceVisible
  ? naturalGlobalFactor
  : 1 + (naturalGlobalFactor - 1) * worldLockBlend;

const forcedSky = obj.forceVisible ? presence : obj.skyFactor;
const naturalSkyFactor = occlusionDisabled
  ? 1
  : forcedSky * (obj.forceVisible ? 1 : naturalGlobalFactor);

const skyFactor = (obj.forceVisible
  ? naturalSkyFactor
  : 1 + (naturalSkyFactor - 1) * worldLockBlend) * turbinesVisibleFactor;
```

Samma `obj.viewPresence` i skuggans `shadowGlobalFactor` när `forceVisible`.

### Rör INTE
- `NEAR_CENTER_FORCE_DEG`, FOV-core, frustum-kärna utöver presence-gaten ovan
- Home `calibrationFallbackActive` / `forceVisibleIds`-logic (den får vara kvar; fade sker i ARScene)

### Förväntat beteende
| Situation | Resultat |
|-----------|----------|
| Verk rakt fram i FOV | Full opacity (snabbt synliga som idag) |
| Vrider bort, vinkel > FOV/2 | Mjuk fade |
| Vinkel ≥ FOV/2+18° eller bakom kamera | Helt transparent |
| forceVisibleIds off-axis | Samma fade — ingen “fastklistring” |

---

## Fix 2 — Bottenmeny edge-to-edge

### A) `capacitor.config.ts`
```ts
ios: {
  contentInset: "never",  // was "automatic"
  backgroundColor: "#00000000",
},
```
**Varför:** `automatic` krympte WKWebView ovanför home-indicator → CSS kunde inte måla den zonen. Med `never` fungerar `env(safe-area-inset-*)` och full-bleed HUD.

**OBS:** Efter ändring: `npx cap sync ios` (eller er native-build-pipeline). Enkel web-reload räcker **inte**.

### B) `Home.tsx` — AR bottom controls
Ersätt den gamla gradient-diven med:

1. **Solid svart underlay** absolut botten:
```tsx
<div
  aria-hidden
  className="pointer-events-none absolute inset-x-0 bottom-0 bg-black"
  style={{ height: "max(34px, env(safe-area-inset-bottom, 0px))" }}
/>
```

2. **Kontroller** med relativ gradient + safe padding på knapparna (inte jätte-padding som “lyfter bort” bakgrunden):
```tsx
<div className="relative flex flex-col gap-3 bg-gradient-to-t from-black from-30% via-black/90 to-transparent px-4 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] pt-10">
  …statusBanner / knappar…
</div>
```

### C) Meny-sheet
- `bg-[#111]` (solid, inte `/95`)
- `paddingBottom: max(1.25rem, env(safe-area-inset-bottom, 0px))`

Topp-baren har redan `env(safe-area-inset-top)` — behåll den (behövs mer med `contentInset: never`).

---

## Verifiering

1. `npx tsc --noEmit` rent
2. Native rebuild + cap sync
3. På enhet:
   - Starta AR → verk dyker upp snabbt i FOV
   - Vrid bort 90° → verk tonas bort / blir ej “fast”
   - Botten: svart yta når hemindikatorn; knappar ovanför safe-area
   - Öppna Meny: sheet når botten, ingen kameraremsa under

## Commit-meddelande (förslag)

```
V35: vinkellänkad force-fade + bottenmeny edge-to-edge
```

## Filer
- `src/components/ARScene.tsx`
- `src/pages/Home.tsx`
- `capacitor.config.ts`
