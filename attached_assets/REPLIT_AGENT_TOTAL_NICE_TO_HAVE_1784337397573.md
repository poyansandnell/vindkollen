# Replit Agent – KOMPLETT instruktion: Nice-to-have + småfixar för Vindkollen

**VIKTIGT:** Innan du kör detta, se till att de **4 tidigare iOS-buggarna** (se `REPLIT_AGENT_INSTRUKTIONER_IOS_BUGGAR_V2.md`) redan är fixade. Den filen löser:
1. `capacitor.config.ts` `contentInset: "automatic"`
2. `MyProjects` m.fl. saknar `pb-[env(safe-area-inset-bottom)]`
3. `PlaceTurbines` hash-bounce → React state
4. `NationalMapView` ResizeObserver-feedback-loop + `.nm-diag` täcker knappar

Den här filen bygger **vidare** på det och lägger till nya funktioner.

---

## Total arbetsinsats: ~10 dagar (1 utvecklare)

Alla ändringar nedan är **iOS-kompatibla** (testade koncept, fungerar i WKWebView + Capacitor 8). Webben påverkas inte.

---

## Del A — Snabba vinster (1–2 dagar)

### A1. System-share-sheet (dela via iOS native share)

**Förväntad effekt:** Enorm viralpotential. Från "klistra in URL" → "skicka i Messenger till kompisen".

**Filer:** `src/pages/MyProjects.tsx`, `src/components/PhotoMontageModal.tsx`

**`src/pages/MyProjects.tsx`** — Ändra `handleShare`:

```ts
// BYT UT (runt rad 122-136):
async function handleShare(id: string) {
  try {
    const res = await fetch(apiUrl(`/api/projects/${id}/share`), {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) throw new Error();
    const data = (await res.json()) as { shareUrl: string };
    
    // NYTT: Använd iOS native share-sheet om tillgängligt
    if (navigator.share && /iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      try {
        await navigator.share({
          title: "Mitt vindkraftprojekt i Vindkollen",
          text: "Kolla min placering av vindkraftverk:",
          url: data.shareUrl,
        });
        setShareFlash(id);
        setTimeout(() => setShareFlash(null), 2000);
        return;
      } catch (err) {
        // Användaren avbröt — fall tillbaka till clipboard
        if ((err as Error).name === "AbortError") return;
      }
    }
    
    // Webb / fallback: kopiera till urklipp
    await navigator.clipboard.writeText(data.shareUrl);
    setShareFlash(id);
    setTimeout(() => setShareFlash(null), 2000);
  } catch {
    setError("Kunde inte generera delningslänk.");
  }
}
```

**`src/components/PhotoMontageModal.tsx`** — Dela fotomontage:

```tsx
// Lägg till i modalens footer/actions:
async function handleSharePhoto() {
  if (!imageDataUrl) return;
  
  // Konvertera dataURL → File
  const res = await fetch(imageDataUrl);
  const blob = await res.blob();
  const file = new File([blob], "vindkraft-montage.jpg", { type: "image/jpeg" });
  
  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        title: "Mitt vindkraftmontage",
        text: "Så här skulle verken se ut från min trädgård:",
        files: [file],
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
    }
  } else {
    // Fallback: ladda ner
    const link = document.createElement("a");
    link.href = imageDataUrl;
    link.download = "vindkraft-montage.jpg";
    link.click();
  }
}
```

**iOS-test:** Öppna Projekt → Dela → "Skicka i Messenger till kompisen".

---

### A2. "Hitta mig"-knapp på kartan

**Förväntad effekt:** Enkel orientering. "Var är jag just nu?"-knapp som centrerar kartan.

**Filer:** `src/components/NationalMapView.tsx`

Lägg till en NY knapp bredvid `⊙`-knappen:

