import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { bearingDegrees, distanceMeters, formatDistance } from "@/lib/geo";
import type { TurbineSweref } from "@/lib/turbines";
import { swerefToWgs84 } from "@/lib/sweref";
import { getCurrentSunPosition } from "@/lib/sunPosition";
import { getBladeRpm, getBladeStartAngleRad, getBlinkOffsetMs, getBlinkPeriodMs, BLINK_ON_MS } from "@/lib/turbineAnimation";
import { shadowFlickerActive, type SunMode, type VisibilityLevel } from "@/lib/visualizationTypes";
import { GRID_COLS, GRID_ROWS } from "@/hooks/useSkyDetection";

interface ARSceneProps {
  userLat: number;
  userLon: number;
  quaternionRef: React.MutableRefObject<THREE.Quaternion>;
  turbines: TurbineSweref[];
  sunMode: SunMode;
  realScale: boolean;
  visibility: VisibilityLevel;
  nightMode: boolean;
  shadowFlicker: boolean;
  /**
   * Slår upp om en normaliserad skärmpunkt (u, v i 0..1) klassas som himmel
   * just nu (se `useSkyDetection`). Om utelämnad antas allt vara himmel —
   * verken tonas då aldrig bort. Måste vara en stabil funktionsreferens
   * (ändras inte varje render) eftersom den anropas i renderloopen.
   */
  isPointSky?: (u: number, v: number) => boolean;
  /**
   * Returnerar HELA det kontinuerliga (0..1 per cell, temporalt utjämnat)
   * ocklusionsrutnätet — se `useSkyDetection`s `getOcclusionGrid`-jsdoc.
   * Driver den PER-PIXEL-baserade ocklusionsshadern på själva
   * turbinkroppen (torn/navcell/blad), så bara den faktiskt skymda delen
   * av ett verk döljs, istället för att hela verket tonas bort baserat på
   * en enda ankarpunkt (vilket `isPointSky` fortfarande gör, och
   * fortsätter användas för etiketter/ljus/glöd/skugga — se `animate`).
   * Om utelämnad antas allt vara himmel. Måste vara en stabil
   * funktionsreferens (anropas i renderloopen).
   */
  getOcclusionGrid?: () => Float32Array;
  /**
   * "Visa dolda verk"-läge: skymda fragment av turbinkroppen visas som en
   * svag (~25% opacitet), streckad kontur istället för att döljas helt.
   * Default av (realistisk ocklusion, verk döljs helt där de är skymda).
   */
  showHiddenTurbines?: boolean;
  /**
   * Global styrka (0..1) från "Outdoor Confidence Index"-tröskelvärdet
   * (`useOutdoorConfidenceIndex` i Home.tsx) — appliceras ovanpå per-punkts
   * himmelsmasken (`isPointSky`) som ytterligare en försiktighetsspärr:
   * 1 = visa normalt, ~0.6 = visa försiktigt (lägre opacitet, tier
   * "cautious"), 0 = dölj helt (tier "aim"/"hide", eller otillräcklig
   * himmelsandel i bild). Default 1 om utelämnad (bakåtkompatibelt).
   */
  globalVisibilityFactor?: number;
  /**
   * Tvingar ALLA verk (kropp, etiketter, ljus, glöd, skugga) helt osynliga,
   * oavsett `globalVisibilityFactor`/ocklusionsrutnätet — används av
   * `Home.tsx` när kamerabilden bedöms vara ett rent inomhus-/väggläge
   * (`sky.indoors`), som ett explicit skyddsnät utöver den per-pixel-
   * baserade ocklusionen (som ändå brukar döma nästan hela bilden som
   * "ej himmel" inomhus, men aldrig ska kunna missa ett verk genom en
   * dörröppning/fönster och rendera det som om det vore fritt synligt).
   * Default `false` (bakåtkompatibelt).
   */
  hideAll?: boolean;
  /**
   * Turbin-id:n (se `TurbineSweref.id`) som ska tvingas till full synlighet
   * oavsett `globalVisibilityFactor`/`hideAll` — juli 2026-produktkrav: en
   * 2-sekunders "inga verk syns"-fallback i `Home.tsx` som visar de tre
   * närmaste verken som "AR-testobjekt" medan sensorerna kalibreras, samt
   * en alltid-aktiv "rakt fram"-garanti (se `NEAR_CENTER_FORCE_DEG`) — INTE
   * bara denna prop. Default tom mängd (bakåtkompatibelt).
   */
  forceVisibleIds?: Set<string>;
  /**
   * Styr ENDAST om scenen syns (opacitet/pointer-events på DOM-elementet),
   * INTE om den finns/renderas. Produktkrav (juli 2026, "Render first –
   * refine continuously"): `Home.tsx` monterar `ARScene` så fort AR-
   * sessionen startas — långt innan GPS/kompass är redo — så att den tunga
   * engångskostnaden (3D-modeller, texturer, shader-kompilering, se mount-
   * effekten nedan) hinner bli klar i bakgrunden. `visible` växlas sedan
   * till `true` när allt är redo: objekten finns redan i minnet och
   * animate-loopen kör redan, så "AR-start" upplevs som en ren
   * synlighets-toggle, aldrig en nykonstruktion. Default `true`
   * (bakåtkompatibelt för ev. andra konsumenter).
   */
  visible?: boolean;
}

const DEFAULT_IS_POINT_SKY = () => true;
const EMPTY_FORCE_VISIBLE_IDS: Set<string> = new Set();
const DEFAULT_OCCLUSION_GRID = new Float32Array(GRID_COLS * GRID_ROWS).fill(1);
const DEFAULT_GET_OCCLUSION_GRID = () => DEFAULT_OCCLUSION_GRID;
// Mjuk tröskel (smoothstep) runt "hälften ockluderad" istället för en hård
// avgränsning — ger en mild, naturlig kant mellan synlig/dold del av ett
// verk snarare än ett tydligt hack mitt i tornet/rotorn.
const OCCLUSION_THRESHOLD_LOW = 0.35;
const OCCLUSION_THRESHOLD_HIGH = 0.55;

export interface ARSceneHandle {
  /**
   * Fångar aktuell bildruta från Three.js-scenen (vindkraftverk, etiketter,
   * skuggor, sol) som en PNG data-URL, med transparent bakgrund där kameran
   * ska lysa igenom. Fångas synkront direkt efter en renderad bildruta i
   * animationsloopen — undviker `preserveDrawingBuffer` (som ökar risken för
   * att WebGL-kontexten tappas på mobila GPU:er, vilket tidigare kunde göra
   * att hela kameravyn plötsligt försvann bakom en ogenomskinlig canvas).
   */
  capturePhoto: () => Promise<string | null>;
  /**
   * Antal verk som just nu ligger inom halva kamerans FOV, med den
   * FULLSTÄNDIGA (gir+pitch) vinkeln mot kamerans optiska axel — se
   * `inFrontOfCameraCountRef`. Läses av `Home.tsx` istället för att
   * approximera samma tal själv med en horisontell-only bäringsjämförelse.
   */
  getInFrontOfCameraCount: () => number;
}

