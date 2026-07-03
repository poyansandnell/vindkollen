import { useEffect, useRef, useState } from "react";

export interface SkyDetectionState {
  /**
   * Utjämnad (EMA) uppskattning 0..1 av hur mycket av bilden som är
   * "himmel" just nu — 1 = fri sikt mot himlen, 0 = i princip ingen himmel
   * synlig (typiskt inomhus, eller kameran riktad rakt mot mark/vägg/träd/
   * byggnad). Uppdateras kontinuerligt och används för att låta ljudet tona
   * mjukt mellan tyst/fullt istället för att hoppa direkt.
   */
  outdoorConfidence: number;
  /**
   * Stabil, hysteresbaserad bedömning av om användaren är inomhus — flimrar
   * inte fram och tillbaka vid gränsvärdet som `outdoorConfidence` kan göra.
   * Används för att visa/dölja "Gå utomhus"-texten.
   */
  indoors: boolean;
  /** True så fort minst en bildruta har analyserats. */
  ready: boolean;
  /**
   * Slår upp om en given normaliserad skärmpunkt (u, v i intervallet 0..1,
   * där (0,0) är övre vänstra hörnet) för närvarande klassas som himmel,
   * baserat på samma lätta ljusstyrka/textur/mättnad-heuristik
   * (`classifyCell`) som redan driver `outdoorConfidence` — se modulens
   * jsdoc. Innan första bildrutan analyserats (eller om `enabled` är
   * false) returneras alltid `true` (ingen ocklusion), så verken aldrig
   * blixtrar till dolda innan heuristiken hunnit få data. Stabil
   * funktionsreferens (ändras aldrig), säker att anropa varje bildruta i
   * AR-scenens renderloop.
   */
  isPointSky: (u: number, v: number) => boolean;
  /**
   * Returnerar HELA ocklusionsrutnätet (samma `GRID_COLS`x`GRID_ROWS`
   * upplösning som `classifyCell`-heuristiken använder internt), 0..1 per
   * cell, temporalt utjämnat (EMA) för att undvika flimmer mellan
   * bildrutor — se `isPointSky` ovan. Funktionsidentiteten ändras aldrig
   * (samma `Float32Array`-instans muteras på plats) — säker att läsa varje
   * bildruta.
   */
  getOcclusionGrid: () => Float32Array;
  /**
   * Rå (lätt utjämnad) andel av bildrutan som just nu klassas som himmel
   * (0..1) — samma underliggande signal som `outdoorConfidence` bygger på,
   * men utan EMA-fördröjningen, så konsumenter som behöver ett direkt
   * "minst X% himmel"-villkor (t.ex. Outdoor Confidence Index) slipper vänta
   * in utjämningen.
   */
  skyRatio: number;
  /**
   * Genomsnittlig luminans (0..1) i den senaste bildrutan — en enkel,
   * alltid tillgänglig proxy för omgivande ljusnivå när en riktig
   * `AmbientLightSensor` inte finns/tillåts (svagt webbläsarstöd).
   */
  avgLuminance: number;
  /**
   * Alltid "disabled" — den tidigare ML-segmenteringsmetoden ("ml") togs
   * bort helt (se modulens jsdoc) och ersätts INTE av den lätta
   * heuristiken nedan (den är för grov för att styra det stora "Gå
   * utomhus"/aim-indexet tillförlitligt). Fältet behålls av
   * bakåtkompatibilitet med konsumenter (`Home.tsx`s
   * `mlActive = sky.method === "ml"`) som redan har en korrekt,
   * väldefinierad fallback för "ML aldrig aktiv": det övergripande
   * Outdoor Confidence Index-läget (helskärms "Gå utomhus"/aim-overlay)
   * förblir helt oförändrat/avstängt.
   *
   * OBS: detta styr INTE längre `isPointSky`/`getOcclusionGrid` ovan —
   * den lätta heuristiken driver numera per-pixel-ocklusionen (verk döljs
   * bakom träd/byggnader) oavsett detta fälts värde, se modulens jsdoc.
   */
  method: "loading" | "ml" | "disabled";
}