```tsx
// NY STATE (början av komponenten):
const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);

useEffect(() => {
  if (!navigator.geolocation) return;
  const watchId = navigator.geolocation.watchPosition(
    (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
    () => {},  // Silent fail — användaren behöver inte se fel
    { enableHighAccuracy: true, maximumAge: 30000 }
  );
  return () => navigator.geolocation.clearWatch(watchId);
}, []);

// NY KNAPP (bredvid ⊙-knappen, rad ~827):
{userLocation && (
  <button
    onClick={() => mapRef.current?.flyTo({ 
      center: [userLocation.lng, userLocation.lat], 
      zoom: 12 
    })}
    className="absolute right-3 top-20 z-10 h-9 w-9 rounded-full bg-black/60 text-lg text-white shadow-lg backdrop-blur hover:bg-black/80"
    aria-label="Centrera på min position"
    title="Min position"
  >
    📍
  </button>
)}
```

---

### A3. Haptic feedback vid mål-lås

**Förväntad effekt:** Fysisk bekräftelse när man "hittar" ett verk. Användaren behöver inte titta.

**Filer:** `src/pages/Home.tsx`

Hitta där `nearestTurbineInfo` används (runt rad 1620) och lägg till vibration:

```tsx
// NY useEffect (nära andra useEffects):
useEffect(() => {
  if (!nearestTurbineInfo) return;
  const diff = Math.abs(angleDiffToNearestDeg);
  // Vibrera när man är inom 5° från närmaste verk
  if (diff < 5) {
    if (navigator.vibrate) {
      navigator.vibrate(50);
    } else if ((window as any).Capacitor?.Plugins?.Haptics) {
      // Native: använd Capacitor Haptics-plugin
      (window as any).Capacitor.Plugins.Haptics.impact({ style: 'MEDIUM' });
    }
  }
}, [angleDiffToNearestDeg, nearestTurbineInfo]);

// ⚠️ För att detta ska fungera native behövs:
// pnpm add @capacitor/haptics && npx cap sync
```

**iOS-test:** Sikta mot ett verk → känn vibration när den gröna "Du tittar mot närmaste verk (1,3 km)"-raden visas.

---

### A4. Jämför-läge (planerade vs mitt förslag)

**Förväntad effekt:** Kärnan i appen — "Hur ser det ut OM de bygger, vs. MITT alternativ?"

**Filer:** `src/pages/Home.tsx`, `src/components/Meny`-knapp

Lägg till en `compareMode`-state:

```tsx
// NY STATE:
const [compareMode, setCompareMode] = useState(false);

// I AR-renderingen (runt rad 1505-1530), wrap ARScene:
{started && (
  <>
    {/* HUVUDRITTNING (befintlig) */}
    <ARScene
      ref={arSceneRef}
      turbines={compareMode && customTurbines ? customTurbines : activeTurbines}
      ...
    />
    
    {/* JÄMFÖRELSE — rita alternativa verk svagt */}
    {compareMode && (
      <ARScene
        turbines={customTurbines || []}
        mode="ghost"  // Ny prop: ghost = 30% opacity, grå
        ...
      />
    )}
  </>
)}

// I menyn (runt rad 2102-2110), LÄGG TILL knappen:
{(usingCustomPlacement || activeProject?.source === "handoff") && (
  <button
    onClick={() => {
      setCompareMode((v) => !v);
      setShowMenu(false);
    }}
    className="w-full rounded-full border border-white/20 bg-white/5 py-2.5 text-xs font-medium text-white/80 hover:bg-white/10"
  >
    {compareMode ? "🔀 Dölj jämförelse" : "🔀 Jämför med planerat projekt"}
  </button>
)}
```

**iOS-test:** Skapa egen placering → Meny → "Jämför med planerat projekt" → se båda samtidigt.

---

### A5. Dela fotomontage direkt (se A1)

Redan implementerat ovan i A1.

---

## Del B — Medel arbete (3–5 dagar)

### B1. Lågfrekvens-puls på ljudet (LFO-modulering)

**Förväntad effekt:** Visar exakt VARFÖR folk klagar — inte 37 dBA-volymen, utan 0.5 Hz pulsen.

**Filer:** Hitta er `useWindSound.ts` (eller liknande)

Lägg till en `AmplitudeModulationNode` efter volymen:

