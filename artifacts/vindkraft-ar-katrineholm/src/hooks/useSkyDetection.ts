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

const GRID_COLS = 12;
const GRID_ROWS = 8;
// 8x8 pixlar per cell (inte 3x3) — ger textur-signalen (`stdDev`) faktiskt
// något att mäta. Med bara 3x3 källpixlar nedskalas nästan all textur bort
// redan innan klassificeringen, vilket gjorde att en jämnt målad, ljus
// innervägg/innertak lätt missklassades som himmel (se INDOOR_ENTER/EXIT).
const CELL_PX = 8;
const CANVAS_W = GRID_COLS * CELL_PX;
const CANVAS_H = GRID_ROWS * CELL_PX;
const SAMPLE_INTERVAL_MS = 350;
const EMA_ALPHA = 0.18;
// Konfidensen når 1.0 redan vid ~25% himmelsandel i bilden — man pekar
// sällan kameran rakt upp, så ute i det fria räcker det med ett gott stycke
// himmel över horisonten för att räknas som "utomhus, fri sikt".
const CONFIDENCE_SKY_RATIO_SCALE = 0.25;
// Hysteres: kräver en tydlig marginal mellan tröskelvärdena innan status
// växlar, så att gränsfall (t.ex. nära ett fönster) inte flimrar.
const INDOOR_ENTER_THRESHOLD = 0.12;
const INDOOR_EXIT_THRESHOLD = 0.32;

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
const ML_SLOW_MS = 3000;
const ML_MAX_SLOW_SAMPLES = 6;

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
  const bright = avgLum > 150;
  const lowTexture = stdDev < 14;
  return bright && lowTexture && (sat < 0.18 || (blueish && avgB > avgR + 8));
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

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mlCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Ocklusionsrutnätet (`isPointSky`) — börjar och stannar "allt är himmel"
  // (ingen ocklusion) tills ML-segmenteringen faktiskt är igång och
  // levererar ett riktigt rutnät. Detta ÄR fallback-beteendet: om ML aldrig
  // laddas eller stängs av permanent, förblir detta rutnät oförändrat och
  // verken syns alltid, precis som innan denna funktion fanns.
  const gridRef = useRef<boolean[]>(new Array(GRID_COLS * GRID_ROWS).fill(true));
  const confidenceRef = useRef(1);
  const indoorsRef = useRef(false);

  const mlModelRef = useRef<SemanticSegmentation | null>(null);
  const mlStateRef = useRef<"loading" | "ready" | "disabled">("loading");
  const mlBusyRef = useRef(false);
  const mlSlowCountRef = useRef(0);
  // Den allra första ML-inferensen efter att modellen blivit redo måste
  // kompilera WebGL-shaders m.m. och är därför alltid betydligt långsammare
  // än stationärt läge — räknas inte mot slow-tröskeln, annars riskerar en
  // enda kall uppstart att bidra i onödan till en permanent avstängning.
  const mlWarmedUpRef = useRef(false);

  // Stabil funktionsreferens — läser alltid det senaste rutnätet via
  // `gridRef` (oavsett om det just nu kommer från ML-segmenteringen eller
  // den enkla heuristiken), men själva funktionsidentiteten ändras aldrig.
  // Det gör den säker att skicka som prop till ARScene utan att trigga
  // om-renderingar.
  const isPointSkyRef = useRef((u: number, v: number) => {
    const col = Math.min(GRID_COLS - 1, Math.max(0, Math.floor(u * GRID_COLS)));
    const row = Math.min(GRID_ROWS - 1, Math.max(0, Math.floor(v * GRID_ROWS)));
    return gridRef.current[row * GRID_COLS + col];
  });

  useEffect(() => {
    if (!enabled) {
      confidenceRef.current = 1;
      indoorsRef.current = false;
      gridRef.current.fill(true);
      setOutdoorConfidence(1);
      setIndoors(false);
      setReady(false);
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
    function applyConfidence(skyRatio: number) {
      const target = Math.min(skyRatio / CONFIDENCE_SKY_RATIO_SCALE, 1);
      confidenceRef.current += EMA_ALPHA * (target - confidenceRef.current);
      const nextConfidence = confidenceRef.current;

      const wasIndoors = indoorsRef.current;
      let nowIndoors = wasIndoors;
      if (wasIndoors && nextConfidence > INDOOR_EXIT_THRESHOLD) nowIndoors = false;
      if (!wasIndoors && nextConfidence < INDOOR_ENTER_THRESHOLD) nowIndoors = true;
      indoorsRef.current = nowIndoors;

      if (cancelled) return;
      setOutdoorConfidence(nextConfidence);
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
      for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
          if (classifyCell(pixels, col, row)) skyCount++;
        }
      }
      applyConfidence(skyCount / (GRID_COLS * GRID_ROWS));
    }

    // Driver den VISUELLA ocklusionen (`isPointSky`/`gridRef`) — enda
    // källan till detta är ML-segmenteringen. Om den inte är redo (fortfarande
    // laddas, eller permanent avstängd efter fel/prestandaproblem) rör vi
    // aldrig `gridRef`, som då förblir "allt är himmel" (ingen ocklusion) —
    // det är precis fallback-beteendet uppgiften kräver: verken syns alltid,
    // exakt som innan denna funktion fanns.
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

      const isWarmup = !mlWarmedUpRef.current;
      const start = performance.now();
      try {
        const { grid, skyRatio } = await segmentSkyGrid(model, mlCanvas, GRID_COLS, GRID_ROWS);
        const elapsed = performance.now() - start;
        mlWarmedUpRef.current = true;
        if (elapsed > ML_SLOW_MS && !isWarmup) {
          mlSlowCountRef.current += 1;
          if (mlSlowCountRef.current >= ML_MAX_SLOW_SAMPLES) {
            mlStateRef.current = "disabled";
          }
        } else {
          mlSlowCountRef.current = 0;
        }
        if (cancelled) return;
        gridRef.current = grid;
        // ML:s eget himmel-mått är mer träffsäkert än ljusstyrke-heuristiken
        // (skiljer t.ex. riktig himmel från en ljus vit vägg) — använd det
        // för ljuddämpningen/"Gå utomhus" också när det finns tillgängligt.
        applyConfidence(skyRatio);
      } catch {
        // En enskild bildruta misslyckades (t.ex. WebGL-kontext tillfälligt
        // upptagen) — räkna som en "långsam"/misslyckad sampling istället för
        // att krascha; efter tillräckligt många faller vi tillbaka permanent.
        // Ett fel under själva uppstarten (t.ex. shader-kompilering) räknas
        // inte heller mot tröskeln.
        if (!isWarmup) {
          mlSlowCountRef.current += 1;
          if (mlSlowCountRef.current >= ML_MAX_SLOW_SAMPLES) {
            mlStateRef.current = "disabled";
          }
        }
      }
      // Om DENNA sampling (lyckad eller ej) var den som korsade
      // slow/error-tröskeln och stängde av ML permanent, nollställ
      // ocklusionen till "allt är himmel" omedelbart — annars skulle en nu
      // inaktuell mask (t.ex. från strax innan enheten blev för långsam)
      // kunna bli kvar permanent istället för att falla tillbaka korrekt.
      if (cancelled) return;
      if (mlStateRef.current === "disabled") {
        gridRef.current.fill(true);
        setMethod("disabled");
      } else {
        setMethod("ml");
      }
    }

    function sample() {
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
        setMethod("disabled");
      }
      // mlStateRef.current === "loading": `method` förblir "loading" och
      // `gridRef` förblir "allt är himmel" tills modellen är redo.
    }

    const interval = window.setInterval(sample, SAMPLE_INTERVAL_MS);
    sample();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [enabled, videoRef]);

  return { outdoorConfidence, indoors, ready, isPointSky: isPointSkyRef.current, method };
}
