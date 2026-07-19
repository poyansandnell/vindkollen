# V39 – Replit Agent-instruktioner

Endast **flyghinderlampan** kvar.

## Problem
Efter V37/V38 sitter den röda lampan fortfarande för lågt (mitt på tornet / under rotorbladens topp) i nattläge. Användaren vill ha lampan **högst upp på tornet** — vid den absolute översta punkten (bladspets / totalhöjd).

## Rotorsak
- Lampan sattes tidigare till `hubHeight + 2.2 m` (navcellens tak).
- På avstånd och med forceVisible-skalboost upplevs det fortfarande som mitten av tornet relativt rotorbladens extrema.

## Lösning
Flytta lampan till **totalhöjd** (`heightMeters` = 250 m = bladspets) och behåll V38-pinnen som låser lampan efter forceVisible-scale.

Kodbas: `artifacts/vindkraft-ar-katrineholm/`
Commit kanske redan: `fcbd65f` (V39)

---

## Fil: `src/components/ARScene.tsx`

### 1. Byt konstanten

Hitta:

```ts
const NACELLE_LIGHT_OFFSET_M = 2.2;
```

Byt till:

```ts
// V39: lampan på verkets allra högsta punkt (totalhöjd / bladspets).
const LIGHT_TOP_OFFSET_M = 0;
```

### 2. I `layoutObjects` — preliminär lightY

Hitta raden som sätter `lightY` (strax efter label-positionering). Där finns redan:

```ts
const totalHeightUnits = obj.turbine.heightMeters * METERS_TO_UNITS;
const hubHeightUnits = obj.turbine.hubHeightMeters * METERS_TO_UNITS;
```

Byt lightY-beräkningen från hub till totalhöjd:

```ts
// GAMMALT (V37/V38)
const lightY = y + (hubHeightUnits + NACELLE_LIGHT_OFFSET_M * METERS_TO_UNITS) * scaleDamp;

// NYTT (V39)
// Placera hinderljuset på verkets allra högsta punkt
// (totalhöjd / bladspets) så det inte upplevs mitt på tornet.
const lightY = y + (totalHeightUnits + LIGHT_TOP_OFFSET_M * METERS_TO_UNITS) * scaleDamp;
obj.light.position.set(x, lightY, z);
obj.light.scale.setScalar(Math.max(6 * scaleDamp, 16));
obj.glow.position.set(x, lightY, z);
obj.glow.scale.setScalar(Math.max(26 * scaleDamp, 70));
```

### 3. I `animate()` — pin efter forceVisible-scale

I animate-loopen, **direkt efter** scale-boost-blocket:

```ts
if (obj.forceVisible && obj.renderDistM > 2000) {
  const boost = Math.min(3, obj.renderDistM / 2000);
  obj.group.scale.setScalar(obj.scaleDamp * boost);
} else if (!obj.forceVisible) {
  obj.group.scale.setScalar(obj.scaleDamp);
}
```

...ska detta finnas (byt hub → heightMeters):

```ts
// V39: lås lampan på verkets totalhöjd (bladspets) så den följer
// gruppens aktuella skala/pos (forceVisible-boost + fall-in).
{
  const s = obj.group.scale.x;
  const lightLocalY =
    (obj.turbine.heightMeters + LIGHT_TOP_OFFSET_M) * METERS_TO_UNITS;
  const lightY = obj.group.position.y + lightLocalY * s;
  obj.light.position.set(obj.group.position.x, lightY, obj.group.position.z);
  obj.glow.position.set(obj.group.position.x, lightY, obj.group.position.z);
  obj.light.scale.setScalar(Math.max(6 * s, 16));
  obj.glow.scale.setScalar(Math.max(26 * s, 70));
}
```

Om det fortfarande står `obj.turbine.hubHeightMeters + NACELLE_LIGHT_OFFSET_M` där — byt till `heightMeters + LIGHT_TOP_OFFSET_M`.

---

## Verifiering

```bash
cd artifacts/vindkraft-ar-katrineholm
npx tsc --noEmit
```

Ska vara clean.

## Commit

```bash
git add artifacts/vindkraft-ar-katrineholm/src/components/ARScene.tsx
git commit -m "V39: move obstruction light to total turbine height (blade tip)"
```

---

## Förväntat resultat på enhet (nattläge)
- Röd blinklampa sitter **högst upp** vid rotorbladens oversta spets, inte mitt på tornet
- Följer med även när forceVisible-skalboost växer tornet på 3–6 km
- Inga andra UI-ändringar i denna version

## Obs
- `Obj.light` / `obj.glow` är fristående sprites (inte children av turbine-group) — därför måste de positioneras i världskoordinater efter gruppens scale varje frame.
- Bara is-fronten: `heightMeters` (250) istället för `hubHeightMeters` (169).