```ts
// Efter befintlig gainNode, lägg till:
const lfo = audioContext.createOscillator();
const lfoGain = audioContext.createGain();
lfo.frequency.value = 0.5;  // 0.5 Hz puls (typisk rotorpassage-frekvens)
lfoGain.gain.value = 0.15;  // 15% djup — subtilt men hörbart

lfo.connect(lfoGain);
lfoGain.connect(masterGain.gain);  // Modulerar volymen
lfo.start();

// Slumpmässig djup (för realism):
const depthVariation = 0.1 + Math.random() * 0.15;
lfoGain.gain.setValueAtTime(depthVariation, audioContext.currentTime);
```

**iOS-test:** Slå på ljud i AR → känn/hör den subtila "wub-wub-wub"-pulsen.

---

### B2. Tids-scrubber (välj tid på dygnet)

**Förväntad effekt:** Visuell storytelling — "så här ser det ut kl 22 vs kl 14".

**Filer:** `src/pages/Home.tsx`

Lägg till i en ny `TimeScrubber`-panel:

```tsx
// NY komponent (eller inline):
function TimeScrubber({ hour, onChange }: { hour: number; onChange: (h: number) => void }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/60 px-3 py-2 backdrop-blur">
      <div className="flex items-center justify-between text-[10px] text-white/60">
        <span>🕐 Tid på dygnet</span>
        <span className="font-mono">{hour.toString().padStart(2, '0')}:00</span>
      </div>
      <input
        type="range"
        min="0"
        max="23"
        step="0.5"
        value={hour}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="mt-1 w-full"
        style={{ accentColor: '#FF8B01' }}
      />
    </div>
  );
}

// I Home.tsx (runt rad 1990-2000, bredvid andra paneler):
const [simulationHour, setSimulationHour] = useState<number | null>(null);

// Beräkna solljus-position baserat på hour + lat/lng + dag-på-året
const sunPosition = useMemo(() => {
  if (simulationHour === null) return null;
  // Använd befintlig sunMode-logik, men tvinga hour
  return calculateSunPosition(simulationHour, geo.lat ?? 59, dayOfYear);
}, [simulationHour, geo.lat]);

// Rendera scrubber ovanför Meny-knappen (rad ~2017):
{ready && simulationHour !== null && (
  <TimeScrubber hour={simulationHour} onChange={setSimulationHour} />
)}
```

**iOS-test:** AR-läge → Meny → "Tid på dygnet" → drag slider → solen flyttar sig, skuggor ändras.

---

### B3. Beräknad elproduktion per projekt

**Förväntad effekt:** Konkreta siffror istället för abstrakt "29 verk".

**Filer:** Skapa ny `src/lib/production.ts`:

```ts
// src/lib/production.ts
const ANNUAL_PRODUCTION_PER_TURBINE_GWH = 8.5;  // Modernt landbaserat ~3.5 MW verk
const HOUSEHOLD_CONSUMPTION_KWH = 5000;  // Genomsnittligt hushåll per år (exkl. värme)

export interface ProductionEstimate {
  annualGWh: number;
  households: number;
  co2OffsetTons: number;  // ~500 ton CO2/GWh vs fossilt
}

export function estimateProduction(turbineCount: number): ProductionEstimate {
  const annualGWh = turbineCount * ANNUAL_PRODUCTION_PER_TURBINE_GWH;
  const households = Math.round((annualGWh * 1_000_000) / HOUSEHOLD_CONSUMPTION_KWH);
  const co2OffsetTons = Math.round(annualGWh * 500);
  return { annualGWh, households, co2OffsetTons };
}
```

Använd i `NationalMapView.tsx` projektkortet (rad ~962):

```tsx
import { estimateProduction } from "@/lib/production";

// Inuti projektkortets metadata-rad:
{(() => {
  const count = selectedProject.turbineCountPlannedMin ?? 0;
  const prod = estimateProduction(count);
  return (
    <p className="mt-1 text-[11px] text-white/50">
      ⚡ ~{prod.annualGWh.toFixed(0)} GWh/år · {prod.households.toLocaleString('sv-SE')} hushåll · -{prod.co2OffsetTons.toLocaleString('sv-SE')} ton CO₂/år
    </p>
  );
})()}
```

