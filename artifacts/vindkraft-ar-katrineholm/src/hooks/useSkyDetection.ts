import { useEffect, useRef, useState } from "react";
import { loadSkySegmentationModel, segmentSkyGrid } from "@/lib/skySegmentation";
import type { SemanticSegmentation } from "@tensorflow-models/deeplab";

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
   * där (0,0) är övre vänstra hörnet) för närvarande klassas som himmel —
   * dvs. inte skymd av träd, byggnad, terräng, tak eller vägg. Stabil
   * funktionsreferens (ändras aldrig), säker att anropa varje bildruta i
   * AR-scenens renderloop.
   */
  isPointSky: (u: number, v: number) => boolean;
  /**
   * Stabil funktionsreferens som returnerar HELA ocklusionsrutnätet (inte
   * bara en enskild punkt) som ett kontinuerligt (0..1 per cell,
   * temporalt EMA-utjämnat mellan varje sample för att undvika flimmer),
   * radvis (row-major, `GRID_COLS` x `GRID_ROWS`) `Float32Array`.
   * Används av `ARScene` för att bygga en `THREE.DataTexture` som
   * ockluderar vindkraftverk PER PIXEL/FRAGMENT (bara den täckta delen av
   * ett verk döljs) istället för hela verket via en enda ankarpunkt.
   * 1 = himmel (synligt), 0 = ockluderat (träd/byggnad/vägg/inomhus).
   * Funktionsidentiteten ändras aldrig — säker att läsa varje bildruta.
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
   * Vilket läge himmel-ocklusionen (`isPointSky`) just nu befinner sig i —
   * nyttigt för felsökning/UI, styr aldrig något annat beteende i sig.
   * - "loading": ML-segmenteringsmodellen laddas fortfarande i bakgrunden.
   *   `isPointSky` returnerar alltid true (ingen ocklusion) tills modellen
   *   är redo — verken syns precis som innan denna funktion fanns.
   * - "ml": DeepLabv3/Cityscapes-segmentering körs och styr `isPointSky`
   *   (ockluderar träd/byggnader/terräng/inomhus, inte bara "inomhus").
   * - "disabled": modellen misslyckades ladda, eller visade sig vara för
   *   långsam på enheten — permanent fallback för resten av sessionen.
   *   `isPointSky` returnerar alltid true (ingen ocklusion), dvs. exakt
   *   samma beteende som innan denna funktion fanns.
   *
   * OBS: `outdoorConfidence`/`indoors` (ljuddämpning + "Gå utomhus") är en
   * separat, redan tidigare befintlig funktion som ALLTID uppdateras av den
   * enkla heuristiken varje bildruta (oavsett `method`), men förfinas med
   * ML-segmenteringens (mer träffsäkra) himmelsandel också när den är
   * tillgänglig. Denna signal fortsätter alltså fungera identiskt oavsett
   * om ML lyckas ladda — den kan bara bli MER exakt, aldrig sluta fungera.
   */
  method: "loading" | "ml" | "disabled";
}

export const GRID_COLS = 12;
export const GRID_ROWS = 8;
// EMA-utjämningsfaktor för det kontinuerliga ocklusionsrutnätet
// (`occlusionGridRef`, se `getOcclusionGrid`) — lägre värde än det befintliga
// `EMA_ALPHA` för `outdoorConfidence`, eftersom detta rutnät driver en visuell
// per-pixel-mask (shader) snarare än en enda sammanfattande siffra: för snabb
// utjämning skulle fortfarande hinna flimra vid gränsen mellan himmel/inte-
// himmel när ett verk rör sig i bild, medan för långsam gör ocklusionen
// märkbart "trög" efter en snabb kamerarörelse. ~3 samples (≈1s) för att nå
// halva vägen till ett nytt värde är en rimlig avvägning.
const OCCLUSION_GRID_EMA_ALPHA = 0.5;
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