// Rutnätsupplösning: höjdupplösningen (rader) är nu betydligt högre än
// bredden eftersom kameraströmmen är porträttorienterad (mycket högre än
// bred), och den vertikala gränsen mellan "himmel" och "skymt av träd" är
// exakt vad som avgör om den övre delen av ett verk (ovanför trädtopparna)
// klassas rätt. Med bara 8 rader (ursprungsvärdet) täckte varje rad ~12.5%
// av bildhöjden — ofta MER än ett helt verks skärmhöjd på 500-800 m
// avstånd, så hela verket (både den del som stack upp ovanför träden och
// den skymda basen) hamnade i samma cell och fick samma (delvis skymd)
// färgton, även på den del som faktiskt var fri mot himlen.
export const GRID_COLS = 16;
export const GRID_ROWS = 20;
// 8x8 pixlar per cell (inte 3x3) — ger textur-signalen (`stdDev`) faktiskt
// något att mäta. Med bara 3x3 källpixlar nedskalas nästan all textur bort
// redan innan klassificeringen, vilket gjorde att en jämnt målad, ljus
// innervägg/innertak lätt missklassades som himmel (se INDOOR_ENTER/EXIT).
const CELL_PX = 8;
const CANVAS_W = GRID_COLS * CELL_PX;
const CANVAS_H = GRID_ROWS * CELL_PX;
const SAMPLE_INTERVAL_MS = 300;
const EMA_ALPHA = 0.45;
// Konfidensen når 1.0 redan vid ~25% himmelsandel i bilden — man pekar
// sällan kameran rakt upp, så ute i det fria räcker det med ett gott stycke
// himmel över horisonten för att räknas som "utomhus, fri sikt".
const CONFIDENCE_SKY_RATIO_SCALE = 0.25;
// Hysteres: kräver en tydlig marginal mellan tröskelvärdena innan status
// växlar, så att gränsfall (t.ex. nära ett fönster) inte flimrar.
const INDOOR_ENTER_THRESHOLD = 0.08;
const INDOOR_EXIT_THRESHOLD = 0.28;

/**
 * Klassificerar en rutnätscell som "himmel-lik" baserat på ljusstyrka,
 * mättnad/blåton och lokal textur (standardavvikelse i luminans):
 * - Ljus (annars räknas mörka väggar/skuggor/tak inte som himmel).
 * - Låg lokal textur ("slät" yta — riktig himmel, molnfri eller mulen, har
 *   sällan skarpa kanter inom en liten ruta, till skillnad från väggar med
 *   hörn, lampor, möbler, träd eller fasader).
 * - Antingen låg mättnad (vit/grå — mulen himmel) eller tydligt blåaktig
 *   (klarblå himmel).
 *
 * Denna heuristik driver `outdoorConfidence`/`indoors` (ljuddämpning + "Gå
 * utomhus"-signalen) — den enda kvarvarande himmel-detekteringen i denna
 * modul, se jsdoc-kommentaren ovanför `useSkyDetection`.
 */
function classifyCell(pixels: Uint8ClampedArray, col: number, row: number): boolean {
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumLum = 0;
  let sumLumSq = 0;
  let n = 0;
  for (let dy = 0; dy < CELL_PX; dy++) {
    for (let dx = 0; dx < CELL_PX; dx++) {
      const x = col * CELL_PX + dx;
      const y = row * CELL_PX + dy;
      const idx = (y * CANVAS_W + x) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      sumR += r;
      sumG += g;
      sumB += b;
      sumLum += lum;
      sumLumSq += lum * lum;
      n++;
    }
  }
  const avgR = sumR / n;
  const avgG = sumG / n;
  const avgB = sumB / n;
  const avgLum = sumLum / n;
  const variance = Math.max(sumLumSq / n - avgLum * avgLum, 0);
  const stdDev = Math.sqrt(variance);
  const maxC = Math.max(avgR, avgG, avgB);
  const minC = Math.min(avgR, avgG, avgB);
  const sat = maxC === 0 ? 0 : (maxC - minC) / maxC;
  const blueish = avgB >= avgR - 6 && avgB >= avgG - 10;
  // Något strängare gränser än ursprungligen: en ljust upplyst, jämnt
  // målad innervägg/innertak kunde annars lätt passera alla tre testen
  // (tillräckligt ljus, tillräckligt "slät" efter nedskalning, och
  // tillräckligt neutral/ofärgad) och felklassas som himmel. Verklig
  // himmel — även mulen — är typiskt betydligt ljusare än normal
  // rumsbelysning träffar en vägg med.
  //
  // JUSTERING: Något lägre ljusstyrkekrav (135 istället för 150) för att
  // inte missa mulna, mörka vinterdagar, men kompenserar med strängare
  // krav på "släthet" (lowTexture) för att undvika falska positiva inomhus.
  //
  // JUSTERING 2: När GRID_ROWS/GRID_COLS höjdes till 20x16 (för att träffa
  // trädtoppslinjen mer exakt, se modulens jsdoc) blev varje cell en MYCKET
  // mindre nedskalning av videobilden (t.ex. höjdled: bara ~4-5x nedskalning
  // istället för tidigare ~11x). Det bevarar mer verklig brus/textur per
  // cell — riktig himmel (särskilt disig/molnig himmel nära horisonten,
  // eller ljus glid mellan sol och sky) fick då ofta stdDev strax över det
  // gamla 12-gränsvärdet och klassades felaktigt som "ej himmel", vilket i
  // praktiken gjorde ATT VERKEN SÅG UT SOM OM DE STOD FRAMFÖR TRÄD ÖVERALLT
  // — hela verk tonades röda (se "Visa dolda"-läget) även med fri sikt mot
  // horisonten. Höjt stdDev-tak (18) och sänkt ljusstyrkekrav (110)
  // kompenserar för den mindre nedskalningen utan att ge upp förmågan att
  // skilja på verklig himmel och lövverk/tak (som har mycket högre textur än
  // så här, se ovan).
  const bright = avgLum > 110;
  const lowTexture = stdDev < 18;
  return bright && lowTexture && (sat < 0.25 || (blueish && avgB > avgR + 4));
}