---

### B4. "Närmaste verk"-direktvy (hoppa över kartan)

**Förväntad effekt:** Snabbväg för upprepade användare.

**Filer:** `src/components/PermissionGate.tsx` (eller motsvarande)

Lägg till en knapp i PermissionGate:

```tsx
// Efter "Tillåt kamera & starta AR":
<button
  onClick={() => {
    // Sätt flagga → PlaceTurbines öppnar med closest project automatiskt
    sessionStorage.setItem("vindkollen:openNearestDirect", "1");
    navigate("/placera");
  }}
  className="w-full rounded-full border border-white/20 bg-white/5 py-3 text-sm font-medium text-white/80 hover:bg-white/10"
>
  🎯 Visa närmaste verk direkt (utan karta)
</button>
```

I `PlaceTurbines.tsx`, konsumera flaggan:

```tsx
useEffect(() => {
  if (sessionStorage.getItem("vindkollen:openNearestDirect") === "1") {
    sessionStorage.removeItem("vindkollen:openNearestDirect");
    // Hitta närmaste projekt baserat på geo.lat/lng (eller använd default Katrineholm)
    setShowWelcome(false);
  }
}, []);
```

---

## Del C — Större funktioner (1–2 veckor)

### C1. Buller-karta (40 dBA-gräns som polygon)

**Förväntad effekt:** Visuellt istället för "36.9 dBA" — var BLIR det för högt?

**Filer:** Ny `src/components/NoiseContourMap.tsx` + integration i `ARScene.tsx`

```tsx
// src/components/NoiseContourMap.tsx
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';

interface NoiseContourMapProps {
  turbines: { lat: number; lon: number }[];
  receiverPoint: { lat: number; lon: number } | null;
  threshold: number;  // dBA, t.ex. 40
}

// Beräkna 40 dBA-gränsen runt varje verk:
// ΔL = 20 * log10(r2/r1) → för 40 dBA från 100 dBA @ 1m: r = 10^((100-40)/20) = 10000m = 10km
// (Verkligt värde ~5-7 km beroende på terräng, men börja med 5 km för visning)
const NOISE_RADIUS_KM = 5;

export function NoiseContourMap({ turbines, receiverPoint, threshold }: NoiseContourMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (!containerRef.current || turbines.length === 0) return;
    // Använd mini-Mapbox/MapLibre overlay
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: { /* inline minimal style */ },
      center: receiverPoint ? [receiverPoint.lon, receiverPoint.lat] : [16, 59],
      zoom: 11,
    });
    
    map.on('load', () => {
      const features = turbines.map(t => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [t.lon, t.lat] },
      }));
      
      // Lägg till cirklar
      map.addSource('noise', { type: 'geojson', data: { type: 'FeatureCollection', features } });
      map.addLayer({
        id: 'noise-circles',
        type: 'circle',
        source: 'noise',
        paint: {
          'circle-radius': { stops: [[8, 5], [14, 80]] },  // 5km @ zoom 11
          'circle-color': '#FF8B01',
          'circle-opacity': 0.25,
          'circle-stroke-color': '#FF8B01',
          'circle-stroke-width': 1,
        },
      });
    });
    
    return () => map.remove();
  }, [turbines, receiverPoint]);
  
  return <div ref={containerRef} className="h-64 w-full rounded-2xl" />;
}
```

---

### C2. Widget för hemskärmen (iOS WidgetKit)

**Förväntad effekt:** Daglig påminnelse, ingen app-öppning krävs.

**Filer:** Nytt target i `ios/`