interface TurbineObject {
  turbine: TurbineSweref;
  lat: number;
  lon: number;
  group: THREE.Group;
  bladesGroup: THREE.Group;
  label: CanvasLabel;
  distanceLabel: CanvasLabel;
  light: THREE.Sprite;
  glow: THREE.Sprite;
  shadow: THREE.Mesh;
  shadowMaterial: THREE.MeshBasicMaterial;
  shadowBaseOpacity: number;
  materials: (THREE.MeshStandardMaterial | THREE.MeshBasicMaterial)[];
  /** Opacitet innan himmelsmasken tillämpas (från avstånd/siktläge). */
  baseOpacity: number;
  /**
   * Utjämnad 0..1-faktor för hur mycket verket ska synas just nu utifrån
   * himmelsmasken — 1 om verket projiceras mot himmel, glider mot 0 annars
   * (inomhus, mot mark/vägg). Lerpas mjukt i renderloopen, se `animate`.
   */
  skyFactor: number;
  scaleDamp: number;
  bladeRadPerSec: number;
  blinkPeriodMs: number;
  blinkOnMs: number;
  blinkOffsetMs: number;
  renderDistM: number;
  /**
   * Sant när verket antingen ligger inom `NEAR_CENTER_FORCE_DEG` av kamerans
   * riktning (produktkrav: "verk inom ±25° ska renderas även vid dålig
   * kompassprecision") eller listas i `forceVisibleIds`-propen (2-sekunders
   * kalibreringsfallback) — omräknas varje bildruta i `animate`, se
   * `applyFinalOpacities`.
   */
  forceVisible: boolean;
}

interface CanvasLabel {
  sprite: THREE.Sprite;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
}

const FOV_DEGREES = 65;
// Juli 2026-produktkrav 4: verk inom denna vinkel (grader) från kamerans
// faktiska riktning (gir+pitch+roll, INTE bara rå kompassavläsning) ska
// ALLTID renderas som ett verkligt 3D-objekt, även om Outdoor Confidence
// Index/AR-trackingens uttoning annars skulle döma dem osynliga p.g.a. dålig
// kompassprecision eller en (falskt) konservativ himmel-heuristik. Klart
// snävare än halva kamera-FOV (`FOV_DEGREES / 2` = 32.5°) med avsikt — detta
// är en "garanterat synligt rakt fram"-zon, inte hela synfältet (som redan
// får normal rendering via skärmprojektionen i `applyVisibility`/`animate`).
const NEAR_CENTER_FORCE_DEG = 25;
// Halva kamerans FOV (grader) — samma tröskel som `Home.tsx`s
// `FOV_HALF_DEG`, används för `inFrontOfCameraCountRef` (produktkrav: en
// autoritativ, pitch-medveten "syns just nu på skärmen"-räkning som delas
// mellan de två platserna som annars skulle behöva komma överens om samma
// tal på egen hand).
const IN_VIEW_HALF_ANGLE_DEG = FOV_DEGREES / 2;
export const MAX_RENDER_DISTANCE_M = 9000;
// Meter -> scenens enheter. Vald så att den visuella storleken/avstånden
// matchar kamerans FOV/klippplan (samma skala som tidigare, enklare modell).
const METERS_TO_UNITS = 0.9;

// Antagen ögonhöjd (m) för användaren.
const EYE_HEIGHT_M = 1.6;
// Antagen markhöjd (m över havet) för Katrineholms tätort — vi har ingen
// riktig höjddata för ANVÄNDARENS position (GPS-altitude är opålitlig/
// saknas ofta i webbläsare), men verkens egen markhöjd är känd
// (`turbine.groundHeightMeters`). Ett platt-terräng-antagande mellan
// tätorten och Länsterberget är en medveten förenkling (dokumenterad i
// replit.md), men matchar ändå ungefär verkens egna värden (~50-70 m).
const ASSUMED_USER_GROUND_M = 60;
// Säkerhetsgräns (grader ovanför horisonten) för verkets topp — se
// felkontrollen i `layoutObjects`.
const MAX_PLAUSIBLE_ELEVATION_DEG = 10;

// "Närläge" (produktkrav 5, juli 2026): den vanliga renderingen komprimerar
// ALLA verk mot ett närliggande render-plan (`planeDist`, se `layoutObjects`)
// och kompenserar med en skal-korrektion (`physicalScale`) för att ändå
// återge rätt VINKELSTORLEK — en teknik som fungerar bra på håll, men som vid
// korta verkliga avstånd (candidate: ~100m) ger en skal-korrektion som växer
// mycket snabbt (nästan 1/avstånd) och känns "konstig"/instabil. Under
// `CLOSE_RANGE_FAR_M` tonas komprimeringen därför gradvis bort till förmån
// för en OKOMPRIMERAD, fysikaliskt verklig placering (planeDist = det
// verkliga avståndet), där skal-korrektionen naturligt går mot 1 — verket
// visas i sin riktiga storlek utan konstgjord förstärkning, vilket också gör
// markkontakten (som redan beräknas trigonometriskt, se `baseElevationRad`)
// kännas fastare/mer stabil på nära håll.
const CLOSE_RANGE_FAR_M = 300;
const CLOSE_RANGE_NEAR_M = 60;

/** 0 vid/över `CLOSE_RANGE_FAR_M`, 1 vid/under `CLOSE_RANGE_NEAR_M`, linjär mellan. */
function closeRangeFactor(realDist: number): number {
  if (realDist >= CLOSE_RANGE_FAR_M) return 0;
  if (realDist <= CLOSE_RANGE_NEAR_M) return 1;
  return (CLOSE_RANGE_FAR_M - realDist) / (CLOSE_RANGE_FAR_M - CLOSE_RANGE_NEAR_M);
}

const TOTAL_HEIGHT_M = 250;
const LOW_SUN_ALTITUDE_DEG = 5;
const LOW_SUN_AZIMUTH_DEG = 245; // sydväst/väster
const MAX_SHADOW_LENGTH_M = 5000;
const MIN_SHADOW_ALTITUDE_DEG = 2.5; // undviker division nära noll / oändliga skuggor

function createCanvasLabel(): CanvasLabel {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 999;
  return { sprite, canvas, ctx, texture };
}

function drawLabel(label: CanvasLabel, title: string, subtitle: string) {
  const { ctx, canvas } = label;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const paddingX = 28;
  ctx.font = "600 40px Inter, sans-serif";
  const titleWidth = ctx.measureText(title).width;
  ctx.font = "400 30px Inter, sans-serif";
  const subtitleWidth = ctx.measureText(subtitle).width;
  const boxWidth = Math.min(canvas.width, Math.max(titleWidth, subtitleWidth) + paddingX * 2);
  const boxHeight = 108;
  const x = (canvas.width - boxWidth) / 2;
  const y = (canvas.height - boxHeight) / 2;
  const radius = 20;

  ctx.fillStyle = "rgba(12, 10, 8, 0.72)";
  ctx.strokeStyle = "rgba(255, 139, 1, 0.6)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + boxWidth, y, x + boxWidth, y + boxHeight, radius);
  ctx.arcTo(x + boxWidth, y + boxHeight, x, y + boxHeight, radius);
  ctx.arcTo(x, y + boxHeight, x, y, radius);
  ctx.arcTo(x, y, x + boxWidth, y, radius);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#fff5eb";
  ctx.font = "600 40px Inter, sans-serif";
  ctx.fillText(title, canvas.width / 2, canvas.height / 2 - 20);

  ctx.fillStyle = "#ffb347";
  ctx.font = "400 30px Inter, sans-serif";
  ctx.fillText(subtitle, canvas.width / 2, canvas.height / 2 + 24);

  label.texture.needsUpdate = true;
}

function createGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255, 60, 60, 0.85)");
  gradient.addColorStop(0.4, "rgba(255, 40, 40, 0.35)");
  gradient.addColorStop(1, "rgba(255, 40, 40, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return new THREE.CanvasTexture(canvas);
}

/** Elliptisk, halvtransparent skugga: mörkast nära basen, tonar bort mot spetsen. */
function createShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(40, 32, 0, 40, 32, 210);
  gradient.addColorStop(0, "rgba(5, 5, 5, 0.55)");
  gradient.addColorStop(0.45, "rgba(5, 5, 5, 0.28)");
  gradient.addColorStop(1, "rgba(5, 5, 5, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return new THREE.CanvasTexture(canvas);
}

function createSunTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255, 244, 214, 0.95)");
  gradient.addColorStop(0.35, "rgba(255, 200, 120, 0.55)");
  gradient.addColorStop(1, "rgba(255, 180, 80, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return new THREE.CanvasTexture(canvas);
}

/** Bred, mjuk varm gloria runt en lågt stående sol (t.ex. "Låg sol"-läget). */
function createSunGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, "rgba(255, 180, 90, 0.55)");
  gradient.addColorStop(0.4, "rgba(255, 140, 60, 0.22)");
  gradient.addColorStop(1, "rgba(255, 120, 40, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return new THREE.CanvasTexture(canvas);
}

/** Skuggans längd i meter enligt ShadowLength = Höjd / tan(solhöjd), begränsad till 5000 m. */
function computeShadowLengthM(sunAltitudeDeg: number): number {
  const altitude = Math.max(sunAltitudeDeg, MIN_SHADOW_ALTITUDE_DEG);
  const length = TOTAL_HEIGHT_M / Math.tan((altitude * Math.PI) / 180);
  return Math.min(Math.max(length, 0), MAX_SHADOW_LENGTH_M);
}

function opacityForVisibility(visibility: VisibilityLevel, distM: number): number {
  if (visibility === "clear") return 1;
  if (visibility === "haze") return clamp(1 - distM / 11000, 0.55, 1);
  return clamp(1 - distM / 5500, 0.18, 1); // dimma
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

/**
 * AR-vy: renderar Three.js-objekt ovanpå kameraströmmen. Varje vindkraftverk
 * placeras EN gång i en fast världsposition utifrån bäring (från norr) och
 * avstånd relativt användarens GPS-position. Själva kameran roteras varje
 * bildruta utifrån enhetens fullständiga orientering (gir, pitch och roll)
 * — precis som en riktig kamera — vilket gör att verken upplevs som fast
 * förankrade i verkligheten/horisonten när telefonen tiltas, istället för
 * att följa skärmen. Detta är en enkel men robust "AR utan markörer"-teknik
 * som inte kräver WebXR (brett webbläsarstöd).
 *
 * Sol/skugga, verklig-storlek och synlighet är rena visualiseringslägen och
 * approximationer — solens position beräknas ungefärligt utifrån datum/tid/
 * GPS, och skuggorna är förenklade halvtransparenta ellipser, inte en exakt
 * skuggberäkning.
 */
export const ARScene = forwardRef<ARSceneHandle, ARSceneProps>(function ARScene(
  {
    userLat,
    userLon,
    quaternionRef,
    turbines,
    sunMode,
    realScale,
    visibility,
    nightMode,
    shadowFlicker,
    isPointSky,
    getOcclusionGrid,
    showHiddenTurbines,
    globalVisibilityFactor,
    hideAll,
    forceVisibleIds,
    visible = true,
  },
  forwardedRef,
) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneStateRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    objects: TurbineObject[];
    ambient: THREE.AmbientLight;
    sunLight: THREE.DirectionalLight;
    sunSprite: THREE.Sprite;
    sunGlow: THREE.Sprite;
  } | null>(null);
  const userRef = useRef({ lat: userLat, lon: userLon });
  const modeRef = useRef({
    sunMode,
    realScale,
    visibility,
    nightMode,
    shadowFlicker,
    showHiddenTurbines: showHiddenTurbines ?? false,
    globalVisibilityFactor: globalVisibilityFactor ?? 1,
    hideAll: hideAll ?? false,
    forceVisibleIds: forceVisibleIds ?? EMPTY_FORCE_VISIBLE_IDS,
  });
  const skyRef = useRef({
    isPointSky: isPointSky ?? DEFAULT_IS_POINT_SKY,
    getOcclusionGrid: getOcclusionGrid ?? DEFAULT_GET_OCCLUSION_GRID,
  });
  // Väntande Fotomontage-förfrågan — löses in synkront direkt efter nästa
  // renderade bildruta i animationsloopen (se `animate`), istället för att
  // sätta `preserveDrawingBuffer: true` på renderaren. Att läsa canvasen i
  // samma JS-cykel som `renderer.render()` fungerar utan preserveDrawingBuffer
  // (webbläsaren hinner inte rensa/kompositera bufferten emellan), och
  // undviker den extra GPU-minnesbelastning som tidigare kunde göra att hela
  // kameravyn plötsligt försvann bakom en ogenomskinlig canvas (förlorad
  // WebGL-kontext).
  const pendingCaptureRef = useRef<((dataUrl: string | null) => void) | null>(null);
  // Juli 2026-fix ("verk fastklistrade på skärmen vid nedåtlutning"): antal
  // verk som just nu ligger inom halva kamerans FOV, beräknat med den
  // FULLSTÄNDIGA 3D-vinkeln (gir OCH pitch, se `angleFromOpticalAxisDeg` i
  // `animate`) mot kamerans verkliga optiska axel — inte en horisontell-only
  // kompassjämförelse. `Home.tsx`s tidigare egna beräkning av samma tal
  // (för kalibreringsfallbacken) använde bara bäring/kompassriktning och
  // ignorerade pitch helt, vilket gjorde att räkningen aldrig ändrades när
  // telefonen lutades upp/ner — verken uppfattades då som skärmbundna
  // istället för världsförankrade. Genom att exponera SAMMA autoritativa
  // tal som redan styr `forceVisible`/"rakt fram"-garantin (se nedan)
  // garanteras att båda mekanismerna alltid är överens.
  const inFrontOfCameraCountRef = useRef(0);

  userRef.current = { lat: userLat, lon: userLon };
  modeRef.current = {
    sunMode,
    realScale,
    visibility,
    nightMode,
    shadowFlicker,
    showHiddenTurbines: showHiddenTurbines ?? false,
    globalVisibilityFactor: globalVisibilityFactor ?? 1,
    hideAll: hideAll ?? false,
    forceVisibleIds: forceVisibleIds ?? EMPTY_FORCE_VISIBLE_IDS,
  };
  skyRef.current = {
    isPointSky: isPointSky ?? DEFAULT_IS_POINT_SKY,
    getOcclusionGrid: getOcclusionGrid ?? DEFAULT_GET_OCCLUSION_GRID,
  };

  useImperativeHandle(forwardedRef, () => ({
    capturePhoto: () =>
      new Promise<string | null>((resolve) => {
        if (!sceneStateRef.current) {
          resolve(null);
          return;
        }
        pendingCaptureRef.current = resolve;
      }),
    getInFrontOfCameraCount: () => inFrontOfCameraCountRef.current,
  }));

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV_DEGREES, mount.clientWidth / mount.clientHeight, 1, 20000);
    // Ingen `preserveDrawingBuffer` här — se motiveringen vid `pendingCaptureRef`
    // ovan. Att slå på den ökade minnestrycket på mobila GPU:er tillräckligt
    // för att WebGL-kontexten kunde tappas mitt i en session, vilket gjorde
    // att hela kameravyn plötsligt doldes bakom en ogenomskinlig canvas.
    // Kan kasta (t.ex. ingen WebGL-support i webbläsaren/enheten). Scenen
    // monteras numera direkt vid AR-start, långt innan vi vet om enheten
    // ens klarar WebGL — fånga felet så att hela sidan inte kraschar, och
    // lämna kvar den tomma monteringspunkten (kamerabilden syns då ändå).
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      return;
    }
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    // Om WebGL-kontexten ändå skulle tappas (t.ex. GPU-minnestryck på äldre
    // mobiler) döljer vi canvasen istället för att låta den bli en stängd,
    // ogenomskinlig svart ruta ovanpå kamerabilden — då syns i alla fall
    // "verkligheten" i kameran igen, även om AR-lagret tillfälligt saknas.
    function handleContextLost(event: Event) {
      event.preventDefault();
      renderer.domElement.style.visibility = "hidden";
    }
    function handleContextRestored() {
      renderer.domElement.style.visibility = "visible";
    }
    renderer.domElement.addEventListener("webglcontextlost", handleContextLost, false);
    renderer.domElement.addEventListener("webglcontextrestored", handleContextRestored, false);

    const ambient = new THREE.AmbientLight(0xffffff, 1.1);
    scene.add(ambient);
    const sunLight = new THREE.DirectionalLight(0xffffff, 0.6);
    sunLight.position.set(5, 10, 5);
    scene.add(sunLight);

    const glowTexture = createGlowTexture();
    const shadowTexture = createShadowTexture();
    const sunTexture = createSunTexture();
    const sunGlowTexture = createSunGlowTexture();

    // Mjuk, bred gloria bakom solskivan — extra framträdande i "Låg sol"-läget
    // för att ge intrycket av en stor, varm solnedgångssol.
    const sunGlowMat = new THREE.SpriteMaterial({
      map: sunGlowTexture,
      transparent: true,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    const sunGlow = new THREE.Sprite(sunGlowMat);
    sunGlow.renderOrder = 0;
    sunGlow.scale.setScalar(1400);
    scene.add(sunGlow);

    const sunSpriteMat = new THREE.SpriteMaterial({
      map: sunTexture,
      transparent: true,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    const sunSprite = new THREE.Sprite(sunSpriteMat);
    sunSprite.renderOrder = 1;
    sunSprite.scale.setScalar(900);
    scene.add(sunSprite);

    // Skuggplan: bas vid x=0 (verkets fot), sträcker sig mot +lokal X, ligger
    // platt på marken (Y=0 lokalt). Rotation runt världens Y-axel styr sedan
    // vilken kompassriktning skuggan pekar i (bort från solen).
    const shadowGeo = new THREE.PlaneGeometry(1, 1);
    shadowGeo.translate(0.5, 0, 0);
    shadowGeo.rotateX(-Math.PI / 2);

    // Delad textur som varje bildruta fylls med det senaste utjämnade
    // ocklusionsrutnätet (`getOcclusionGrid()`), och som alla turbinkroppars
    // material samplar per-fragment (se `attachOcclusionShader` nedan) för
    // att bara dölja/tona den faktiskt skymda delen av ett verk, inte hela
    // objektet. RGBA/Uint8 stöds överallt (till skillnad från t.ex.
    // enkanalsformat som kräver WebGL2), vi använder bara r-kanalen.
    const occlusionData = new Uint8Array(GRID_COLS * GRID_ROWS * 4).fill(255);
    const occlusionTexture = new THREE.DataTexture(occlusionData, GRID_COLS, GRID_ROWS, THREE.RGBAFormat, THREE.UnsignedByteType);
    occlusionTexture.flipY = false;
    occlusionTexture.minFilter = THREE.LinearFilter;
    occlusionTexture.magFilter = THREE.LinearFilter;
    occlusionTexture.wrapS = THREE.ClampToEdgeWrapping;
    occlusionTexture.wrapT = THREE.ClampToEdgeWrapping;
    occlusionTexture.needsUpdate = true;

    // Kompilerade shader-referenser (fylls i via `onBeforeCompile` nedan) så
    // `animate()` kan uppdatera `uShowHidden` varje bildruta utan att behöva
    // återkompilera materialen.
    const occlusionShaders: THREE.WebGLProgramParametersWithUniforms[] = [];

    function attachOcclusionShader(material: THREE.MeshStandardMaterial) {
      material.transparent = true;
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uOcclusionMap = { value: occlusionTexture };
        shader.uniforms.uShowHidden = { value: modeRef.current.showHiddenTurbines ? 1 : 0 };
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec4 vOcclusionClipPos;")
          .replace("#include <project_vertex>", "#include <project_vertex>\nvOcclusionClipPos = gl_Position;");
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            `#include <common>
            varying vec4 vOcclusionClipPos;
            uniform sampler2D uOcclusionMap;
            uniform float uShowHidden;`,
          )
          .replace(
            "#include <dithering_fragment>",
            `
            {
              vec2 occlusionUv = (vOcclusionClipPos.xy / vOcclusionClipPos.w) * 0.5 + 0.5;
              occlusionUv.y = 1.0 - occlusionUv.y;
              float occlusion = 1.0;
              if (occlusionUv.x >= 0.0 && occlusionUv.x <= 1.0 && occlusionUv.y >= 0.0 && occlusionUv.y <= 1.0) {
                occlusion = texture2D(uOcclusionMap, occlusionUv).r;
              }
              float visMask = smoothstep(${OCCLUSION_THRESHOLD_LOW.toFixed(2)}, ${OCCLUSION_THRESHOLD_HIGH.toFixed(2)}, occlusion);
              if (uShowHidden > 0.5) {
                // Skymd del (t.ex. bakom träd): rendera som glesa, röda
                // streck istället för att döljas helt — annars är verket i
                // praktiken omöjligt att upptäcka i skogsnära vyer.
                float dash = mod(gl_FragCoord.x + gl_FragCoord.y, 14.0) < 7.0 ? 1.0 : 0.0;
                float hiddenAlpha = 0.32 * dash;
                vec3 hiddenColor = vec3(0.95, 0.12, 0.1);
                gl_FragColor.rgb = mix(hiddenColor, gl_FragColor.rgb, visMask);
                gl_FragColor.a *= mix(hiddenAlpha, 1.0, visMask);
              } else {
                if (visMask < 0.02) discard;
                gl_FragColor.a *= visMask;
              }
            }
            #include <dithering_fragment>`,
          );
        occlusionShaders.push(shader);
      };
    }

    const objects: TurbineObject[] = turbines.map((turbine) => {
      const { lat, lon } = swerefToWgs84(turbine.easting, turbine.northing);
      const { group, bladesGroup, materials } = buildTurbineMesh(turbine);
      for (const mat of materials) attachOcclusionShader(mat);
      scene.add(group);
      const label = createCanvasLabel();
      label.sprite.scale.set(34, 8.5, 1);
      scene.add(label.sprite);
      const distanceLabel = createCanvasLabel();
      distanceLabel.sprite.scale.set(24, 6, 1);
      scene.add(distanceLabel.sprite);

      const lightMat = new THREE.SpriteMaterial({ color: 0xff3030, transparent: true, depthTest: false });
      const light = new THREE.Sprite(lightMat);
      light.renderOrder = 998;
      scene.add(light);

      // Mjuk glöd runt navcellen vid nattblink — simulerar ljusspridning
      // utan att behöva en riktig realtidsljuskälla per verk (prestanda).
      const glowMat = new THREE.SpriteMaterial({
        map: glowTexture,
        transparent: true,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      });
      const glow = new THREE.Sprite(glowMat);
      glow.renderOrder = 997;
      scene.add(glow);

      const shadowMaterial = new THREE.MeshBasicMaterial({
        map: shadowTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0,
      });
      const shadow = new THREE.Mesh(shadowGeo, shadowMaterial);
      shadow.renderOrder = 1;
      scene.add(shadow);

      // Deterministisk men olikartad rotorhastighet och blinkfas per verk,
      // baserad på verkets namn — samma verk får alltid samma värden, men
      // olika verk skiljer sig åt (ingen global synkronisering).
      const rpm = getBladeRpm(turbine.name);
      const bladeRadPerSec = (rpm * Math.PI * 2) / 60;
      const blinkPeriodMs = getBlinkPeriodMs(turbine.name);
      const blinkOffsetMs = getBlinkOffsetMs(turbine.name, blinkPeriodMs);

      // Varje rotor startar med en egen, stabil bladvinkel istället för att
      // alla 29 verk pekar likadant vid start.
      bladesGroup.rotation.z = getBladeStartAngleRad(turbine.name);

      return {
        turbine,
        lat,
        lon,
        group,
        bladesGroup,
        label,
        distanceLabel,
        light,
        glow,
        shadow,
        shadowMaterial,
        shadowBaseOpacity: 0,
        materials,
        baseOpacity: 1,
        // Konservativ startpunkt: dolt tills himmelsdetekteringen (ML eller
        // heuristik) faktiskt bekräftat fri himmel vid verkets skärmposition.
        // Lerpas snabbt upp/ner varje bildruta i renderloopen, se `animate`.
        skyFactor: 0,
        scaleDamp: 1,
        bladeRadPerSec,
        blinkPeriodMs,
        blinkOnMs: BLINK_ON_MS,
        blinkOffsetMs,
        renderDistM: 0,
        forceVisible: false,
      };
    });

    sceneStateRef.current = { scene, camera, renderer, objects, ambient, sunLight, sunSprite, sunGlow };

    // Placera varje verk i en fast världsposition utifrån bäring/avstånd.
    // Körs initialt samt varje gång användarens GPS-position uppdateras
    // (i animationsloopen, men bara när koordinaterna faktiskt ändrats) —
    // annars behöver inte positionerna räknas om varje bildruta.
    //
    // Verkets fundament låses mot markplanet med en RIKTIG höjdvinkel
    // (verklig höjdskillnad / verkligt avstånd), inte en fast pixel-offset —
    // annars hamnar verket där kameran råkar peka snarare än där marken
    // faktiskt ligger. Kamerans egen rotation (inkl. den kalibrerade
    // horisont-offseten, se `useDeviceOrientation.ts`s `calibrateHorizon`)
    // avgör sedan vad som syns var på skärmen; den här funktionen ansvarar
    // bara för att verkets VÄRLDSPOSITION är fysikaliskt rätt.
    function layoutObjects() {
      const { lat: uLat, lon: uLon } = userRef.current;
      for (const obj of sceneStateRef.current!.objects) {
        const realDist = Math.max(distanceMeters(uLat, uLon, obj.lat, obj.lon), 1);
        const bearing = bearingDegrees(uLat, uLon, obj.lat, obj.lon);
        const bearingRad = (bearing * Math.PI) / 180;

        const renderDist = Math.min(realDist, MAX_RENDER_DISTANCE_M);
        const compressedPlaneDist = 400 + renderDist * 0.12;
        // Närläge (<`CLOSE_RANGE_FAR_M`): blanda mot en OKOMPRIMERAD
        // render-position (planeDist == verkligt avstånd) så att
        // `physicalScale` nedan går mot 1 istället för att växa okontrollerat
        // vid korta avstånd — se kommentaren vid `closeRangeFactor`.
        const closeFactor = closeRangeFactor(realDist);
        const uncompressedPlaneDist = realDist * METERS_TO_UNITS;
        const planeDist = compressedPlaneDist + (uncompressedPlaneDist - compressedPlaneDist) * closeFactor;

        // Höjdskillnad mot användaren: verkets egen markhöjd över havet
        // (`groundHeightMeters`, från lantmäteridata) minus en antagen
        // markhöjd för Katrineholms tätort — vi har ingen riktig höjddata
        // för ANVÄNDARENS position (GPS-altitude är opålitlig/saknas ofta i
        // webbläsare), så ett platt-terräng-antagande mellan tätorten och
        // Länsterberget används (dokumenterat i replit.md). Ändå betydligt
        // mer fysikaliskt korrekt än en fast offset, eftersom det tar
        // hänsyn till både verkligt avstånd och verklig höjd.
        const groundDeltaM = obj.turbine.groundHeightMeters - ASSUMED_USER_GROUND_M;

        // Felkontroll: om den beräknade höjdvinkeln till verkets topp skulle
        // hamna orimligt högt ovanför horisonten (t.ex. p.g.a. en tillfällig
        // GPS-glitch som kollapsar avståndet) räknas positionen om med ett
        // säkert minimiavstånd istället — annars skulle verket kunna "flyga
        // upp i himlen" på en enskild dålig avläsning. Under normal, riktig
        // GPS-användning på den här platsen (verken ligger flera km bort)
        // ligger den verkliga vinkeln långt under den här gränsen och
        // omräkningen triggas aldrig.
        const topDeltaM = groundDeltaM + obj.turbine.heightMeters - EYE_HEIGHT_M;
        const rawTopAngleDeg = (Math.atan2(topDeltaM, realDist) * 180) / Math.PI;
        const elevationDist =
          Math.abs(rawTopAngleDeg) > MAX_PLAUSIBLE_ELEVATION_DEG
            ? Math.abs(topDeltaM) / Math.tan((MAX_PLAUSIBLE_ELEVATION_DEG * Math.PI) / 180)
            : realDist;

        const baseElevationRad = Math.atan2(groundDeltaM - EYE_HEIGHT_M, elevationDist);

        // Fysikaliskt korrekt skala: återskapar verkets RIKTIGA
        // vinkelutbredning (höjd/bredd delat på det verkliga avståndet) på
        // det komprimerade renderavståndet `planeDist`, så verket ser rätt
        // stort ut relativt horisonten oavsett hur långt bort det egentligen
        // är — ersätter den tidigare godtyckliga avståndsdämpningskurvan som
        // inte var kopplad till någon verklig vinkel.
        const { realScale: useRealScale } = modeRef.current;
        const physicalScale = planeDist / (realDist * METERS_TO_UNITS);
        // "Förstärkt visning" (standardläget) förstorar avlägsna verk för
        // synlighet, men ENDAST storleken — skalan växer uppåt från den
        // markförankrade baspunkten (se `buildTurbineMesh`, som bygger
        // tornet från lokal origo/y=0 och uppåt), så fundamentet lämnar
        // aldrig marken av detta.
        const farBoost = useRealScale ? 1 : 1 + Math.min(renderDist / MAX_RENDER_DISTANCE_M, 1) * 2.2;
        // I närläge ska verket visas i sin riktiga storlek (inget konstgjort
        // "förstärkt visning"-påslag) — tona bort `farBoost` mot 1 med samma
        // `closeFactor` som `planeDist` ovan, så storleken blir stabil och
        // verklighetstrogen precis nära verket (produktkrav 5).
        const boost = farBoost + (1 - farBoost) * closeFactor;
        const scaleDamp = physicalScale * boost;

        const x = Math.sin(bearingRad) * planeDist;
        const z = -Math.cos(bearingRad) * planeDist;
        const y = planeDist * Math.tan(baseElevationRad);
        const dist = realDist;

        obj.group.position.set(x, y, z);
        obj.group.scale.setScalar(scaleDamp);
        obj.group.lookAt(0, y, 0);
        obj.scaleDamp = scaleDamp;
        obj.renderDistM = dist;

        const totalHeightUnits = obj.turbine.heightMeters * METERS_TO_UNITS;
        const hubHeightUnits = obj.turbine.hubHeightMeters * METERS_TO_UNITS;
        const labelHeight = totalHeightUnits * scaleDamp * 0.42 - 8;
        obj.label.sprite.position.set(x, y + labelHeight + 34 * scaleDamp, z);
        obj.label.sprite.scale.set(34 * scaleDamp, 8.5 * scaleDamp, 1);
        obj.distanceLabel.sprite.position.set(x, y + labelHeight + 22 * scaleDamp, z);
        obj.distanceLabel.sprite.scale.set(24 * scaleDamp, 6 * scaleDamp, 1);

        const lightY = y + hubHeightUnits * scaleDamp * 1.02;
        obj.light.position.set(x, lightY, z);
        obj.light.scale.setScalar(6 * scaleDamp);
        obj.glow.position.set(x, lightY, z);
        obj.glow.scale.setScalar(26 * scaleDamp);

        drawLabel(obj.label, obj.turbine.name, "");
        drawLabel(obj.distanceLabel, formatDistance(dist), "");

        layoutShadow(obj, x, y, z, scaleDamp);
        applyVisibility(obj, dist);
      }
    }

    function layoutShadow(obj: TurbineObject, x: number, y: number, z: number, scaleDamp: number) {
      const { sunMode: mode } = modeRef.current;
      if (mode === "evening" || mode === "none") {
        obj.shadow.visible = false;
        return;
      }
      const { altitudeDeg, azimuthDeg } = getSunAngles(mode);
      if (altitudeDeg <= 0) {
        obj.shadow.visible = false;
        return;
      }
      const shadowLengthM = computeShadowLengthM(altitudeDeg);
      const shadowLengthUnits = shadowLengthM * METERS_TO_UNITS * scaleDamp;
      const widthUnits = Math.max(obj.turbine.rotorDiameterMeters * 0.55 * METERS_TO_UNITS * scaleDamp, 8);

      // Skuggan pekar bort från solen (azimut + 180°), i samma öst/väst/nord-
      // konvention som används för bäring/placering i övrigt i scenen.
      const shadowAzimuthRad = ((azimuthDeg + 180) * Math.PI) / 180;
      obj.shadow.position.set(x, y + 0.3, z);
      obj.shadow.rotation.y = Math.PI / 2 - shadowAzimuthRad;
      obj.shadow.scale.set(shadowLengthUnits, 1, widthUnits);
      obj.shadow.visible = true;
    }

    /**
     * Skriver de faktiska material-opaciteterna. Turbinkroppens material
     * (torn/navcell/blad) styrs numera BARA av `obj.baseOpacity` (avstånd/
     * siktläge) × `globalVisibilityFactor` (Outdoor Confidence Index) — den
     * faktiska himmels-/ocklusionsmaskeringen sker per-pixel i shadern som
     * `attachOcclusionShader` injicerar, så bara den skymda delen av ett
     * verk döljs istället för hela objektet. Etiketter/ljus/glöd (små,
     * punktformade element som inte kan maskeras meningsfullt per pixel)
     * fortsätter använda den enkla ankarpunktsbaserade `obj.skyFactor`.
     * Körs dels när basopaciteten ändras (`applyVisibility`), dels varje
     * bildruta i renderloopen när himmelsmasken uppdateras.
     */
    function applyFinalOpacities(obj: TurbineObject) {
      // `globalVisibilityFactor` (Outdoor Confidence Index-tröskeln) verkar
      // som en global gate — 0 döljer alla verk helt oavsett ocklusion,
      // ~0.6 tonar ned dem för "cautious"-läget. `obj.forceVisible`
      // (rakt-fram-garanti ±25° eller kalibreringsfallbackens
      // `forceVisibleIds`, se `animate`) kringgår denna gate helt — men
      // INTE `hideAll` (den riktiga inomhus-/väggöverlayen, som redan
      // täcker hela skärmen ovanpå AR-canvasen och därför gör
      // kringgåendet osynligt ändå; att låta `hideAll` vinna håller
      // logiken enkel och odubbel).
      const globalFactor = modeRef.current.hideAll
        ? 0
        : obj.forceVisible
          ? 1
          : modeRef.current.globalVisibilityFactor;
      const skyFactor = (obj.forceVisible ? 1 : obj.skyFactor) * globalFactor;
      const bodyOpacity = obj.baseOpacity * globalFactor;
      for (const mat of obj.materials) {
        mat.transparent = true;
        mat.opacity = bodyOpacity;
      }
      (obj.label.sprite.material as THREE.SpriteMaterial).opacity = skyFactor;
      (obj.distanceLabel.sprite.material as THREE.SpriteMaterial).opacity = skyFactor;
      (obj.light.material as THREE.SpriteMaterial).opacity = skyFactor;
      (obj.glow.material as THREE.SpriteMaterial).opacity = skyFactor;
    }

    function applyVisibility(obj: TurbineObject, distM: number) {
      const { visibility: vis } = modeRef.current;
      const opacity = opacityForVisibility(vis, distM);
      obj.baseOpacity = opacity;
      const shadowBaseOpacity = 0.85;
      obj.shadowBaseOpacity = shadowBaseOpacity * opacity;
      applyFinalOpacities(obj);
    }

    layoutObjects();

    // Återanvända vektorer för himmelsmaskens kamera-rymd/skärmprojektion —
    // undviker att allokera nya `THREE.Vector3` varje verk, varje bildruta.
    const camSpaceVec = new THREE.Vector3();
    const ndcVec = new THREE.Vector3();

    let raf = 0;
    let lastLayoutLat = userRef.current.lat;
    let lastLayoutLon = userRef.current.lon;
    let lastTimestamp: number | null = null;
    let lastMode = modeRef.current.sunMode;
    let lastRealScale = modeRef.current.realScale;
    let lastVisibility = modeRef.current.visibility;

    function animate(timestamp: number) {
      raf = requestAnimationFrame(animate);
      const state = sceneStateRef.current;
      if (!state) return;

      const dt = lastTimestamp === null ? 0 : Math.min((timestamp - lastTimestamp) / 1000, 0.25);
      lastTimestamp = timestamp;

      // Räkna bara om placeringen när GPS-positionen faktiskt förflyttat sig
      // märkbart, eller om ett visualiseringsläge ändrats, istället för varje
      // bildruta — sparar prestanda.
      const { lat: uLat, lon: uLon } = userRef.current;
      const { sunMode: curMode, realScale: curRealScale, visibility: curVisibility } = modeRef.current;
      const moved = Math.abs(uLat - lastLayoutLat) > 1e-6 || Math.abs(uLon - lastLayoutLon) > 1e-6;
      const modeChanged = curMode !== lastMode || curRealScale !== lastRealScale || curVisibility !== lastVisibility;
      if (moved || modeChanged) {
        lastLayoutLat = uLat;
        lastLayoutLon = uLon;
        lastMode = curMode;
        lastRealScale = curRealScale;
        lastVisibility = curVisibility;
        layoutObjects();
      }

      // Kamerans riktning styrs helt av enhetens sensorer (gir/pitch/roll),
      // så att verken förblir fast förankrade i verkligheten/horisonten
      // istället för att följa skärmen när telefonen tiltas.
      state.camera.quaternion.copy(quaternionRef.current);

      // Blinkande flyghinderljus styrs enbart av det manuella Nattläge-valet
      // (aldrig av den faktiska klockan eller av "Kväll"-visualiseringsläget).
      // Dagsläge ska alltid stänga av detta helt tills användaren ändrar det.
      const { nightMode: curNightMode } = modeRef.current;
      const night = curNightMode;
      const now = Date.now();

      // Mörklägg scenen — dämpar omgivningsljus/riktat ljus, vilket gör
      // kameraströmmen och 3D-objekten mörkare tillsammans. Styrs enbart av
      // det manuella Nattläge-valet, oavsett verklig tid på dygnet eller
      // valt "Kväll"-visualiseringsläge.
      const eveningDim = curNightMode;
      // Lägre omgivningsljus i förhållande till riktat solljus ger tydligare
      // skillnad mellan verkens belysta och skuggade sida (bättre realism).
      state.ambient.intensity = eveningDim ? 0.32 : 0.62;
      state.sunLight.intensity = eveningDim ? 0.12 : 1.0;

      // Den virtuella solen är helt dold i "Kväll"-visualiseringsläget (oavsett
      // Dag-/Nattläge), och i manuellt Nattläge — men INTE i "Ingen skugga"-
      // läget, som bara stänger av skuggan (se layoutShadow) och annars visar
      // solen precis som "Aktuell sol". Annars visas den enligt det valda
      // sol-läget ("Aktuell sol": beräknad från GPS/datum/tid, "Låg sol": fast
      // låg position). Den rör sig med AR-världen (fast världsposition, bara
      // kameran roterar), så den ligger kvar i rätt kompassriktning när
      // telefonen vrids.
      const sunHidden = eveningDim || curMode === "evening";
      state.sunSprite.visible = !sunHidden;
      state.sunGlow.visible = false;
      if (!sunHidden) {
        const isLowSun = curMode === "low";
        const { altitudeDeg, azimuthDeg } = getSunAngles(curMode);
        const altRad = (altitudeDeg * Math.PI) / 180;
        const azRad = (azimuthDeg * Math.PI) / 180;
        const sunDist = 9000;
        const horiz = Math.cos(altRad) * sunDist;
        const sunX = Math.sin(azRad) * horiz;
        const sunZ = -Math.cos(azRad) * horiz;
        const sunY = Math.sin(altRad) * sunDist;
        const sunVisible = altitudeDeg > -2;
        state.sunSprite.position.set(sunX, Math.max(sunY, 40), sunZ);
        state.sunSprite.visible = sunVisible;

        // Solen lyser scenens riktade ljus i samma riktning som den visuella
        // solen står i, så att skuggningen på verken (och skuggornas riktning,
        // beräknad separat i layoutShadow) hör ihop med var solen faktiskt syns.
        state.sunLight.position.set(sunX, Math.max(sunY, 40), sunZ);

        // "Låg sol" visas som en stor, varm solnedgångssol med mjuk gloria.
        // "Aktuell sol" är en mindre, ljusare dagssol utan extra gloria.
        const sunScale = isLowSun ? 1500 : 900;
        state.sunSprite.scale.setScalar(sunScale);
        (state.sunSprite.material as THREE.SpriteMaterial).color.set(isLowSun ? 0xffa552 : 0xfff4e0);

        state.sunGlow.visible = sunVisible && isLowSun;
        if (isLowSun) {
          state.sunGlow.position.copy(state.sunSprite.position);
          state.sunGlow.scale.setScalar(sunScale * 3.2);
        }
      }

      // "Skuggflimmer": den blinkande skugga som uppstår när solen passerar
      // bakom roterande rotorblad. Simuleras genom att modulera markskuggans
      // opacitet i takt med rotorbladens rotation (3 blad -> 3 pulser/varv),
      // istället för att kräva en separat, tyngre skuggberäkning. Endast
      // aktivt i "Aktuell sol"/"Låg sol" och bara där en markskugga redan
      // beräknats vara synlig (dvs. innanför det beräknade skuggområdet) —
      // stängs annars automatiskt av helt naturligt via `obj.shadow.visible`.
      const { shadowFlicker: curShadowFlicker } = modeRef.current;
      const flickerActive = shadowFlickerActive(curShadowFlicker, curMode);
      const currentIsPointSky = skyRef.current.isPointSky;
      const skyLerpRate = Math.min(dt * 4, 1);
      // Fyll den delade ocklusionstexturen med det senaste (temporalt
      // utjämnade) rutnätet, och synka "Visa dolda verk"-uniformen till
      // varje kompilerad turbin-shader. Görs bara om rutnätet faktiskt har
      // ändrats (eller första gången), för att spara GPU-bussbandbredd.
      const occlusionGrid = skyRef.current.getOcclusionGrid();
      let changed = false;
      for (let i = 0; i < occlusionGrid.length; i++) {
        const v = Math.round(Math.max(0, Math.min(1, occlusionGrid[i])) * 255);
        const o = i * 4;
        if (occlusionData[o] !== v) {
          occlusionData[o] = v;
          occlusionData[o + 1] = v;
          occlusionData[o + 2] = v;
          occlusionData[o + 3] = 255;
          changed = true;
        }
      }
      if (changed) {
        occlusionTexture.needsUpdate = true;
      }
      const showHiddenValue = modeRef.current.showHiddenTurbines ? 1 : 0;
      for (const shader of occlusionShaders) {
        shader.uniforms.uShowHidden.value = showHiddenValue;
      }

      // Nollställs varje bildruta, se `inFrontOfCameraCountRef`.
      let inFrontOfCameraCount = 0;

      for (const obj of state.objects) {
        obj.bladesGroup.rotation.z += obj.bladeRadPerSec * dt;

        // Himmelsmask: verk som (enligt kamerabildens ljus/färg-heuristik,
        // se `useSkyDetection`) för närvarande INTE projiceras mot himmel —
        // t.ex. användaren är inomhus, eller riktar kameran mot mark/vägg —
        // tonas mjukt bort istället för att "spöka" genom väggar/tak.
        // Navhöjdspunkten (`obj.light.position`) används som representativ
        // ankarpunkt eftersom den täcker den mest synliga delen av verket.
        camSpaceVec.copy(obj.light.position).applyMatrix4(state.camera.matrixWorldInverse);
        // "Rakt fram"-garantin (produktkrav 4): vinkeln mellan verkets
        // riktning och kamerans faktiska optiska axel (-Z i kamerarymden,
        // efter att `quaternionRef` — gir+pitch+roll — redan tillämpats på
        // `state.camera` ovan i denna funktion), INTE bara en jämförelse
        // mellan råa kompass-/bäringsgrader. Träffar denna zon renderas
        // verket alltid som ett riktigt 3D-objekt, oavsett hur dålig
        // kompassprecisionen/Outdoor Confidence Index-tröskeln är just nu.
        //
        // Juli 2026-fix ("verk fastklistrade på skärmen vid nedåtlutning
        // mot balkong/mark"): denna vinkel beräknades tidigare bara
        // horisontellt (`atan2(camSpaceVec.x, -camSpaceVec.z)`), dvs. gir/
        // bäring — helt oberoende av `camSpaceVec.y` (pitch). Det gjorde
        // att "rakt fram"-garantin (och den identiskt beräknade
        // `inFrontOfCameraCount` i `Home.tsx`) förblev sann/falsk baserat
        // enbart på kompassriktning, oavsett hur mycket telefonen lutades
        // upp/ner — verket tvingades kvar som synligt (eller förblev
        // dolt) helt frikopplat från den faktiska vertikala siktlinjen,
        // vilket upplevdes som att verket satt fastklistrat på skärmen
        // istället för att vara förankrat i världen. `angleFromOpticalAxisDeg`
        // använder istället HELA 3D-vektorn (x,y,z i kamerarymden) för att
        // räkna den verkliga rymdvinkeln mot kamerans optiska axel — den
        // ändras alltså korrekt både vid gir- och pitch-rörelser.
        const inFrontOfCamera = camSpaceVec.z < 0;
        const camSpaceDist = camSpaceVec.length();
        const angleFromOpticalAxisDeg =
          inFrontOfCamera && camSpaceDist > 0
            ? (Math.acos(Math.min(1, Math.max(-1, -camSpaceVec.z / camSpaceDist))) * 180) / Math.PI
            : null;
        const nearCenter = angleFromOpticalAxisDeg !== null && angleFromOpticalAxisDeg <= NEAR_CENTER_FORCE_DEG;
        obj.forceVisible =
          (nearCenter && obj.renderDistM <= MAX_RENDER_DISTANCE_M) ||
          modeRef.current.forceVisibleIds.has(obj.turbine.id);
        if (
          angleFromOpticalAxisDeg !== null &&
          angleFromOpticalAxisDeg <= IN_VIEW_HALF_ANGLE_DEG &&
          obj.renderDistM <= MAX_RENDER_DISTANCE_M
        ) {
          inFrontOfCameraCount++;
        }

        let skyTarget = obj.skyFactor;
        if (inFrontOfCamera) {
          ndcVec.copy(obj.light.position).project(state.camera);
          const u = (ndcVec.x + 1) / 2;
          const v = (1 - ndcVec.y) / 2;
          skyTarget = u >= 0 && u <= 1 && v >= 0 && v <= 1 ? (currentIsPointSky(u, v) ? 1 : 0) : obj.skyFactor;
        } else {
          skyTarget = 0; // bakom kameran
        }
        obj.skyFactor += (skyTarget - obj.skyFactor) * skyLerpRate;
        applyFinalOpacities(obj);

        const phase = (now + obj.blinkOffsetMs) % obj.blinkPeriodMs;
        const blinkOn = night && phase < obj.blinkOnMs;
        obj.light.visible = blinkOn;
        obj.glow.visible = blinkOn;

        const shadowGlobalFactor = modeRef.current.hideAll
          ? 0
          : obj.forceVisible
            ? 1
            : modeRef.current.globalVisibilityFactor;
        const shadowSkyFactor = obj.skyFactor * shadowGlobalFactor;
        if (flickerActive && obj.shadow.visible) {
          const flicker = 0.55 + 0.45 * Math.cos(obj.bladesGroup.rotation.z * 3);
          obj.shadowMaterial.opacity = obj.shadowBaseOpacity * shadowSkyFactor * flicker;
        } else {
          obj.shadowMaterial.opacity = obj.shadowBaseOpacity * shadowSkyFactor;
        }
      }

      inFrontOfCameraCountRef.current = inFrontOfCameraCount;

      state.renderer.render(state.scene, state.camera);

      // Fotomontage-fångst: läs canvasen direkt här, i samma JS-cykel som
      // render()-anropet ovan, medan bufferten fortfarande innehåller den
      // nyss ritade bildrutan (se motivering vid `pendingCaptureRef`).
      if (pendingCaptureRef.current) {
        const resolve = pendingCaptureRef.current;
        pendingCaptureRef.current = null;
        try {
          resolve(state.renderer.domElement.toDataURL("image/png"));
        } catch {
          resolve(null);
        }
      }
    }
    raf = requestAnimationFrame(animate);

    function handleResize() {
      if (!mount) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    }
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", handleResize);
      renderer.domElement.removeEventListener("webglcontextlost", handleContextLost, false);
      renderer.domElement.removeEventListener("webglcontextrestored", handleContextRestored, false);
      glowTexture.dispose();
      shadowTexture.dispose();
      sunTexture.dispose();
      sunGlowTexture.dispose();
      occlusionTexture.dispose();
      shadowGeo.dispose();
      sunSpriteMat.dispose();
      sunGlowMat.dispose();
      for (const obj of objects) {
        obj.group.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
            else child.material.dispose();
          }
        });
        obj.light.material.dispose();
        obj.glow.material.dispose();
        obj.shadowMaterial.dispose();
        obj.label.texture.dispose();
        obj.distanceLabel.texture.dispose();
      }
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };

    function getSunAngles(mode: SunMode): { altitudeDeg: number; azimuthDeg: number } {
      if (mode === "low") {
        return { altitudeDeg: LOW_SUN_ALTITUDE_DEG, azimuthDeg: LOW_SUN_AZIMUTH_DEG };
      }
      // "current" (och fallback för "none"/"evening" om anropad, ofarligt).
      const { lat, lon } = userRef.current;
      return getCurrentSunPosition(new Date(), lat, lon);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turbines]);

  // Se `visible`-propens jsdoc: detta är en ren opacitets-/interaktions-
  // växel på den redan konstruerade canvasen, inte en (av-)montering — den
  // pågående animate-loopen och alla Three.js-objekt lever vidare oavsett.
  return (
    <div
      ref={mountRef}
      className={`absolute inset-0 transition-opacity duration-200 ${visible ? "opacity-100" : "pointer-events-none opacity-0"}`}
    />
  );
});