/**
 * Analyserar kameraströmmen löpande för att uppskatta hur mycket av bilden
 * som är fri himmel kontra ockluderat av något annat (träd, byggnader,
 * terräng, väggar/tak inomhus), och en samlad "inomhus"-bedömning för hela
 * bilden — driver `outdoorConfidence`/`indoors` (ljuddämpning + "Gå
 * utomhus"-signalen).
 *
 * BORTTAGET (viktigt att inte återinföra utan mycket stark anledning): en
 * tidigare version körde en tung ML-baserad semantisk segmentering
 * (DeepLabv3/Cityscapes via TensorFlow.js) i en EGEN WebGL-kontext för att
 * ockludera enskilda vindkraftverk per pixel mot träd/byggnader. Detta
 * orsakade upprepade, bekräftade totalfrysningar/hängningar av hela appen
 * på riktiga mobiler ~1-2 sekunder efter att kameravyn startade — troligen
 * för att en andra tung WebGL-kontext (TF.js) konkurrerade med Three.js
 * AR-scenens egen WebGL-kontext om GPU:n, vilket mobil-Safari/Chrome
 * hanterar mycket dåligt (strikta gränser för samtidiga WebGL-kontexter).
 * Flera omgångar av allt striktare säkerhetsbrytare (timeout, långsamhets-
 * räknare, minnesläckage-brytare) minskade INTE frekvensen av dessa
 * hängningar i praktiken. Eftersom per-pixel-ocklusionen bara var en
 * kosmetisk finess (verken syns ändå alltid om ML inte är aktiv — se
 * `isPointSky`/`getOcclusionGrid` nedan, som redan hade en fullt
 * fungerande "visa alltid"-fallback för detta läge) togs den bort helt
 * istället för att fortsätta jaga trösklar.
 *
 * ÅTERINFÖRT (lätt variant): `isPointSky`/`getOcclusionGrid` drivs nu av
 * samma redan körande, kamera-baserade ljusstyrke/textur/mättnad-heuristik
 * (`classifyCell`) som `outdoorConfidence` bygger på — SAMMA 12x8-rutnät,
 * SAMMA canvas-2D-nedskalning (ingen WebGL, ingen ML-modell, ingen andra
 * GPU-kontext). Detta ger vindkraftverken en riktig (om än grövre än den
 * borttagna ML-segmenteringen) per-pixel-ocklusion mot träd/byggnader/
 * terräng utan att på något sätt återinföra den tunga TF.js/DeepLab-vägen
 * eller dess frysningsrisk — det är bokstavligen samma pixelanalys som
 * redan gjordes varje bildruta, bara att resultatet per cell nu även
 * sparas (temporalt utjämnat) istället för att kastas efter att bara ha
 * bidragit till den aggregerade `skyRatio`.
 */
