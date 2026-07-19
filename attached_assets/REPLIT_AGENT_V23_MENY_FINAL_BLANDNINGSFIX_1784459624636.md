# V23 — Meny en gång för alla + AR-exponeringsfix

## Två rotorsaker, en fix

### Problem A: Menyn avklippt (4:e gången!)
**Grundorsaka** (`src/pages/Home.tsx:1945-2025`): Botten-container är en **flex-col** med valfritt antal knappar/widgets (SoundLevel, NoiseImpact, petition, foto, meny). När många visas samtidigt blir innehållet **för högt för skärmen**, och flex pressar sista knappen (Meny) under safe-area-zonen.

**Lösning**: Gör Meny-knappen till en **fristående, alltid-fäst-knapp** Ovanpå safe area-zonen. De andra widgets flyttas till en separat, scrollbar kolumn ovanför.

### Problem B: AR-vyn bländar
**Grundorsaka** (`src/components/ARScene.tsx:836-840`):
```ts
const ambient = new THREE.AmbientLight(0xffffff, 1.1);  // 110% ljus!
const sunLight = new THREE.DirectionalLight(0xffffff, 0.6);  // +60% ljus
// Totalt: 170% ljusstyrka → verken tvättas vita
```

**Lösning**:
1. Sänk ambient till 0.4
2. Sänk directional till 0.3
3. Lägg till ACESFilmic tonemapping (ger filmisk, balanserad exponering)
4. Minska renderer-exposure till 0.8

---

## ÄNDRING 1 — Fast Meny-knapp + scrollbar innehåll (Home.tsx)

**Diagnos**: Hitta botten-container. Sök efter:
```ts
{arSessionVisible && (
<div className="absolute inset-x-0 bottom-0 z-[45]">
```

**Gör så här**:

### 1a. Dela upp bottencontainern i två delar
Hela `flex flex-col gap-3 ... pt-10 pb-[max(3.5rem,...)]`-blocket byts ut mot:

```tsx
{arSessionVisible && (
<div className="pointer-events-none absolute inset-x-0 bottom-0 z-[45] flex flex-col-reverse">
  {/* === MENY-KNAPP (alltid synlig, fast vid safe area) === */}
  {/* pointer-events-auto för att knappen ska gå att trycka på */}
  <div className="pointer-events-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
    <button
      onClick={() => setShowMenu(true)}
      className="w-full rounded-full border border-white/50 bg-white/20 py-3 text-sm font-semibold text-white shadow-sm backdrop-blur-md hover:bg-white/30"
    >
      ☰ Meny
    </button>
  </div>

  {/* === ÖVRIGA KNAPPAR + WIDGETS (scrollbart ovanför Meny) === */}
  {/* Behöver bara ta upp så mycket höjd som finns; om för mycket → scroll */}
  <div className="pointer-events-auto flex max-h-[55vh] flex-col gap-3 overflow-y-auto bg-gradient-to-t from-black/80 to-transparent px-4 pb-3 pt-8">
    {positionOverride && (
      <div className="flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-900/50 px-3 py-1.5 text-xs text-blue-200">
        <span className="flex-1 truncate">
          👤 Simulerad position · {positionOverride.lat.toFixed(4)}°N {positionOverride.lon.toFixed(4)}°E
        </span>
        <button
          onClick={() => setPositionOverride(null)}
          className="shrink-0 font-semibold text-blue-300 hover:text-white"
        >
          ✕ Rensa
        </button>
      </div>
    )}
    {statusBanner && (
      <div className={`rounded-full px-3 py-1.5 text-center text-xs font-medium shadow-md ${statusBannerToneClasses[statusBanner.tone]}`}>
        {statusBanner.message}
      </div>
    )}
    {ready && showSoundLevel && (
      <SoundLevelPanel
        estimate={soundLevelEstimate}
        indoors={soundEnvironment === "inne"}
        onClose={() => setShowSoundLevel(false)}
      />
    )}
    {ready && showNoiseImpact && (
      <NoiseImpactPanel result={noiseImpact} onClose={() => setShowNoiseImpact(false)} />
    )}
    {KATRINEHOLM_PROJECT.campaign?.enabled && activeProject?.projectId === KATRINEHOLM_PROJECT.id && (
      <button
        onClick={() => setShowPetition(true)}
        className="w-full rounded-full bg-[#FF8B01] py-3.5 text-sm font-semibold text-[#090909] shadow-lg shadow-[#FF8B01]/30 hover:bg-[#FFB347]"
      >
        Jag vill skriva på för att få till folkomröstning
      </button>
    )}
    {ready && (
      <button
        onClick={handleCapturePhoto}
        className="w-full rounded-full border border-[#FF8B01]/40 bg-[#FF8B01]/10 py-3 text-sm font-semibold text-[#FFB347] hover:bg-[#FF8B01]/20"
      >
        📸 Fotomontage
      </button>
    )}
  </div>
</div>
)}
```