// Om en enskild ML-segmentering tar längre än detta anses den för långsam
// för realtidsbruk på den här enheten. Efter `ML_MAX_SLOW_SAMPLES` sådana
// (icke nödvändigtvis i följd) stängs ML-vägen av permanent för sessionen
// och verken förblir alltid synliga istället — appen ska aldrig hänga sig
// eller tappa bildfrekvens på grund av segmenteringen.
//
// DeepLab är en tung modell för mobilwebbläsare: ett par sekunder per
// bildruta på ett mellanklass-mobilnät är fortfarande fullt användbart för
// en långsamt uppdaterad ocklusionsmask (till skillnad från t.ex. kamerans
// egna 30/60 fps-krav) — sätt tröskeln därefter, annars stängs ML av
// permanent inom någon sekund på de flesta telefoner och ocklusionen
// fungerar i praktiken aldrig.
const ML_SLOW_MS = 2500;
const ML_MAX_SLOW_SAMPLES = 4;
const ML_INFERENCE_TIMEOUT_MS = 5000;

// Tensor-läckage-brytaren: hur många fler tensorer än baslinjen som anses
// vara ett tecken på en läcka snarare än normal brus/variation mellan
// anrop, och hur många på varandra följande sådana samples som krävs innan
// ML stängs av permanent. Generöst tilltaget (läckor växer obegränsat över
// tid, så ens ett högt men konstant tröskelvärde fångar dem till slut) för
// att undvika falska positiva på enheter som legitimt håller fler tensorer
// vid liv (t.ex. WebGL-texturcache).
const ML_TENSOR_GROWTH_THRESHOLD = 80;
const ML_TENSOR_GROWTH_MAX_SAMPLES = 5;

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
 * Denna heuristik driver ENDAST `outdoorConfidence`/`indoors` (den redan
 * sedan tidigare befintliga ljuddämpningen/"Gå utomhus"-signalen) — den
 * används inte längre för att ockludera vindkraftverk visuellt. Se modulens
 * jsdoc-kommentar och `method` i `SkyDetectionState` för hur den samspelar
 * med den tyngre ML-baserade segmenteringen i `skySegmentation.ts`, som är
 * den enda källan till visuell ocklusion (`isPointSky`).
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
  const bright = avgLum > 135;
  const lowTexture = stdDev < 12;
  return bright && lowTexture && (sat < 0.2 || (blueish && avgB > avgR + 6));
}

/**
 * Analyserar kameraströmmen löpande för att uppskatta VAR i bilden det är fri
 * himmel kontra ockluderat av något annat (träd, byggnader, terräng, väggar/
 * tak inomhus), samt en samlad "inomhus"-bedömning för hela bilden.
 *
 * Två separata mekanismer, med olika ansvar:
 * 1. **Visuell ocklusion** (`isPointSky`/`method`): styrs uteslutande av en
 *    ML-baserad semantisk segmentering (DeepLabv3/Cityscapes via
 *    `skySegmentation.ts`) som laddas lat i bakgrunden och explicit
 *    klassificerar "sky" skilt från t.ex. "vegetation"/"building" — den
 *    ockluderar alltså riktiga träd och byggnader, inte bara "inomhus".
 *    Tills modellen är klar, eller om den permanent stängs av (misslyckad
 *    laddning, eller för långsam — se `ML_SLOW_MS`/`ML_MAX_SLOW_SAMPLES`),
 *    ändras aldrig ocklusionsrutnätet: verken förblir alltid synliga, precis
 *    som innan denna funktion fanns. Detta ÄR fallback-kravet — det finns
 *    ingen sekundär, mindre tillförlitlig ocklusionsheuristik som tar över.
 * 2. **Ljuddämpning/"Gå utomhus"** (`outdoorConfidence`/`indoors`): en redan
 *    sedan tidigare befintlig, alltid omedelbart tillgänglig ljusstyrka/
 *    textur-heuristik (`classifyCell`) som körs kontinuerligt oavsett
 *    ML-status, så signalen aldrig försvinner. När ML-segmenteringen är
 *    igång förfinas samma signal med dess (mer träffsäkra) himmelsandel —
 *    men fungerar identiskt, oberoende av (1), om ML aldrig blir
 *    tillgänglig.
 *
 * VIKTIGT — ML-segmenteringen är en heuristik i produktsyfte, inte en
 * perfekt djupsensor: gränser vid tunna detaljer (kvistar, ledningar) blir
 * inte pixelexakta, och ett mycket ovanligt scenario kan fortfarande
 * felklassificeras. Kombinerat med hysteres/EMA på ljudsidan blir det ändå
 * en användbar, live-uppdaterad signal för att dölja vindkraftverk som
 * annars skulle synas "spöka" genom väggar/tak/träd/byggnader.
 */