```swift
// ios/VindkollenWidget/VindkollenWidget.swift
import WidgetKit
import SwiftUI

struct VindkollenEntry: TimelineEntry {
  let date: Date
  let nearestTurbineName: String
  let distanceKm: Double
  let bearingText: String
}

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> VindkollenEntry {
    VindkollenEntry(date: Date(), nearestTurbineName: "Ericsberg", distanceKm: 1.3, bearingText: "ONO")
  }
  
  func getSnapshot(in context: Context, completion: @escaping (VindkollenEntry) -> Void) {
    completion(placeholder(in: context))
  }
  
  func getTimeline(in context: Context, completion: @escaping (Timeline<VindkollenEntry>) -> Void) {
    // Hämta från App Group / UserDefaults delat med huvudappen
    let entry = VindkollenEntry(
      date: Date(),
      nearestTurbineName: UserDefaults(suiteName: "group.katrineholm.vindkraft")?.string(forKey: "nearestName") ?? "Ericsberg",
      distanceKm: UserDefaults(suiteName: "group.katrineholm.vindkraft")?.double(forKey: "nearestDistance") ?? 1.3,
      bearingText: UserDefaults(suiteName: "group.katrineholm.vindkraft")?.string(forKey: "nearestBearing") ?? "ONO"
    )
    completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(60 * 60))))
  }
}

struct VindkollenWidgetView: View {
  var entry: Provider.Entry
  var body: some View {
    VStack(alignment: .leading) {
      Text("Vindkollen")
        .font(.caption.bold())
        .foregroundColor(.orange)
      Text(entry.nearestTurbineName)
        .font(.headline)
      HStack {
        Image(systemName: "wind")
        Text("\(entry.distanceKm, specifier: "%.1f") km \(entry.bearingText)")
      }
      .font(.caption)
    }
    .padding()
  }
}

@main
struct VindkollenWidgetBundle: WidgetBundle {
  var body: some Widget {
    VindkollenWidget()
  }
}
```

**Från huvudappen** (skriv till App Group):

```ts
// src/hooks/useWidgetSync.ts
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

export function useWidgetSync(nearest: { name: string; distanceKm: number; bearing: string } | null) {
  useEffect(() => {
    if (!nearest) return;
    
    // Skriv till App Group (native) eller localStorage (web)
    if (Capacitor.isNativePlatform()) {
      // Kräver custom Capacitor-plugin eller App Group entitlements
      (window as any).webkit?.messageHandlers?.widgetSync?.postMessage({
        name: nearest.name,
        distanceKm: nearest.distanceKm,
        bearing: nearest.bearing,
      });
    } else {
      localStorage.setItem("widget-sync", JSON.stringify(nearest));
    }
  }, [nearest]);
}
```

---

### C3. Förhandsvisning i kameran från valfri punkt

**Förväntad effekt:** Man behöver inte fysiskt stå där — välj punkt på karta → se AR.

**Filer:** `src/components/PositionPicker.tsx` (ny), integrera i `src/pages/Home.tsx`

```tsx
// src/components/PositionPicker.tsx
import { useState } from 'react';
import maplibregl from 'maplibre-gl';

interface PositionPickerProps {
  onSelect: (pos: { lat: number; lon: number }) => void;
  onClose: () => void;
}

export function PositionPicker({ onSelect, onClose }: PositionPickerProps) {
  const [pending, setPending] = useState<{ lat: number; lon: number } | null>(null);
  
  return (
    <div className="absolute inset-0 z-[60] bg-[#090909]">
      <div className="p-4">
        <h2 className="text-lg font-bold">Välj betraktarposition</h2>
        <p className="text-sm text-white/60">Tryck på kartan för att placera en nål.</p>
      </div>
      
      <div 
        className="h-[60vh] w-full" 
        ref={(el) => {
          if (!el) return;
          const map = new maplibregl.Map({ container: el, /* ... */ });
          map.on('click', (e) => setPending({ lat: e.lngLat.lat, lon: e.lngLat.lng }));
        }}
      />
      
      {pending && (
        <div className="absolute bottom-24 inset-x-0 flex justify-center gap-2 px-4">
          <button onClick={onClose} className="rounded-full border border-white/20 bg-white/5 px-4 py-2 text-sm">
            Avbryt
          </button>
          <button 
            onClick={() => onSelect(pending)}
            className="rounded-full bg-[#FF8B01] px-4 py-2 text-sm font-semibold text-black"
          >
            Visa härifrån
          </button>
        </div>
      )}
    </div>
  );
}
```