### Varför detta löser problemet permanent

1. **Meny-knappen är ALLTID synlig** — den är separat, inte i en flex-col med andra knappar. `flex flex-col-reverse` lägger Meny längst ner (under), andra knappar ovanför.
2. **Andra widgets är scrollbara** — `max-h-[55vh] overflow-y-auto`. Tar för mycket plats? Användaren scrollar. Tar lite plats? De syns direkt.
3. **`pb-[max(1rem,env(safe-area-inset-bottom))]`** — Meny-knappen respekterar safe area exakt.
4. **`backdrop-blur-md`** — vacker glassmorphism som matchar övriga UI.

---

## ÄNDRING 2 — AR-exponeringsfix (ARScene.tsx)

### 2a. Minska ljusstyrkan

I `src/components/ARScene.tsx:836-840`, byt ut:

```ts
// Före (V22):
const ambient = new THREE.AmbientLight(0xffffff, 1.1);
scene.add(ambient);
const sunLight = new THREE.DirectionalLight(0xffffff, 0.6);
sunLight.position.set(5, 10, 5);
scene.add(sunLight);

// Efter (V23):
const ambient = new THREE.AmbientLight(0xffffff, 0.4);  // Lugnare basljus
scene.add(ambient);
const sunLight = new THREE.DirectionalLight(0xffffff, 0.3);  // Diskret solljus
sunLight.position.set(5, 10, 5);
scene.add(sunLight);
```

### 2b. Lägg till tonemapping på renderern

I samma fil, efter `renderer.setPixelRatio(...)` (~rad 818), lägg till:

```ts
// V23: Filmmisk tonemapping — förhindrar överexponering i starkt solljus
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;  // Lite underexponerat för att kompensera solljus
renderer.outputColorSpace = THREE.SRGBColorSpace;
```

(Obs: `THREE.ACESFilmicToneMapping` finns i Three.js r150+. Vi har redan r150+, så det fungerar.)

---

## Verifiering

1. Bygg om: `pnpm build` + `cap sync ios`
2. **Test Meny**:
   - Öppna AR, vänta tills alla widgets visas (ljud, brus, petition, foto, meny)
   - Meny-knappen ska vara **helt synlig** längst ner, ovanför home-indikatorn
   - Om widgets tar för mycket plats → scrolla uppåt för att se dem
3. **Test AR-exponering**:
   - Rikta telefonen mot starkt solljus eller ljus himmel
   - Verken ska nu vara **tydligt synliga** med naturlig färg, inte tvättade vita
   - Himlen ska vara blå/grå, inte kritvit
4. **Logg att kolla**: Efter V23 ska `[AR][diagnostik] X/Y verk synliga` visas — `Y` ska vara lägre än tidigare (vi filtrerar till 3km), men `X` ska matcha det faktiska antalet användaren ser.

---

## Leverans
- Ändra: `src/pages/Home.tsx` (ÄNDRING 1)
- Ändra: `src/components/ARScene.tsx` (ÄNDRING 2)
- Inga nya beroenden
- Committa som `V23: fast Meny-knapp utanför flex-col, scrollbar widgets-kolumn, AR tonemapping + lägre ljusstyrka`
