# V15: API-override förstör Ericsbergs 8 verk

## Problemet

Loggen visar tydligt vad som händer när Ericsberg (id=10001) öppnas:

```
[PlaceTurbines] Verk hämtade {
  projectId: "10001",
  allFromApi: 33,
  byProjectAreaId: 0,        ← API:t har INTE Ericsbergs id=10001
  filtered: 33
}
```

Det nuvarande API-fetch-blocket i `src/pages/PlaceTurbines.tsx` (runt rad 268–310) har följande logik:

```ts
const filtered =
  byId.length > 0
    ? byId
    : data.filter((t) => typeof t.lat === "number" && typeof t.lng === "number");
```

När `byId.length === 0` (API:t känner inte igen id=10001) → `filtered` blir ALLA 33 verk i bbox. Dessa slumpmässiga verk ERSÄTTER sedan de 8 exakta DEFAULT_TURBINES som V12 genererade.

Samma sak händer för ALLA andra projekt vars id=10001+ som inte finns i API:ts projectAreaId-tabell — V12:s fina grid ersätts av 33 slumpmässiga verk från bbox.

**Resultat:**
- "Ericsbergs vindnurror inte där de borde" — 33 slumpmässiga verk istället för 8 DEFAULT
- "Bara Ericsberg kan redigera" — alla andra projekt ser ut som Ericsberg eftersom alla har samma 33 verk från samma bbox

## Lösning

**Fil:** `src/pages/PlaceTurbines.tsx`

**Hitta `.then((data) => {`-blocket** (runt rad 276–302):

```ts
      .then((data) => {
        if (cancelled) return;
        const numId = parseInt(projectId, 10);
        // Matcha exakt på projectAreaId om möjligt; annars alla verk i bbox
        const byId = data.filter(
          (t) => typeof t.lat === "number" && typeof t.lng === "number" && t.projectAreaId === numId,
        );
        const filtered =
          byId.length > 0
            ? byId
            : data.filter((t) => typeof t.lat === "number" && typeof t.lng === "number");
        console.log("[PlaceTurbines] Verk hämtade", {
          projectId,
          allFromApi: data.length,
          byProjectAreaId: byId.length,
          filtered: filtered.length,
        });
        const placed: PlacedTurbine[] = filtered.map((t) => ({
          id: `nt-${t.id}`,
          lat: t.lat as number,
          lon: t.lng as number,
        }));
        if (placed.length > 0) {
          setTurbines(placed);
          setCommittedTurbines(placed);
        }
      })
```

**Ersätt HELA `.then((data) => {...})`-blocket med:**

```ts
      .then((data) => {
        if (cancelled) return;
        const numId = parseInt(projectId, 10);

        // V15: BARA projectAreaId-specifika verk får ersätta V12:ans preloaded.
        // Om API:et inte har exakt det projektets verk (byId.length < 3),
        // BEHÅLL preloaded rutnät/DEFAULT_TURBINES — annars förstör vi
        // Ericsbergs exakta 8 verk med 33 slumpmässiga verk från bbox.
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
          return;
        }

        const placed: PlacedTurbine[] = byId.map((t) => ({
          id: `nt-${t.id}`,
          lat: t.lat as number,
          lon: t.lng as number,
        }));

        setTurbines(placed);
        setCommittedTurbines(placed);
      })
```

`.catch(...)` och `.finally(...)` nedanför lämnas oförändrade.

---

## Vad fixas

| Innan | Efter |
|-------|-------|
| Ericsberg (id=10001) → 33 slumpmässiga verk | Ericsberg → 8 DEFAULT_TURBINES (V12-grid bevaras) |
| Långshyttan (id=N) → 33 slumpmässiga verk | Långshyttan → 8-verks grid från V12 |
| Katrineholm Vind (id=32, finns i API) → 8 verk | Katrineholm Vind → N verk från API (projectAreaId=32 finns) |

## VALIDERING

1. **Öppna Ericsberg** (id=10001) → exakt 8 DEFAULT_TURBINES på rätt position, INTE 33 från API
2. **Öppna Katrineholm Vind** (id=32) → N verk från API (projectAreaId matchar)
3. **Öppna Långshyttan** (eller annat projekt) → 8-verks auto-grid (V12 default)
4. **Loggen** ska visa `"byProjectAreaId": 0, "willOverride": false` för Ericsberg, istället för `"usingAllInBbox": true, "filtered": 33`

## EFTER ÄNDRINGAR

1. Visa diff för `src/pages/PlaceTurbines.tsx`
2. Kör typecheck
3. Rör inga andra filer
4. Bygg INTE om
5. Committa med: `V15: API-override BARA vid projectAreaId-träffar`
