# V18 — Raka verk, direkt respons, helsvart bakgrund

## Kontext
Tre problem i AR-vyn (både riktig AR och simulerat läge):

1. **Verken lutar** — när telefonen hålls ens lite snett (roll-vinkel) roteras hela Three.js-kameran och alla 29 verk ser ut som att de lutar. Detta är fel — vindkraftverk står rakt upp ur marken oavsett hur man håller telefonen.
2. **Släpig respons** — slerp-interpolationen (tau=0.07s, ~210ms till 95%) gör att verken "glider efter" när man vrider telefonen.
3. **Bakgrund i simulerat läge** — `bg-[#090909]` (mörkgrå) istället för svart.

## Lösning

| Problem | Lösning |
|---------|---------|
| Verken lutar (roll) | Nollställ ALLTID kamerans roll-vinkel. Behåll yaw (gir) + pitch för att kunna titta runt/upp/ner. |
| Slerp-släpning | Ta bort slerp helt — sätt kamerans quaternion direkt |
| Mörkgrå bakgrund | `bg-black` i simulerat läge |

---

## ÄNDRING 1 — `ARScene.tsx`: plan kamera (nollställd roll), ingen slerp

Hitta i `animate()`-funktionen (runt rad 1460-1466):

### 1.1 Byt ut kamerarotationsblocket

**Före:**
```ts
cameraTargetQuatRef.current.copy(quaternionRef.current);
{
  const CAMERA_SLERP_TAU = 0.07;
  const slerpFactor = dt > 0 ? 1 - Math.exp(-dt / CAMERA_SLERP_TAU) : 1;
  state.camera.quaternion.slerp(cameraTargetQuatRef.current, slerpFactor);
}
```

**Efter:**
```ts
// V18: Nollställ alltid roll (Z-axeln) — verken ska alltid stå rakt,
// oavsett hur telefonen lutar. Behåll yaw (gir, Y-axeln) så man kan
// vrida sig runt, och pitch (X-axeln) så man kan titta upp/ner.
// Ingen slerp-interpolation — direkt respons, verken följer direkt.
const sensorEuler = new THREE.Euler().setFromQuaternion(quaternionRef.current, "YXZ");
sensorEuler.z = 0; // nollställ roll
state.camera.quaternion.setFromEuler(sensorEuler);
```

**Prestanda-anteckning**: `new THREE.Euler()` varje bildruta är billigt (ett objekt, inga array-allokeringar) och körs ändå redan i samma funktion (se `cameraYawEuler` på rad 1411). Vill man vara helt säker på noll allokering: lägg `const _sensorEuler = new THREE.Euler()` överst i `animate`-blocket och återanvänd.

### 1.2 (Valfritt) Behåll kameradiagnostiken

`cameraYawEuler` (rad 1648) använder `state.camera.quaternion` — den fungerar fortfarande korrekt eftersom vi bara ändrat HUR quaternionen sätts, inte vad den innehåller efteråt. Ingen ändring behövs.

---

## ÄNDRING 2 — `Home.tsx`: helsvart bakgrund i simulerat läge

### 2.1 Byt bakgrundsfärg

Hitta rot-diven (runt rad 1500):

**Före:**
```tsx
<div className={`fixed inset-0 overflow-hidden text-white ${camera.nativePreview ? "bg-transparent" : "bg-[#090909]"}`}>
```

**Efter:**
```tsx
<div className={`fixed inset-0 overflow-hidden text-white ${
  positionOverride !== null ? "bg-black" :
  camera.nativePreview ? "bg-transparent" :
  "bg-[#090909]"
}`}>
```

---

## Verifiering

1. **Riktig AR**: Starta AR från GPS. Håll telefonen snett (rotera medsols/motsols). Vrid telefonen vänster/höger. Verken ska alltid stå lodrätt — ingen lutning. Pitch fungerar (titta upp/ner).

2. **Simulerat läge**: Kartan → öppna projekt → AR. Samma sak: verken raka, direkt respons, helsvart bakgrund.

3. **Ingen regression**: "Visa dolda verk", sol/skugga-lägen, verklig skala, fotomontage — allt fungerar som innan. `cameraYawDeg` i diagnostikloggen rapporterar rätt girvinkel.

4. **Direkt respons**: Vrid telefonen snabbt — verken följer DIREKT, ingen mjuk eftersläpning.

---

## Leverans
- Ändra: `src/components/ARScene.tsx` (rad ~1460-1466 — kamerarotationsblocket)
- Ändra: `src/pages/Home.tsx` (rad ~1500 — bakgrundsfärg)
- Inga nya filer. Inga nya beroenden.
- Committa som `V18: raka verk (nollställd roll), direkt respons (ingen slerp), helsvart bakgrund`.