export function useSkyDetection(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled: boolean,
): SkyDetectionState {
  const [outdoorConfidence, setOutdoorConfidence] = useState(1);
  const [indoors, setIndoors] = useState(false);
  const [ready, setReady] = useState(false);
  const [method, setMethod] = useState<"loading" | "ml" | "disabled">("loading");
  const [skyRatio, setSkyRatio] = useState(0);
  const [avgLuminance, setAvgLuminance] = useState(0.5);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mlCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Ocklusionsrutnätet (`isPointSky`) — börjar "ingen himmel" (allt dolt)
  // tills vi faktiskt har ett bekräftat sample. Konservativt val enligt
  // produktkravet: hellre dölja verken än att visa dem felaktigt innan
  // appen vet något om vad kameran ser.
  const gridRef = useRef<boolean[]>(new Array(GRID_COLS * GRID_ROWS).fill(false));
  // Kontinuerligt (0..1), temporalt EMA-utjämnat ocklusionsrutnät — se
  // `getOcclusionGrid`s jsdoc. Startar på 0 (allt ockluderat); detta är dock
  // BARA det ML-drivna rutnätet — se `getOcclusionGridRef` för hur fallback
  // (ML ej redo/avstängd) hanteras separat och ALLTID visar "allt är himmel".
  const occlusionGridRef = useRef<Float32Array>(new Float32Array(GRID_COLS * GRID_ROWS).fill(0));
  // Återanvänd, alltid-noll rutnät att returnera när `indoorsRef.current` är
  // sant — undviker att allokera en ny array varje bildruta.
  const indoorZeroGridRef = useRef<Float32Array>(new Float32Array(GRID_COLS * GRID_ROWS).fill(0));
  // Återanvänd, alltid-ett ("allt är himmel") rutnät att returnera från
  // `getOcclusionGrid` när ML-segmenteringen inte är aktiv (fortfarande
  // laddas, eller permanent avstängd) — detta ÄR fallback-kravet: exakt
  // samma "verken alltid synliga"-beteende som innan ML-ocklusionen fanns,
  // ingen sekundär heuristik-baserad ocklusion tar över.
  const allSkyGridRef = useRef<Float32Array>(new Float32Array(GRID_COLS * GRID_ROWS).fill(1));
  const confidenceRef = useRef(1);
  const indoorsRef = useRef(false);
  // Mirror av `method`-staten i en ref, så att den stabila `isPointSkyRef`-
  // funktionen (som aldrig byter identitet, se nedan) alltid kan läsa det
  // senaste läget utan att behöva finnas med som effekt-beroende.
  const methodRef = useRef<"loading" | "ml" | "disabled">("loading");

  const mlModelRef = useRef<SemanticSegmentation | null>(null);
  const mlStateRef = useRef<"loading" | "ready" | "disabled">("loading");
  const mlBusyRef = useRef(false);
  const mlSlowCountRef = useRef(0);
  // Den allra FÖRSTA ML-inferensen (oavsett om den lyckas eller ej) efter att
  // modellen blivit redo måste kompilera WebGL-shaders m.m. och är därför
  // alltid betydligt långsammare — den ENDA gången räknas inte försöket mot
  // slow/fel-tröskeln. Detta är en engångs-räknare, INTE villkorad på att
  // försöket faktiskt lyckas: om inferensen aldrig lyckas (t.ex. en
  // körtidsinkompatibilitet som alltid time:as ut) måste efterföljande försök
  // ändå räknas, annars skulle ML aldrig stängas av permanent och appen
  // fortsätter försöka om och om igen istället för att falla tillbaka.
  const mlAttemptCountRef = useRef(0);
  // Genereringstoken: varje `sampleMlOcclusion`-anrop får ett unikt nummer.
  // Om en inferens time:ar ut väntar vi ändå in den underliggande GPU-
  // beräkningen (utan att tillämpa dess resultat) innan `mlBusyRef` släpps,
  // så att aldrig fler än EN riktig inferens kan vara igång samtidigt — annars
  // skulle en långsam enhet kunna stapla upp flera parallella GPU-anrop och
  // själv orsaka den frysning fallbacken ska förhindra.
  const mlGenerationRef = useRef(0);
  // Säkerhetsbrytare mot ett eventuellt minnesläckage i ML-pipelinen: sparar
  // hur många levande TF.js-tensorer som fanns direkt efter uppvärmningen,
  // och håller reda på hur många på varandra följande samples som visar en
  // fortsatt växande tensorräkning därefter. Om den växer stadigt (istället
  // för att plana ut, vilket normal drift gör) stängs ML av permanent —
  // exakt samma fallback-väg som den redan befintliga latens-brytaren,
  // eftersom en läcka annars kan orsaka att hela appen fryser efter en
  // längre stunds användning utan att någonsin göra ETT enskilt anrop
  // tillräckligt långsamt för att triggra `ML_SLOW_MS`.
  const mlTensorBaselineRef = useRef<number | null>(null);
  const mlTensorGrowthCountRef = useRef(0);

  // Stabil funktionsreferens — läser alltid det senaste rutnätet via
  // `gridRef` när ML-segmenteringen är aktiv, annars fallback-kravet
  // ("allt är himmel", se nedan). Själva funktionsidentiteten ändras aldrig,
  // vilket gör den säker att skicka som prop till ARScene utan att trigga
  // om-renderingar.
  const isPointSkyRef = useRef((u: number, v: number) => {
    // ML-segmenteringen är den ENDA källan till visuell ocklusion (inkl.
    // "inomhus"-spärren nedan). Om den inte är igång (fortfarande laddas,
    // eller permanent avstängd) gäller fallback-kravet ovillkorligt: verken
    // förblir alltid synliga, exakt som innan denna funktion fanns — varken
    // den kamerabaserade inomhus-heuristiken eller någon sekundär, mindre
    // tillförlitlig heuristik får döljä verk på egen hand i det läget.
    if (methodRef.current !== "ml") return true;
    // Global spärr (endast när ML faktiskt är aktiv): så fort den
    // alltid-aktiva heuristiken bedömer att användaren är inomhus döljs
    // samtliga verk, oavsett vad ML-rutnätet råkar säga om just den här
    // punkten — en enstaka ljus lampa/fönster i bild ska t.ex. inte räcka
    // för att låta ett verk "spöka" fram inomhus.
    if (indoorsRef.current) return false;
    const col = Math.min(GRID_COLS - 1, Math.max(0, Math.floor(u * GRID_COLS)));
    const row = Math.min(GRID_ROWS - 1, Math.max(0, Math.floor(v * GRID_ROWS)));
    const idx = row * GRID_COLS + col;
    return gridRef.current[idx];
  });

  // Stabil funktionsreferens för det kontinuerliga rutnätet — se
  // `getOcclusionGrid`s jsdoc i `SkyDetectionState`.
  const getOcclusionGridRef = useRef((): Float32Array => {
    // Samma fallback-krav som `isPointSkyRef` ovan, kontrollerat FÖRST och
    // ovillkorligt: utan aktiv ML-segmentering är HELA rutnätet "himmel"
    // (inga verk döljs av den kontinuerliga masken), oavsett inomhus-status.
    if (methodRef.current !== "ml") return allSkyGridRef.current;
    if (indoorsRef.current) return indoorZeroGridRef.current;
    return occlusionGridRef.current;
  });

  // Uppdaterar `occlusionGridRef` med ett EMA-steg mot ett rått booleskt
  // rutnät — anropas en gång per sample med ML-segmenteringens rutnät (enda
  // källan till visuell ocklusion, se `sampleMlOcclusion` nedan).
  function smoothOcclusionGrid(rawGrid: boolean[]) {
    const smoothed = occlusionGridRef.current;
    for (let i = 0; i < smoothed.length; i++) {
      const target = rawGrid[i] ? 1 : 0;
      smoothed[i] += OCCLUSION_GRID_EMA_ALPHA * (target - smoothed[i]);
    }
  }

  useEffect(() => {
    if (!enabled) {
      confidenceRef.current = 1;
      indoorsRef.current = false;
      methodRef.current = "loading";
      gridRef.current.fill(false);
      mlTensorBaselineRef.current = null;
      mlTensorGrowthCountRef.current = 0;
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

    // Laddar ML-segmenteringsmodellen i bakgrunden. Kastar den — t.ex. ingen
    // nätverksanslutning eller ingen WebGL-backend tillgänglig — förblir
    // `mlStateRef` på "loading" -> sätts till "disabled" och den enkla
    // heuristiken används resten av sessionen. Ingen krasch, ingen frysning.
    loadSkySegmentationModel()
      .then((model) => {
        if (cancelled) return;
        mlModelRef.current = model;
        mlStateRef.current = "ready";
      })
      .catch(() => {
        if (cancelled) return;
        mlStateRef.current = "disabled";
      });

    // Driver ENDAST `outdoorConfidence`/`indoors` (ljuddämpning + "Gå
    // utomhus" — redan befintlig funktion sedan tidigare). Körs alltid,
    // oavsett ML-status, så detta beteende aldrig påverkas av om
    // segmenteringsmodellen lyckas ladda eller inte.
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

    function sampleHeuristicConfidence(video: HTMLVideoElement) {
      ctx!.drawImage(video, 0, 0, CANVAS_W, CANVAS_H);
      let pixels: Uint8ClampedArray;
      try {
        pixels = ctx!.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
      } catch {
        return;
      }

      let skyCount = 0;
      let lumSum = 0;
      for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
          if (classifyCell(pixels, col, row)) skyCount++;
        }
      }
      for (let i = 0; i < pixels.length; i += 4) {
        lumSum += 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      }
      if (!cancelled) setAvgLuminance(lumSum / (pixels.length / 4) / 255);
      applyConfidence(skyCount / (GRID_COLS * GRID_ROWS));
    }

    // Driver den VISUELLA ocklusionen (`isPointSky`/`gridRef`) — enda
    // källan till detta är ML-segmenteringen. Om den inte är redo (fortfarande
    // laddas, eller permanent avstängd efter fel/prestandaproblem) rör vi
    // aldrig `gridRef` — `isPointSkyRef`/`getOcclusionGrid` faller då själva
    // tillbaka på "allt är himmel" (se `allSkyGridRef` ovan) istället för
    // någon sekundär heuristik, så verken förblir alltid synliga precis som
    // innan ML-ocklusionen fanns.
    async function sampleMlOcclusion(video: HTMLVideoElement) {
      const model = mlModelRef.current;
      if (!model) return;
      if (!mlCanvasRef.current) {
        mlCanvasRef.current = document.createElement("canvas");
      }
      const mlCanvas = mlCanvasRef.current;
      mlCanvas.width = 160;
      mlCanvas.height = 120;
      const mlCtx = mlCanvas.getContext("2d");
      if (!mlCtx) return;
      mlCtx.drawImage(video, 0, 0, mlCanvas.width, mlCanvas.height);

      // Engångsundantag (se `mlAttemptCountRef`s jsdoc ovan) — gäller ENDAST
      // det allra första försöket, oavsett utfall, aldrig fler.
      const isWarmupAttempt = mlAttemptCountRef.current === 0;
      mlAttemptCountRef.current += 1;
      const generation = ++mlGenerationRef.current;
      const start = performance.now();

      function countFailureOrSlow() {
        if (isWarmupAttempt) return;
        mlSlowCountRef.current += 1;
        if (mlSlowCountRef.current >= ML_MAX_SLOW_SAMPLES) {
          mlStateRef.current = "disabled";
        }
      }

      const workPromise = segmentSkyGrid(model, mlCanvas, GRID_COLS, GRID_ROWS);
      const timedOut = await Promise.race([
        workPromise.then(() => false),
        new Promise<true>((resolve) => setTimeout(() => resolve(true), ML_INFERENCE_TIMEOUT_MS)),
      ]);

      if (timedOut) {
        // Watchdog: inferensen tar orimligt lång tid (t.ex. hänger sig i
        // WebGL-drivern). Räkna omedelbart som ett misslyckat/långsamt försök
        // så att permanent avstängning kan triggas även om denna specifika
        // GPU-beräkning aldrig avslutas.
        countFailureOrSlow();
        // VIKTIGT: vi låter ändå den bakomliggande `workPromise` göra klart
        // (resultatet ignoreras nedan eftersom det då är inaktuellt) innan
        // funktionen returnerar och därmed `mlBusyRef` släpps i `sample()`.
        // Annars skulle nästa sampling-tick kunna starta en NY inferens
        // ovanpå den redan hängande — flera parallella GPU-anrop skulle
        // kunna stapla upp sig och själva orsaka den frysning som fallbacken
        // ska förhindra.
        try {
          await workPromise;
        } catch {
          // Redan räknat ovan via timeout-grenen; inget mer att göra.
        }
        if (cancelled) return;
        if (mlStateRef.current === "disabled") {
          methodRef.current = "disabled";
          setMethod("disabled");
        }
        return;
      }

      try {
        const { grid, skyRatio: mlSkyRatio, numTensors } = await workPromise;
        // Om en NYARE sampling redan hunnit starta (t.ex. om denna själv
        // råkade bli klar strax efter att ha timeoutat en gång) är resultatet
        // inaktuellt — släng det och rör varken räknare eller rutnät.
        if (generation !== mlGenerationRef.current) return;
        const elapsed = performance.now() - start;
        if (elapsed > ML_SLOW_MS) {
          countFailureOrSlow();
        } else if (!isWarmupAttempt) {
          mlSlowCountRef.current = 0;
        }
        // Tensor-läckage-brytare — se konstant-kommentaren ovan. `-1` betyder
        // att `tf.memory()` inte gick att läsa av (t.ex. import misslyckades);
        // ignorera signalen då istället för att räkna det som tillväxt.
        if (numTensors >= 0 && !isWarmupAttempt) {
          if (mlTensorBaselineRef.current === null) {
            mlTensorBaselineRef.current = numTensors;
          } else if (numTensors - mlTensorBaselineRef.current > ML_TENSOR_GROWTH_THRESHOLD) {
            mlTensorGrowthCountRef.current += 1;
            if (mlTensorGrowthCountRef.current >= ML_TENSOR_GROWTH_MAX_SAMPLES) {
              mlStateRef.current = "disabled";
            }
          } else {
            mlTensorGrowthCountRef.current = 0;
          }
        }
        if (cancelled) return;
        gridRef.current = grid;
        smoothOcclusionGrid(grid);
        // ML:s eget himmel-mått är mer träffsäkert än ljusstyrke-heuristiken
        // (skiljer t.ex. riktig himmel från en ljus vit vägg) — använd det
        // för ljuddämpningen/"Gå utomhus" också när det finns tillgängligt.
        applyConfidence(mlSkyRatio);
      } catch {
        // En enskild bildruta misslyckades (t.ex. WebGL-kontext tillfälligt
        // upptagen) — räkna som en "långsam"/misslyckad sampling istället för
        // att krascha; efter tillräckligt många faller vi tillbaka permanent.
        countFailureOrSlow();
      }
      // Om DENNA sampling (lyckad eller ej) var den som korsade
      // slow/error-tröskeln och stängde av ML permanent, nollställ
      // ocklusionen till "allt är himmel" omedelbart — annars skulle en nu
      // inaktuell mask (t.ex. från strax innan enheten blev för långsam)
      // kunna bli kvar permanent istället för att falla tillbaka korrekt.
      if (cancelled) return;
      if (mlStateRef.current === "disabled") {
        methodRef.current = "disabled";
        setMethod("disabled");
      } else {
        methodRef.current = "ml";
        setMethod("ml");
      }
    }

    function sample() {
      // Pausa allt arbete (heuristik + ML) när fliken/appen är i bakgrunden —
      // t.ex. skärmen låst eller användaren växlat app under en lång AR-
      // session. Sparar CPU/GPU och batteri, och minskar risken att en lång
      // bakgrundskörning bidrar till frysning/överhettning över tid.
      if (document.hidden) return;

      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0) return;

      // Ljud-/"Gå utomhus"-signalen är oberoende av ML-status.
      sampleHeuristicConfidence(video);

      if (mlStateRef.current === "ready" && !mlBusyRef.current) {
        mlBusyRef.current = true;
        void sampleMlOcclusion(video).finally(() => {
          mlBusyRef.current = false;
        });
      } else if (mlStateRef.current === "disabled") {
        methodRef.current = "disabled";
        setMethod("disabled");
      }
      // mlStateRef.current === "loading": `method`/`methodRef` förblir
      // "loading" och `isPointSkyRef`/`getOcclusionGrid` använder
      // fallback-kravet ("allt är himmel") tills modellen är redo (eller
      // stängs av permanent).
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
    method,
    skyRatio,
    avgLuminance,
  };
}