export function useSkyDetection(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled: boolean,
): SkyDetectionState {
  const [outdoorConfidence, setOutdoorConfidence] = useState(1);
  const [indoors, setIndoors] = useState(false);
  const [ready, setReady] = useState(false);
  const [skyRatio, setSkyRatio] = useState(0);
  const [avgLuminance, setAvgLuminance] = useState(0.5);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const confidenceRef = useRef(1);
  const indoorsRef = useRef(false);

  // Ocklusionsrutnätet: 1 = himmel (visa verk), 0 = ockluderat (dölj verk).
  // Startar på "allt är himmel" och muteras på plats i `sample()` nedan —
  // samma array-instans hela komponentens livstid, EMA-utjämnad per cell
  // för att undvika flimmer. Innan `enabled`/första bildrutan gäller
  // fortfarande "verken alltid synliga", exakt som innan ocklusionen
  // återinfördes.
  const occlusionGridRef = useRef<Float32Array>(new Float32Array(GRID_COLS * GRID_ROWS).fill(1));
  const gridReadyRef = useRef(false);

  const isPointSkyRef = useRef((u: number, v: number): boolean => {
    if (!gridReadyRef.current) return true;
    const col = Math.min(GRID_COLS - 1, Math.max(0, Math.floor(u * GRID_COLS)));
    const row = Math.min(GRID_ROWS - 1, Math.max(0, Math.floor(v * GRID_ROWS)));
    return occlusionGridRef.current[row * GRID_COLS + col] >= 0.5;
  });
  const getOcclusionGridRef = useRef((): Float32Array => occlusionGridRef.current);

  useEffect(() => {
    if (!enabled) {
      confidenceRef.current = 1;
      indoorsRef.current = false;
      gridReadyRef.current = false;
      occlusionGridRef.current.fill(1);
      setOutdoorConfidence(1);
      setIndoors(false);
      setReady(false);
      setSkyRatio(0);
      setAvgLuminance(0.5);
      return;
    }

    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
      canvasRef.current.width = CANVAS_W;
      canvasRef.current.height = CANVAS_H;
    }
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    let cancelled = false;

    function applyConfidence(rawSkyRatio: number) {
      const target = Math.min(rawSkyRatio / CONFIDENCE_SKY_RATIO_SCALE, 1);
      confidenceRef.current += EMA_ALPHA * (target - confidenceRef.current);
      const nextConfidence = confidenceRef.current;

      const wasIndoors = indoorsRef.current;
      let nowIndoors = wasIndoors;
      if (wasIndoors && nextConfidence > INDOOR_EXIT_THRESHOLD) nowIndoors = false;
      if (!wasIndoors && nextConfidence < INDOOR_ENTER_THRESHOLD) nowIndoors = true;
      indoorsRef.current = nowIndoors;

      if (cancelled) return;
      setOutdoorConfidence(nextConfidence);
      setSkyRatio(rawSkyRatio);
      if (nowIndoors !== wasIndoors) setIndoors(nowIndoors);
      setReady(true);
    }

    function sample() {
      // Pausa allt arbete när fliken/appen är i bakgrunden — t.ex. skärmen
      // låst eller användaren växlat app under en lång AR-session. Sparar
      // CPU och batteri, och minskar risken att en lång bakgrundskörning
      // bidrar till frysning/överhettning över tid.
      if (document.hidden) return;

      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0) return;

      ctx!.drawImage(video, 0, 0, CANVAS_W, CANVAS_H);
      let pixels: Uint8ClampedArray;
      try {
        pixels = ctx!.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
      } catch {
        return;
      }

      let skyCount = 0;
      let lumSum = 0;
      const grid = occlusionGridRef.current;
      for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
          const isSky = classifyCell(pixels, col, row);
          if (isSky) skyCount++;
          // EMA per cell (samma alfa som `outdoorConfidence` ovan) — undviker
          // att enskilda bildrutors brus (t.ex. en gren som svajar i vinden)
          // gör att ett verk blinkar av och an. `isPointSky`/shadern läser
          // detta som tröskelvärde 0.5 med ytterligare mjuk smoothstep
          // (`OCCLUSION_THRESHOLD_LOW/HIGH` i ARScene.tsx).
          const idx = row * GRID_COLS + col;
          grid[idx] += EMA_ALPHA * ((isSky ? 1 : 0) - grid[idx]);
        }
      }
      gridReadyRef.current = true;
      for (let i = 0; i < pixels.length; i += 4) {
        lumSum += 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      }
      if (!cancelled) setAvgLuminance(lumSum / (pixels.length / 4) / 255);
      applyConfidence(skyCount / (GRID_COLS * GRID_ROWS));
    }

    const interval = window.setInterval(sample, SAMPLE_INTERVAL_MS);
    sample();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [enabled, videoRef]);

  return {
    outdoorConfidence,
    indoors,
    ready,
    isPointSky: isPointSkyRef.current,
    getOcclusionGrid: getOcclusionGridRef.current,
    method: "disabled",
    skyRatio,
    avgLuminance,
  };
}