/**
 * Bygger en lättviktig men proportionsriktig procedurell vindkraftsmodell:
 * konisk torn, navcell, nav och tre rotorblad. Proportionerna hämtas från
 * verkets riktiga mått (navhöjd + rotordiameter) så en 250 m-turbin med
 * 169 m navhöjd och 162 m rotordiameter ser rätt ut. Modellen byggs av
 * enkla primitiver (inga externa glTF-tillgångar att ladda ner) för att
 * hålla den snabb att rendera på t.ex. iPhone Safari.
 *
 * "Framåt" för hela gruppen är den lokala -Z-axeln (samma konvention som
 * `Object3D.lookAt` använder), så när gruppen roteras för att vetta mot
 * kameran hamnar navet/rotorn korrekt vänd mot betraktaren. Rotorbladen
 * ligger i ett eget `bladesGroup` som bara roterar runt sin egen lokala
 * Z-axel (navets rotationsaxel) — resten av verket står stilla.
 */
function buildTurbineMesh(turbine: TurbineSweref): {
  group: THREE.Group;
  bladesGroup: THREE.Group;
  materials: THREE.MeshStandardMaterial[];
} {
  const group = new THREE.Group();
  const M = METERS_TO_UNITS;

  const hubY = turbine.hubHeightMeters * M;
  const rotorRadius = (turbine.rotorDiameterMeters / 2) * M;

  // Konisk torn — bredare vid basen, smalare upptill (realistisk proportion).
  const towerBaseR = 3.1 * M;
  const towerTopR = 1.5 * M;
  const towerGeo = new THREE.CylinderGeometry(towerTopR, towerBaseR, hubY, 14);
  towerGeo.translate(0, hubY / 2, 0);
  const towerMat = new THREE.MeshStandardMaterial({ color: 0xe9edf0, roughness: 0.55, metalness: 0.05 });
  const tower = new THREE.Mesh(towerGeo, towerMat);
  group.add(tower);

  // Navcell ovanpå tornet, orienterad längs lokala Z (framåt = -Z).
  const nacelleLength = 11 * M;
  const nacelleWidth = 4.2 * M;
  const nacelleHeight = 4.4 * M;
  const nacelleGeo = new THREE.BoxGeometry(nacelleWidth, nacelleHeight, nacelleLength);
  const nacelleMat = new THREE.MeshStandardMaterial({ color: 0xd7dde0, roughness: 0.5, metalness: 0.08 });
  const nacelle = new THREE.Mesh(nacelleGeo, nacelleMat);
  const nacelleZ = -nacelleLength * 0.18;
  nacelle.position.set(0, hubY, nacelleZ);
  group.add(nacelle);

  // Nav längst fram på navcellen — rotorbladens rotationsaxel går längs
  // lokala Z genom navets mittpunkt.
  const hubRadius = 2.6 * M;
  const hubGeo = new THREE.SphereGeometry(hubRadius, 16, 16);
  const hub = new THREE.Mesh(hubGeo, nacelleMat);
  const hubZ = nacelleZ - nacelleLength / 2 - hubRadius * 0.5;
  hub.position.set(0, hubY, hubZ);
  group.add(hub);

  // Rotorblad — tre stycken, tunna och avsmalnande mot spetsen, monterade
  // med roten mot navet och spetsen utåt (roterar runt navets Z-axel).
  const bladeLength = Math.max(rotorRadius - hubRadius * 0.5, 1);
  const bladeGeo = new THREE.CylinderGeometry(0.3 * M, 2.4 * M, bladeLength, 4);
  bladeGeo.translate(0, bladeLength / 2, 0);
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xf5f7f8, roughness: 0.35 });

  const bladesGroup = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    blade.rotation.z = (i * Math.PI * 2) / 3;
    bladesGroup.add(blade);
  }
  bladesGroup.position.set(0, hubY, hubZ - hubRadius * 0.35);
  group.add(bladesGroup);

  return { group, bladesGroup, materials: [towerMat, nacelleMat, bladeMat] };
}