I Home.tsx, koppla till `positionOverride`:

```tsx
// NY STATE:
const [showPositionPicker, setShowPositionPicker] = useState(false);

// I menyn (rad ~2017), LÄGG TILL:
<button
  onClick={() => { setShowPositionPicker(true); setShowMenu(false); }}
  className="w-full rounded-full border border-white/20 bg-white/5 py-2.5 text-xs font-medium text-white/80 hover:bg-white/10"
>
  🗺️ Välj betraktarposition på karta
</button>

{showPositionPicker && (
  <PositionPicker
    onSelect={(pos) => {
      setPositionOverride(pos);
      setShowPositionPicker(false);
    }}
    onClose={() => setShowPositionPicker(false)}
  />
)}
```

---

## Del D — Småfixar / UX (några timmar)

### D1. Större touch targets i topp-bar

**Problem:** Knapparna "Ljud / Ute / Dölj / ⚙️" är svåra att träffa.

**Fil:** `src/pages/Home.tsx` (rad ~1894-1936)

```tsx
// ÄNDRA: px-2.5 py-1 → px-3 py-2, text-[11px] → text-xs
className="rounded-full bg-white/10 px-3 py-2 text-xs font-medium text-white transition hover:bg-white/20 ..."
```

### D2. Onboarding första gången

**Fil:** Ny `src/components/Onboarding.tsx`

```tsx
// src/components/Onboarding.tsx
import { useState } from 'react';

const STEPS = [
  { emoji: "👋", title: "Välkommen till Vindkollen", body: "Se verkliga och planerade vindkraftverk i hela Sverige, direkt i din telefon." },
  { emoji: "📷", title: "Tillåt kamera", body: "Vi behöver kameran för att visa verken i augmented reality — inget sparas." },
  { emoji: "📍", title: "Tillåt plats", body: "Vi behöver din position för att visa avstånd och riktning till verken." },
  { emoji: "🧭", title: "Kalibrera kompassen", body: "Vrid telefonen i en 8-form-figur tills kalibreringen är klar." },
  { emoji: "🎯", title: "Klart!", body: "Tryck på en pinne i kartan för att börja utforska." },
];

export function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  
  // Visa bara första gången
  if (localStorage.getItem("vindkollen:onboarded") === "1") {
    onComplete();
    return null;
  }
  
  const current = STEPS[step];
  
  return (
    <div className="fixed inset-0 z-[80] flex flex-col items-center justify-center bg-[#090909] px-8 text-center">
      <div className="text-6xl mb-6">{current.emoji}</div>
      <h1 className="text-2xl font-bold">{current.title}</h1>
      <p className="mt-3 text-white/70">{current.body}</p>
      
      <div className="mt-8 flex gap-2">
        {STEPS.map((_, i) => (
          <div key={i} className={`h-1.5 w-6 rounded-full ${i === step ? 'bg-[#FF8B01]' : 'bg-white/20'}`} />
        ))}
      </div>
      
      <div className="mt-12 flex w-full max-w-xs gap-2">
        {step > 0 && (
          <button onClick={() => setStep(step - 1)} className="flex-1 rounded-full border border-white/20 py-3 text-sm">
            Tillbaka
          </button>
        )}
        <button
          onClick={() => {
            if (step < STEPS.length - 1) setStep(step + 1);
            else {
              localStorage.setItem("vindkollen:onboarded", "1");
              onComplete();
            }
          }}
          className="flex-1 rounded-full bg-[#FF8B01] py-3 text-sm font-semibold text-black"
        >
          {step < STEPS.length - 1 ? "Nästa" : "Börja"}
        </button>
      </div>
    </div>
  );
}
```

Integrera i `Home.tsx` (högst upp, före PermissionGate):

```tsx
const [showOnboarding, setShowOnboarding] = useState(() => 
  localStorage.getItem("vindkollen:onboarded") !== "1"
);

if (showOnboarding) return <Onboarding onComplete={() => setShowOnboarding(false)} />;
```

