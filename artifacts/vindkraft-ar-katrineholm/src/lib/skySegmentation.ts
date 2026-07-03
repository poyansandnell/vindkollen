import type { SemanticSegmentation } from "@tensorflow-models/deeplab";

/**
 * Lättviktig, i webbläsaren körd semantisk segmentering (DeepLabv3,
 * Cityscapes-vikter, MobileNet-v2-baserad, kvantiserad till 2 byte) som
 * klassificerar varje pixel i kamerabilden i en av 19 klasser — vi bryr oss
 * bara om klassen "sky" (himmel). Detta ger en mer tillförlitlig
 * himmel/inte-himmel-uppdelning än den enkla ljusstyrka/textur-heuristiken i
 * `useSkyDetection.ts` (t.ex. skiljer den bättre på ett träd eller en
 * husfasad mot en riktigt molnfri himmel), men är betydligt tyngre att köra.
 *
 * Modellvikterna laddas lat, från Google/TF Hub, första gången den behövs —
 * inget bundlas i appens egna bygge. Om laddningen misslyckas (t.ex. ingen
 * nätverksanslutning, eller enheten saknar WebGL) eller modellen visar sig
 * köra för långsamt för realtidsbruk, faller `useSkyDetection` permanent
 * tillbaka till den enkla heuristiken — se `ML_SLOW_MS`/`ML_MAX_SLOW_SAMPLES`
 * där.
 */

/** Cityscapes klassfärg för "sky" (index 10 i deeplabs 19-klassers colormap). */
export const ML_SKY_COLOR: readonly [number, number, number] = [70, 130, 180];

// Nedskalad indata till modellen. DeepLab skalar ändå internt till max 513 px
// på längsta sidan, så en liten indata-canvas räcker gott och håller nere
// kostnaden för `drawImage`/canvas-läsning per bildruta.
export const ML_INPUT_WIDTH = 160;
export const ML_INPUT_HEIGHT = 120;

let modelPromise: Promise<SemanticSegmentation> | null = null;

/** Laddar (en gång, cachead för hela sessionen) DeepLabv3/Cityscapes-modellen. */
export function loadSkySegmentationModel(): Promise<SemanticSegmentation> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const tf = await import("@tensorflow/tfjs");
      await tf.ready();
      const deeplab = await import("@tensorflow-models/deeplab");
      return deeplab.load({ base: "cityscapes", quantizationBytes: 2 });
    })();
  }
  return modelPromise;
}

export interface SkySegmentationResult {
  /** Himmel-klassning per cell i ett `cols` x `rows`-rutnät, radvis ordnat. */
  grid: boolean[];
  /** Andel av rutnätet som klassades som himmel just nu (0..1). */
  skyRatio: number;
  /**
   * Antal TensorFlow.js-tensorer som just nu lever i minnet (`tf.memory()
   * .numTensors`), direkt efter denna segmentering. Används av
   * `useSkyDetection` som en oberoende säkerhetsbrytare: om detta tal växer
   * stadigt över tid (ett minnesläckage i modellen/pipelinen) stängs
   * ML-vägen av permanent innan det hinner orsaka att hela appen fryser —
   * ett komplement till den redan befintliga latens-baserade brytaren
   * (`ML_SLOW_MS`/`ML_MAX_SLOW_SAMPLES`), som inte ensam kan upptäcka ett
   * läckage som inte gör enskilda anrop långsammare.
   */
  numTensors: number;
}

/**
 * Kör en enda segmentering på given bildkälla och mappar resultatet ned till
 * samma glesa rutnät som den enkla heuristiken i `useSkyDetection` använder,
 * så att resten av appen (t.ex. `ARScene`s `isPointSky`-uppslag) inte behöver
 * bry sig om vilken metod som producerade rutnätet.
 */
export async function segmentSkyGrid(
  model: SemanticSegmentation,
  source: HTMLCanvasElement,
  cols: number,
  rows: number,
): Promise<SkySegmentationResult> {
  const { segmentationMap, width, height } = await model.segment(source);
  const grid = new Array<boolean>(cols * rows).fill(false);
  let skyCount = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const px = Math.min(width - 1, Math.floor(((col + 0.5) / cols) * width));
      const py = Math.min(height - 1, Math.floor(((row + 0.5) / rows) * height));
      const idx = (py * width + px) * 4;
      const isSky =
        segmentationMap[idx] === ML_SKY_COLOR[0] &&
        segmentationMap[idx + 1] === ML_SKY_COLOR[1] &&
        segmentationMap[idx + 2] === ML_SKY_COLOR[2];
      grid[row * cols + col] = isSky;
      if (isSky) skyCount++;
    }
  }
  let numTensors = -1;
  try {
    const tf = await import("@tensorflow/tfjs");
    numTensors = tf.memory().numTensors;
  } catch {
    // Om tf.memory() av någon anledning inte går att läsa av fortsätter vi
    // ändå — säkerhetsbrytaren i useSkyDetection ignorerar då bara denna
    // signal (numTensors: -1) istället för att krascha.
  }
  return { grid, skyRatio: skyCount / (cols * rows), numTensors };
}
