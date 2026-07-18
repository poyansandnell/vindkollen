# V15: Två rotorsaker

Två problem kvarstår efter V14:
1. **"Vindnurror inte där de borde"** — API-fetch overridar 8 DEFAULT_TURBINES med 33 slumpmässiga verk från bbox
2. **"Bara Ericsberg kan redigera"** — disable-check blockerar alla icke-Katrineholm/Ericsberg-projekt

---

## ÄNDRING 1: `src/pages/PlaceTurbines.tsx` — Fixa API-fetch-override

**Problemet:** V12-instruktionens API-fetch har `useAll = byId.length < 3` vilket gör att 33 slumpmässiga verk från bbox ERSÄTTER de 8 DEFAULT_TURBINES för Ericsberg (eftersom API:et inte känner igen id=10001).

**Hitta** useEffect (runt rad 246–360). Leta efter detta block:

```ts
.then((data) => {
        if (cancelled) return;
        const numId = parseInt(projectId, 10);
        // Exakt match på projectAreaId
        const byId = data.filter(
          (t) => typeof t.lat === "number" && typeof t.lng === "number" && t.projectAreaId === numId,
        );
        // Om färre än 3 matchade: använd alla i bbox (men max 50)
        const useAll = byId.length < 3;
        const source = useAll ? data : byId;
        const filtered = source
          .filter((t) => typeof t.lat === "number" && typeof t.lng === "number")
          .slice(0, 50);

        console.log("[PlaceTurbines] Verk hämtade", {
          projectId,
          allFromApi: data.length,
          byProjectAreaId: byId.length,
          usingAllInBbox: useAll,
          filtered: filtered.length,
        });

        if (filtered.length === 0) {
          setNationalTurbinesLoading(false);
          return; // Behåll preloaded rutnät — ersätt inte med tomt
        }

        const placed: PlacedTurbine[] = filtered.map((t) => ({
          id: `nt-${t.id}`,
          lat: t.lat as number,
          lon: t.lng as number,
        }));

        // Ersätt turbinerna med API-data (bättre än rutnät)
        setTurbines(placed);
        setCommittedTurbines(placed);
        setNationalTurbinesLoading(false);
      })
```

**Ersätt HELA `.then((data) => {...})`-blocket** med:

```ts
.then((data) => {
        if (cancelled) return;
        const numId = parseInt(projectId, 10);

        // V15: BARA projectAreaId-specifika verk får ersätta preloaded.
        // Om API:et inte har exakt det projektets verk (byId.length < 3),
        // BEHÅLL preloaded rutnät/DEFAULT_TURBINES — annars förstör vi
        // Ericsbergs exakta 8 verk med 33 slumpmässiga från bbox.
        const byId = data.filter(
          (t) => typeof t.lat === "number" && typeof t.lng === "number" && t.projectAreaId === numId,
        );

        console.log("[PlaceTurbines] Verk hämtade", {
          projectId,
          allFromApi: data.length,
          byProjectAreaId: byId.length,
          willOverride: byId.length >= 3,
        });

        if (byId.length < 3) {
          // Inte tillräckligt många projectAreaId-träffar — behåll preloaded
          setNationalTurbinesLoading(false);
          return;
        }

        const placed: PlacedTurbine[] = byId.map((t) => ({
          id: `nt-${t.id}`,
          lat: t.lat as number,
          lon: t.lng as number,
        }));

        setTurbines(placed);
        setCommittedTurbines(placed);
        setNationalTurbinesLoading(false);
      })
```

---

## ÄNDRING 2: `src/components/NationalMapView.tsx` — Ta bort Katrineholm-only disable

**Problemet:** V11-instruktionen lämnade kvar disable-check som blockerar alla projekt som inte heter "katrineholm" eller "ericsberg".

**Hitta** (runt rad 1090–1140) — block med "📐 Öppna projektet"-knappen. Ser ut ungefär:

```tsx
<button
  onClick={() => onEnterEditorDirect(selectedProject)}
  disabled={
    !selectedProject ||
    !/katrineholm|ericsberg/i.test(selectedProject.name) ||
    ((selectedProject.turbineCountPlannedMin ?? 0) +
      (selectedProject.turbineCountPlannedMax ?? 0) === 0)
  }
  className="..."
>
  {!selectedProject
    ? '🚫 Inga verk att redigera'
    : !/katrineholm|ericsberg/i.test(selectedProject.name)
      ? '🔒 Endast Katrineholm'
      : ((selectedProject.turbineCountPlannedMin ?? 0) +
          (selectedProject.turbineCountPlannedMax ?? 0) === 0)
        ? '🚫 Inga verk att redigera'
        : '📐 Öppna projektet'}
</button>
```

**Ersätt HELA knappen med:**

```tsx
<button
  onClick={() => onEnterEditorDirect(selectedProject)}
  disabled={
    !selectedProject ||
    ((selectedProject.turbineCountPlannedMin ?? 0) +
      (selectedProject.turbineCountPlannedMax ?? 0) === 0)
  }
  className="w-full rounded-full bg-[#FF8B01] py-3 text-sm font-bold text-[#090909] shadow-lg shadow-[#FF8B01]/20 transition hover:bg-[#FFB347] active:bg-[#FF8B01] disabled:opacity-60"
  style={{ touchAction: 'manipulation' }}
>
  {!selectedProject
    ? '🚫 Inga verk att redigera'
    : ((selectedProject.turbineCountPlannedMin ?? 0) +
        (selectedProject.turbineCountPlannedMax ?? 0) === 0)
      ? '🚫 Inga verk att redigera'
      : '📐 Öppna projektet'}
</button>
```

**VIKTIGT:** Behåll alla classNames, `style` och `onClick` exakt som ovan — bara ta bort `!/katrineholm|ericsberg/i.test(...)` ur disabled-prop och från knapptexten.

---

## SAMMANFATTNING

| Fil | Ändring |
|-----|---------|
| `src/pages/PlaceTurbines.tsx` | API-fetch overridar BARA om `byId.length >= 3`. Behåller DEFAULT_TURBINES / auto-grid om färre. |
| `src/components/NationalMapView.tsx` | Tar bort Katrineholm-only disable-check. Kvar: bara "inga verk att redigera" om `turbineCountPlannedMin + Max === 0`. |

---

## VALIDERING

1. **Klicka Ericsberg** (id=10001) → editor öppnas med exakt 8 DEFAULT_TURBINES (samma som tidigare, INTE 33 från API)
2. **Klicka Katrineholm Vind** (id=32, API) → editor öppnas med 29-verkars rutnät runt dess centerLat/Lng
3. **Klicka Långshyttan** (eller annat projekt) → knappen "📐 Öppna projektet" är ORANGE (inte 🔒) och öppnar editorn med rutnät
4. **Inga "🔒 Endast Katrineholm"** visas längre

---

## EFTER ÄNDRINGAR

1. Visa diff för båda filer
2. Kör typecheck
3. Rör inga andra filer
4. Bygg INTE om
5. Committa med: `V15: API-override BARA vid projectAreaId-träffar + ta bort Katrineholm-only disable`
