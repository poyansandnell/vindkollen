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
   * Vilken metod som just nu producerar himmelsrutnätet — nyttigt för
   * felsökning/UI, styr aldrig något beteende i sig.
   * - "loading": ML-segmenteringsmodellen laddas fortfarande i bakgrunden.
   * - "ml": DeepLabv3/Cityscapes-segmentering används (ockluderar även
   *   träd/byggnader, inte bara "inomhus").
   * - "heuristic": enkel ljusstyrka/textur-heuristik används (permanent
   *   fallback om ML-modellen misslyckades ladda eller var för långsam).
   */
  method: "loading" | "ml" | "heuristic";
}

const GRID_COLS = 12;
const GRID_ROWS = 8;
const CELL_PX = 3;
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
// och den enkla, alltid-snabba heuristiken används istället — appen ska
// aldrig hänga sig eller tappa bildfrekvens på grund av segmenteringen.
const ML_SLOW_MS = 900;
const ML_MAX_SLOW_SAMPLES = 3;

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
 * Detta är den enkla, alltid tillgängliga fallback-metoden — se modulens
 * jsdoc-kommentar och `method` i `SkyDetectionState` för hur den samspelar
 * med den tyngre ML-baserade segmenteringen i `skySegmentation.ts`.
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
  const bright = avgLum > 120;
  const lowTexture = stdDev < 20;
  return bright && lowTexture && (sat < 0.22 || (blueish && avgB > avgR + 8));
}

/**
 * Analyserar kameraströmmen löpande för att uppskatta VAR i bilden det är fri
 * himmel kontra ockluderat av något annat (träd, byggnader, terräng, väggar/
 * tak inomhus), samt en samlad "inomhus"-bedömning för hela bilden.
 *
 * Två metoder samverkar:
 * 1. En tyngre, mer tillförlitlig ML-baserad semantisk segmentering
 *    (DeepLabv3/Cityscapes via `skySegmentation.ts`) som körs i bakgrunden så
 *    fort den hunnit laddas, och som explicit klassificerar "sky" skilt från
 *    t.ex. "vegetation"/"building" — den ockluderar alltså riktiga träd och
 *    byggnader, inte bara "inomhus".
 * 2. En enkel, alltid omedelbart tillgänglig ljusstyrka/textur-heuristik
 *    (`classifyCell`) som täcker upp innan ML-modellen laddats klart, och
 *    som blir permanent fallback för resten av sessionen om modellen
 *    misslyckas ladda eller visar sig vara för långsam för realtidsbruk på
 *    enheten (se `ML_SLOW_MS`/`ML_MAX_SLOW_SAMPLES`).
 *
 * VIKTIGT — även ML-vägen är en heuristik i produktsyfte, inte en perfekt
 * djupsensor: gränser vid tunna detaljer (kvistar, ledningar) blir inte
 * pixelexakta, och ett mycket ovanligt scenario kan fortfarande
 * felklassificeras. Kombinerat med utjämning (EMA) och hysteres blir det
 * ändå en användbar, live-uppdaterad signal för att dölja vindkraftverk som
 * annars skulle synas "spöka" genom väggar/tak/träd/byggnader, och för att
 * dämpa ljudet/dBA-uppskattningen inomhus.
 */
export function useSkyDetection(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled: boolean,
): SkyDetectionState {
  const [outdoorConfidence, setOutdoorConfidence] = useState(1);
  const [indoors, setIndoors] = useState(false);
  const [ready, setReady] = useState(false);
  const [method, setMethod] = useState<"loading" | "ml" | "heuristic">("loading");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mlCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const gridRef = useRef<boolean[]>(new Array(GRID_COLS * GRID_ROWS).fill(true));
  const confidenceRef = useRef(1);
  const indoorsRef = useRef(false);

  const mlModelRef = useRef<SemanticSegmentation | null>(null);
  const mlStateRef = useRef<"loading" | "ready" | "disabled">("loading");
  const mlBusyRef = useRef(false);
  const mlSlowCountRef = useRef(0);

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

    function applySkyRatio(skyRatio: number, usedMethod: "ml" | "heuristic") {
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
      setMethod((prev) => (prev === usedMethod ? prev : usedMethod));
    }

    function sampleHeuristic(video: HTMLVideoElement) {
      ctx!.drawImage(video, 0, 0, CANVAS_W, CANVAS_H);
      let pixels: Uint8ClampedArray;
      try {
        pixels = ctx!.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
      } catch {
        return;
      }

      let skyCount = 0;
      const grid = gridRef.current;
      for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
          const isSky = classifyCell(pixels, col, row);
          grid[row * GRID_COLS + col] = isSky;
          if (isSky) skyCount++;
        }
      }
      applySkyRatio(skyCount / (GRID_COLS * GRID_ROWS), "heuristic");
    }

    async function sampleMl(video: HTMLVideoElement) {
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

      const start = performance.now();
      try {
        const { grid, skyRatio } = await segmentSkyGrid(model, mlCanvas, GRID_COLS, GRID_ROWS);
        const elapsed = performance.now() - start;
        if (elapsed > ML_SLOW_MS) {
          mlSlowCountRef.current += 1;
          if (mlSlowCountRef.current >= ML_MAX_SLOW_SAMPLES) {
            mlStateRef.current = "disabled";
          }
        } else {
          mlSlowCountRef.current = 0;
        }
        if (cancelled) return;
        gridRef.current = grid;
        applySkyRatio(skyRatio, "ml");
      } catch {
        // En enskild bildruta misslyckades (t.ex. WebGL-kontext tillfälligt
        // upptagen) — räkna som en "långsam"/misslyckad sampling istället för
        // att krascha; efter tillräckligt många faller vi tillbaka permanent.
        mlSlowCountRef.current += 1;
        if (mlSlowCountRef.current >= ML_MAX_SLOW_SAMPLES) {
          mlStateRef.current = "disabled";
        }
      }
    }

    function sample() {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0) return;

      if (mlStateRef.current === "ready" && !mlBusyRef.current) {
        mlBusyRef.current = true;
        void sampleMl(video).finally(() => {
          mlBusyRef.current = false;
        });
        return;
      }

      // ML laddas fortfarande, eller är avstängd (misslyckad/långsam) — kör
      // alltid den snabba heuristiken så att himmelsmasken aldrig saknas.
      sampleHeuristic(video);
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