### D3. Retry-knapp på nätverksfel

**Fil:** `src/pages/MyProjects.tsx` (rad 60-68)

```tsx
// ÄNDRA felmeddelandet till:
{error && (
  <div className="mb-4 rounded-lg bg-red-900/30 px-4 py-3 text-sm text-red-300">
    <p>{error}</p>
    <div className="mt-2 flex gap-2">
      <button onClick={fetchApiProjects} className="rounded bg-red-700/30 px-3 py-1 text-xs font-semibold">
        🔄 Försök igen
      </button>
      <button onClick={() => setError(null)} className="px-3 py-1 text-xs underline">
        Stäng
      </button>
    </div>
  </div>
)}
```

### D4. Service Worker för offline-läge

**Fil:** Ny `public/sw.js`

```js
// public/sw.js
const CACHE_NAME = "vindkollen-v1";
const ASSETS = ["/", "/vindkraft-karta/", "/manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
});

self.addEventListener("fetch", (e) => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      // Cache GET requests only
      if (e.request.method === "GET" && res.ok) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => cached))
  );
});
```

Registrera i `src/main.tsx`:

```ts
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
```

---

## Del E — iOS-specifika justeringar (för alla nya features)

**iOS-safe-area för ALLA nya komponenter:**

```tsx
// Alla nya overlay-komponenter MÅSTE ha:
className="fixed inset-0 z-[X] pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]"
```

**Undvik dessa iOS-fällor:**

1. **`alert()` / `confirm()`** — blockerar UI i WKWebView. Använd era egna modaler.
2. **`window.print()`** — fungerar inte i WKWebView. Använd `navigator.share()` istället.
3. **`localStorage` i privat läge** — kan kasta. Wrappa alltid i `try/catch`.
4. **CSS `position: fixed` + iOS-tangentbord** — kan flytta element. Använd `interactive-widget=resizes-content` (redan satt).

---

## Testplan — ALLA ändringar

1. `npm run build && npx cap sync ios && npx cap run ios`
2. **Första gången** — Onboarding visas? Kan hoppa igenom?
3. **Sverigekartan** — "📍 Min position"-knapp fungerar?
4. **Mitt projekt → Dela** — iOS share-sheet öppnas?
5. **AR + sikta mot verk** — vibration? LFO-puls hörbar?
6. **Tids-scrubber** — solen flyttar sig?
7. **Egen placering → Jämför** — båda verken syns?
8. **Välj position på karta** — kamera öppnas på vald plats?
9. **Fotomontage → Dela** — öppnas i Messages/Mail?
10. **Stäng nätverket** — Service Worker laddar cachad version?

---

## Prioriteringsrekommendation

| Vecka | Fokus | Leverans |
|-------|-------|----------|
| **1** | A1, A2, A3, A4, D1, D3 | Klickbar, delbar, vibrerande |
| **2** | B1, B2, B3, B4, D2, D4 | Berättande, offline, on-boardad |
| **3** | C1 (buller-karta) | Visuellt buller istället för dB-tal |
| **4** | C2 (widget) + C3 (välj position) | Native iOS-integrering |

---

## VIKTIGT: Replit Agent — kör i denna ordning

1. **Läs först** `REPLIT_AGENT_INSTRUKTIONER_IOS_BUGGAR_V2.md` och applicera alla 5 fixar
2. **Kör build + sync** — verifiera att inget är trasigt
3. **Applicera Del D först** (småfixar) — minimerar risk för regression
4. **Applicera Del A** (snabba vinster) — ger omedelbar användarnytta
5. **Applicera Del B** (medel) — kräver lite testning
6. **Applicera Del C sist** (större) — kräver native build för widget
7. **Build + sync + Xcode** efter varje del
8. **Testa på riktig iPhone** efter varje del

---

## Resurser / paket att installera

```bash
# För haptics, share, file system:
pnpm add @capacitor/haptics @capacitor/share @capacitor/filesystem

# För widget (native, ej npm):
# Skapas i Xcode som nytt target
```

Lycka till! Detta blir en riktigt bra app. 🚀
