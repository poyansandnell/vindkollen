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
  /**
   * Juli 2026-fix (FJÄRDE kritiska buggrapporten, punkt 4): den utjämnade
   * kompassriktningen ("Heading") från `useDeviceOrientation`, enbart för
   * felsökningsloggen nedan — så "Heading" och "Camera yaw" (utläst direkt
   * ur `state.camera.quaternion` samma bildruta) kan jämföras sida vid sida.
   * En `ref` (inte ett reaktivt prop-värde) eftersom den läses inuti
   * `animate()`-loopen, inte i React-rendercykeln.
   */
  headingDegRef: React.MutableRefObject<number | null>;
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
   * Juli 2026-fix (TREDJE kritiska buggrapporten, punkt 3): rent
   * FELSÖKNINGSläge — till skillnad från `showHiddenTurbines` (som bara
   * visar en spöklik kontur av den skymda DELEN av ett verk) forcerar detta
   * ALLA verk till full opacitet och stänger av samtliga
   * synlighetsdämpningar samtidigt: per-pixel-ocklusionsshadern
   * (`uShowHidden`), himmelsmasken (`obj.skyFactor`) och Outdoor Confidence
   * Index/inomhus-heuristiken (`globalVisibilityFactor`/`hideAll`) — så att
   * man kan avgöra om "verk visas inte" beror på ocklusion/AI-segmentering
   * eller på ett fel någon annanstans i pipelinen (positionering/frustum).
   * Default av.
   */
  disableOcclusion?: boolean;
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
  /**
   * B2: Simulerat klockslag (hel timme 0–23) för solpositionsberäkning.
   * null = använd aktuell systemtid (standard). Skickas in från
   * VisualizationControls tid-scrubber så att användaren kan scrubba
   * fram/tillbaka i tid och se hur skuggorna förflyttas under dygnet.
   */
  simTimeHour?: number | null;
  /**
   * Juli 2026-fix (TREDJE kritiska buggrapporten: "Synliga verk: 0" trots
   * frisk GPS/kompass/world-update) — felsökningsläge som användaren själv
   * kan slå på/av från telefonen (se `SensorDebugPanel`), enligt
   * felrapportens uttryckliga begäran: tvinga fram EN garanterad markör
   * (gul lodrät linje mark→nav + röd sfär vid nav + text med koordinater/
   * avstånd/bäring) för det NÄRMASTE verket, helt OBEROENDE av ocklusion/
   * djup/AI-segmentering/frustum-/vinkelfilter — se `debugMarker`-logiken i
   * `animate`. Syftet är att bevisa/motbevisa om `layoutObjects`s
   * världsposition överhuvudtaget är korrekt, innan man ens tittar på
   * synlighetsfiltren ovanpå den. Default `false` (bakåtkompatibelt).
   */
  debugForceNearest?: boolean;
  /**
   * Juli 2026-fix (SJÄTTE kritiska buggrapporten, punkt 1 & 2): epoch-ms
   * (`Date.now()`) för när DENNA AR-session blev synlig (`Home.tsx`s
   * `arSessionVisible` slog om till `true`) — startpunkten för den
   * 5-sekunders "Direkt AR → World locked"-övertoningen (se
   * `WORLD_LOCK_BLEND_MS`). `null`/utelämnad betyder "redan world-locked"
   * (bakåtkompatibelt, blend=1 direkt) — används t.ex. innan sessionen
   * någonsin startat. Läses via `modeRef` inuti `animate()`, INTE ett eget
   * reaktivt state, eftersom det bara behöver sättas EN gång per session.
   */
  arStartedAtMs?: number | null;
  /**
   * Produktkrav (SJÄTTE buggrapporten, punkt 3): "Visa/dölj verk"-knappen i
   * `Home.tsx` — styr ENDAST turbinernas egen synlighet (kropp/etiketter/
   * ljus/glöd/skugga), aldrig AR-sessionen/kameran/pilen. Tonas mjukt
   * in/ut över `TURBINES_VISIBLE_FADE_MS` (0.5s) i `animate()`, aldrig ett
   * omedelbart hopp. Default `true` (bakåtkompatibelt).
   */
  turbinesVisible?: boolean;
  /**
   * V36: signal från `useDeviceOrientation` att inga nya sensor-event har
   * kommit på ett tag. När sant snappar kameran direkt till senaste kända
   * kvaternion istället för att mjuka ut — sol/sprite fastnar inte på
   * skärmen om sensorn tillfälligt tystnat.
   */
  orientationStalled?: boolean;
  /**
   * V20: Anropas varje gång antalet "landade" verk ändras under
   * ingångs-animationen (fall-in, 1.5 s). Används för "X / N på plats"-
   * räknaren i Home.tsx. Kallas inte alls om animationen redan slutförts.
   */
  onTurbineLanded?: (landed: number, total: number) => void;
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
// Juli 2026-fix: golv för hur mycket per-pixel-ocklusionen (den lätta
// himmel-heuristiken i `useSkyDetection`) får dämpa ett verk — ALDRIG ner
// till 0/`discard`. Heuristiken kan felklassificera en hel bild (disigt
// ljus, motljus, texturerad himmel) och tidigare gjorde `discard` det till
// en total, appbrytande osynlighet för samtliga verk samtidigt trots att
// allt annat (GPS/kompass/world-position) var friskt. Se kommentaren vid
// `attachOcclusionShader` nedan.
const OCCLUSION_MIN_ALPHA = 0.45;
// Juli 2026-fix (SJÄTTE kritiska buggrapporten, "verken måste ALLTID synas
// direkt vid AR-start, även inomhus"): under de första `WORLD_LOCK_BLEND_MS`
// millisekunderna efter att AR-sessionen blivit synlig tvingas samtliga
// dämpnings-/ocklusionsfaktorer (Outdoor Confidence Index, inomhus-
// heuristiken, per-pixel-himmelsmasken) mot 1 (fullt synligt, ingen
// dämpning) — se `worldLockBlendRef`/`applyFinalOpacities`/
// `attachOcclusionShader` nedan. Därefter blandas de MJUKT (linjärt, ingen
// tröskel/hopp) in mot sina normala beräknade värden, så övergången från
// "Direkt AR" (skärmnära, garanterat synligt) till "World locked" (full
// GPS/kompass/pitch-stabiliserad rendering) aldrig känns som ett hack.
const WORLD_LOCK_BLEND_MS = 5000;
// Produktkrav: "Visa/dölj verk"-togglen (Home.tsx) ska tona in/ut verken på
// 0.5s — helt oberoende av `WORLD_LOCK_BLEND_MS` ovan och av ocklusionen,
// eftersom det är ett rent manuellt användarval, inte en sensorhärledd
// dämpning.
const TURBINES_VISIBLE_FADE_MS = 500;

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
  /**
   * Juli 2026-fix (regressionsrapport punkt 8: persistent, alltid synlig
   * felsökningstext) — aktuell renderloop-hälsa: bildrutor/sekund (mätt över
   * ett rullande ~500ms-fönster, se `animate`) och totalt antal renderade
   * bildrutor sedan `ARScene` monterades. Ett `frameCount` som fortsätter
   * stiga är i sig ett bevis på att renderloopen faktiskt kör kontinuerligt
   * och inte har fastnat/blockerats.
   *
   * Juli 2026-fix (produktkrav 6, ny omgång — extra felsökningsfält):
   * `worldPositionsUpdated` är `true` så länge `animate`-loopen körs,
   * eftersom varje verks `obj.group.position` räknas om från bäring/avstånd
   * (SWEREF→bäring→x/y/z) VARJE bildruta — se kommentaren vid
   * `obj.group.position.set(...)` nedan — aldrig cachat/skärmlåst.
   * `visibleTurbineCount` återanvänder exakt samma beräkning som
   * `getInFrontOfCameraCount()` (samma 3D-optiska-axel-vinkel, inte bara
   * bäring) så felsökningsraden aldrig kan visa ett annat tal än det
   * "rakt fram"-garantin faktiskt använder. `screenLocked` är alltid
   * `false` — turbinerna placeras aldrig i skärmrymd, bara i världsrymd
   * (produktkrav 3), så fältet finns enbart för att göra frånvaron av
   * skärmlåsning explicit synlig i felsökningsraden.
   */
  getDebugStats: () => {
    fps: number;
    frameCount: number;
    worldPositionsUpdated: boolean;
    visibleTurbineCount: number;
    screenLocked: boolean;
    /**
     * Juli 2026-fix (SJÄTTE kritiska buggrapporten, punkt 1/2/4):
     * "direct" = "Direkt AR" (precis startad, alla dämpningar tvingade
     * till 1), "stabilizing" = mitt i den 5s-övertoningen, "world-locked"
     * = full GPS/kompass/pitch-stabiliserad rendering. Härlett direkt från
     * `worldLockBlendRef` (0 / 0<x<1 / 1) — se `WORLD_LOCK_BLEND_MS`.
     */
    renderMode: "direct" | "stabilizing" | "world-locked";
    /**
     * Den FAKTISKA, opacitetsbaserade "Synliga verk"-räkningen
     * (`currentOpacity > 0.02`, samma test som redan drev `animate()`s
     * diagnostikloop) — till skillnad från `visibleTurbineCount` ovan
     * (vinkel-/FOV-baserad, ignorerar faktisk opacitet/ocklusion/"Visa/
     * dölj verk"-togglen) är detta talet produktkravets "Synliga verk:
     * antal"-felsökningsfält ska visa.
     */
    trueVisibleTurbineCount: number;
    /** V34/C2b: kamerans framåt-y efter applyQuaternion — negativt värde = telefonen pekar neråt. */
    cameraForwardY: number;
  };
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
  /**
   * Varje materials ursprungsfärg, sparad EN gång vid uppbyggnad — används
   * för att kunna tona tillbaka från `INDOOR_TINT_COLOR` (se `hideAll` i
   * `applyFinalOpacities`) utan att ackumulera färgdrift över tid.
   */
  originalColors: THREE.Color[];
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
  /**
   * V35/Fix1: 0..1-närvaro baserad på vinkel mot kamerans optiska axel —
   * 1 i FOV-kärnan, mjuk fade mot 0 vid `FORCE_FADE_OUT_DEG`. Styr opacity
   * längs force-visible-banan i `applyFinalOpacities` och skugg-logiken.
   */
  viewPresence: number;
  /**
   * Juli 2026-fix (kritisk buggrapport punkt 1/4: exakta, engångsloggade
   * steg-för-steg-loggar + per-verk synlighetsdiagnostik) — säkerställer att
   * "[AR] Modell placerad"/"[AR] Modell synlig" bara loggas EN gång per verk
   * (första gången det faktiskt får en världsposition respektive första
   * gången det faktiskt renderas synligt), inte varje bildruta.
   */
  loggedPlaced: boolean;
  loggedVisible: boolean;
  /**
   * Juli 2026-fix (TREDJE kritiska buggrapporten, punkt 2): bäring (grader
   * från norr) beräknad senast i `layoutObjects`, sparad så den utökade
   * per-verk-diagnostiktabellen i `animate` slipper räkna om den en andra
   * gång per bildruta.
   */
  lastBearingDeg: number;
  /**
   * V29: Alla THREE.Mesh-barn i `group`, cachade vid init. Används för att
   * toggla `frustumCulled` per frame när `forceVisible` är sant — annars
   * blockerar Three.js default frustum-culling rendering även om opaciteten
   * är 1.
   */
  cachedMeshes: THREE.Mesh[];
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
// V35/Fix1: Vinkel vid vilken force-visible verk fader ut helt — mjuk
// övergång från IN_VIEW_HALF_ANGLE_DEG (synlig) till FORCE_FADE_OUT_DEG
// (osynlig) så verken inte "sitter fast" när kameran vrids bort.
const FORCE_FADE_OUT_DEG = IN_VIEW_HALF_ANGLE_DEG + 18; // ~50.5°
export const MAX_RENDER_DISTANCE_M = 9000;

// Juli 2026-fix (kritisk buggrapport: "inga verk visas alls"): `hideAll`
// (den kamera-heuristikbaserade inomhus-/fri sikt-detekteringen, se
// `useSkyDetection`) och `globalVisibilityFactor`s "hide"-läge (Outdoor
// Confidence Index) kunde tidigare båda tvinga turbinernas opacitet till
// EXAKT 0 — en falsk positiv i endera heuristiken (t.ex. mulen himmel,
// kameran riktad nedåt en sekund) gjorde alla 29 verk fullständigt osynliga
// med NOLL indikation om varför. Produktkrav: en 3D-modell som redan
// skapats/positionerats ska ALDRIG bli helt osynlig av en mjuk synlighets-
// heuristik — bara av verklig per-pixel-ocklusion (`attachOcclusionShader`,
// mark/hus/träd) eller genom att ligga utanför `MAX_RENDER_DISTANCE_M`.
// `INDOOR_DIM_FACTOR` (uttrycklig "inomhus"-detektering) och
// `MIN_CONFIDENCE_VISIBILITY_FACTOR` (den mjukare ML/himmel-konfidensen)
// är därför GOLV, inte nollor — och `obj.forceVisible` (2-sekunders
// säkerhetsfallbacken, se `Home.tsx`s `calibrationFallbackActive`) vinner nu
// över BÅDA istället för att förlora mot `hideAll`, se `applyFinalOpacities`.
const INDOOR_DIM_FACTOR = 0.45;
const MIN_CONFIDENCE_VISIBILITY_FACTOR = 0.15;
// Grå/blå ton som turbinkroppens material blandas mot när `hideAll` är
// aktivt — en tydlig visuell signal ("det här verket är dämpat för att du
// verkar vara inomhus", inte bara halvtransparent i sin vanliga färg).
const INDOOR_TINT_COLOR = new THREE.Color(0x6b7c93);
const INDOOR_TINT_BLEND = 0.6;
// Meter -> scenens enheter. Vald så att den visuella storleken/avstånden
// matchar kamerans FOV/klippplan (samma skala som tidigare, enklare modell).
const METERS_TO_UNITS = 0.9;
// V39: lampan på verkets allra högsta punkt (totalhöjd / bladspets).
const LIGHT_TOP_OFFSET_M = 0;

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

/**
 * Juli 2026-fix (TREDJE kritiska buggrapporten, punkt 2): flerradig
 * felsökningsetikett för `debugMarkerRef` — samma per-verk-fält som
 * felrapporten efterfrågade (GPS lat/lon, ENU x/y/z, bäring, pitch, avstånd),
 * skrivna rad för rad istället för `drawLabel`s fasta titel+undertext-layout.
 */
function drawDebugLabel(label: CanvasLabel, lines: string[]) {
  const { ctx, canvas } = label;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(20, 15, 0, 0.85)";
  ctx.strokeStyle = "rgba(255, 221, 0, 0.9)";
  ctx.lineWidth = 3;
  ctx.fillRect(4, 4, canvas.width - 8, canvas.height - 8);
  ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ffdd00";
  ctx.font = "600 26px monospace";
  const lineHeight = 27;
  const startY = 12;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], 16, startY + i * lineHeight, canvas.width - 32);
  }
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
    headingDegRef,
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
    simTimeHour = null,
    debugForceNearest = false,
    disableOcclusion = false,
    arStartedAtMs = null,
    turbinesVisible = true,
    orientationStalled = false,
    onTurbineLanded,
  },
  forwardedRef,
) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  // V25: smoothad yaw-komponent (grader) för att dämpa diskreta sensor-hopp
  // vid snabb rotation. Nollställs aldrig automatiskt — kontinuitet är bättre
  // än reset-hopp vid re-renders.
  const smoothedYawDegRef = useRef<number | null>(null);
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
    simTimeHour: simTimeHour ?? null,
    showHiddenTurbines: showHiddenTurbines ?? false,
    globalVisibilityFactor: globalVisibilityFactor ?? 1,
    hideAll: hideAll ?? false,
    forceVisibleIds: forceVisibleIds ?? EMPTY_FORCE_VISIBLE_IDS,
    debugForceNearest,
    disableOcclusion,
    arStartedAtMs: arStartedAtMs ?? null,
    turbinesVisible: turbinesVisible ?? true,
    orientationStalled: orientationStalled ?? false,
  });
  const skyRef = useRef({
    isPointSky: isPointSky ?? DEFAULT_IS_POINT_SKY,
    getOcclusionGrid: getOcclusionGrid ?? DEFAULT_GET_OCCLUSION_GRID,
  });
  // V20: callback-ref för fall-animation (anropas från animate-loopen, ej från React)
  const onTurbineLandedRef = useRef(onTurbineLanded);
  useEffect(() => { onTurbineLandedRef.current = onTurbineLanded; }, [onTurbineLanded]);
  // Väntande Fotomontage-förfrågan — löses in synkront direkt efter nästa
  // renderade bildruta i animationsloopen (se `animate`), istället för att
  // sätta `preserveDrawingBuffer: true` på renderaren. Att läsa canvasen i
  // samma JS-cykel som `renderer.render()` fungerar utan preserveDrawingBuffer
  // (webbläsaren hinner inte rensa/kompositera bufferten emellan), och
  // undviker den extra GPU-minnesbelastning som tidigare kunde göra att hela
  // kameravyn plötsligt försvann bakom en ogenomskinlig canvas (förlorad
  // WebGL-kontext).
  const pendingCaptureRef = useRef<((dataUrl: string | null) => void) | null>(null);
  // Juli 2026-fix (TREDJE kritiska buggrapporten, punkt 1): garanterad
  // felsökningsmarkör för det NÄRMASTE verket — en gul lodrät linje
  // (mark→nav) + röd sfär (nav) + textetikett (koordinater/avstånd/bäring),
  // helt frikopplad från ocklusionsshadern/himmelsmasken/`applyFinalOpacities`
  // (egna material, `depthTest: false`, `frustumCulled = false`, mycket hög
  // `renderOrder`) — se användningen i `animate`. Skapas EN gång och
  // återanvänds/omplaceras varje bildruta istället för att skapas per verk.
  const debugMarkerRef = useRef<{
    line: THREE.Line;
    lineGeo: THREE.BufferGeometry;
    sphere: THREE.Mesh;
    label: CanvasLabel;
  } | null>(null);
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
  // V34/C2b: kamerans framåt-y — lagras varje bildruta för pitch-detektion
  // i Home.tsx (cameraForward.y < -0.35 → telefonen pekar nedåt).
  const cameraForwardYRef = useRef(0);
  // Juli 2026-fix (regressionsrapport punkt 8: persistent felsökningstext
  // ska visa FPS och bildrutenummer) — uppdateras i `animate` nedan och
  // läses av `Home.tsx` via `getDebugStats()`, samma mönster som
  // `inFrontOfCameraCountRef`/`getInFrontOfCameraCount`.
  const frameCountRef = useRef(0);
  const fpsRef = useRef(0);
  const fpsWindowStartRef = useRef<number | null>(null);
  const fpsWindowFramesRef = useRef(0);
  // Juli 2026-fix ("pilen/verken fryser helt trots bra FPS/AR-stabilitet"):
  // `Date.now()` för senaste `animate()`-anrop, oavsett vad övriga
  // felsökningstal säger — grunden för den fristående render-loop-
  // vakthunden nedan OCH för det tidigare hårdkodade (aldrig sanna)
  // `screenLocked`-fältet i `getDebugStats()`. `false` gav ingen som helst
  // diagnostisk signal; nu räknas det ut från just denna tidsstämpel.
  const lastFrameAtRef = useRef<number | null>(null);
  const renderLoopStalledRef = useRef(false);
  // Sjunde kritiska buggrapporten (punkt 2): loggar EN gång, den allra
  // första gången `animate()` faktiskt körs — beviset (inte bara ett
  // påstående) att render-loopen kom igång, komplement till
  // "startAR()"-loggen som bara visar att den BEGÄRDES.
  const firstRenderFrameLoggedRef = useRef(false);
  // Juli 2026-fix (SJÄTTE kritiska buggrapporten, punkt 1/2/4): 0 = "Direkt
  // AR" (precis startad, alla dämpningar tvingade till 1), 1 = fullt
  // "World locked" — uppdateras varje bildruta i `animate()` från
  // `modeRef.current.arStartedAtMs`, läses både av `applyFinalOpacities`/
  // `attachOcclusionShader` (för att blanda dämpningsfaktorerna) OCH av
  // `getDebugStats()` (för felsökningstextens "Rendering mode").
  const worldLockBlendRef = useRef(1);
  // "Visa/dölj verk"-togglens EGNA, tidsbaserade 0..1-faktor (0.5s tona in/
  // ut) — initieras till startvärdet av `turbinesVisible`-propen så det
  // inte tonar in vid första monteringen om default redan är `true`.
  const turbinesVisibleFactorRef = useRef(turbinesVisible === false ? 0 : 1);
  // Den FAKTISKA, opacitetsbaserade "Synliga verk"-räkningen (samma
  // `currentOpacity > 0.02`-test som redan drev den lokala `isVisible` i
  // `animate()`s diagnostikloop) — till skillnad från
  // `inFrontOfCameraCountRef` (vinkel-/FOV-baserad, ignorerar faktisk
  // opacitet) är detta talet som produktkravets "Synliga verk: antal"-fält
  // ska visa.
  const trueVisibleTurbineCountRef = useRef(0);
  // Kamerarörelseinterpolation (slerp): sensor-kvaternionen (`quaternionRef`)
  // uppdateras i sensorhändelseloopen och kan ha kvarvarande mikro-brus även
  // efter utjämning. Kameran interpoleras MJUKT mot det senaste sensor-
  // värdet varje bildruta istället för att snäppa till det direkt — vid 60fps
  // och tau=0.07s rör sig kameran 20% av vägen per bildruta, vilket tar
  // ~3τ ≈ 210ms till 95%, så verkliga rörelser följer sömlöst medan
  // sub-graders sensorbrus virtuellt försvinner visuellt.
  const cameraTargetQuatRef = useRef(new THREE.Quaternion());

  // Callback som låter `visible`-effekten nedan starta om rAF-loopen utan
  // att behöva tillgång till `raf`/`animate` (som är closure-lokala i
  // setup-effekten). Sätts av setup-effekten direkt efter att loopen startas.
  const restartRafRef = useRef<(() => void) | null>(null);

  // "Visible=true": loggas EN gång när `visible`-propen (arSessionVisible i
  // Home.tsx) faktiskt slår om till true — se produktkravets punkt 2.
  // Fix (bugg: "verk saknas vid första öppning"): när `visible` växlar till
  // true startas rAF-loopen om synkront. På iOS kan appen ha gått till
  // bakgrunden (rAF pausades) och watchdog-timern hinner inte alltid starta
  // om loopen exakt när appen återgår till förgrunden — en explicit omstart
  // här garanterar att den allra första bildrutan efter att AR-vyn öppnas
  // faktiskt renderas. Dessutom återställs `turbinesVisibleFactorRef` till
  // sitt rätta startvärde ifall det fastnat vid 0 under en föregående session.
  const loggedVisibleRef = useRef(false);
  useEffect(() => {
    if (visible) {
      if (!loggedVisibleRef.current) {
        loggedVisibleRef.current = true;
        console.info("[AR][pipeline] Visible=true (ARScene canvas)");
      }
      // Återställ turbinsvisibilitetsfaktorn ifall den fastnat vid 0
      // (t.ex. om användaren dolde verken i en föregående session och sedan
      // migrerade appen till bakgrunden med faktorn kvar på 0).
      if (turbinesVisibleFactorRef.current < 0.01 && turbinesVisible !== false) {
        turbinesVisibleFactorRef.current = 0.01;
      }
      // Starta om rAF-loopen explicit — garanterar en ny renderbildruta
      // direkt när vyn öppnas, oavsett om watchdog hinner göra det.
      restartRafRef.current?.();
    }
    if (!visible) {
      loggedVisibleRef.current = false;
    }
  }, [visible, turbinesVisible]);

  userRef.current = { lat: userLat, lon: userLon };
  modeRef.current = {
    sunMode,
    realScale,
    visibility,
    nightMode,
    shadowFlicker,
    simTimeHour: simTimeHour ?? null,
    showHiddenTurbines: showHiddenTurbines ?? false,
    globalVisibilityFactor: globalVisibilityFactor ?? 1,
    hideAll: hideAll ?? false,
    forceVisibleIds: forceVisibleIds ?? EMPTY_FORCE_VISIBLE_IDS,
    debugForceNearest,
    disableOcclusion,
    arStartedAtMs: arStartedAtMs ?? null,
    turbinesVisible: turbinesVisible ?? true,
    orientationStalled: orientationStalled ?? false,
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
    getDebugStats: () => ({
      fps: fpsRef.current,
      frameCount: frameCountRef.current,
      worldPositionsUpdated: frameCountRef.current > 0,
      visibleTurbineCount: inFrontOfCameraCountRef.current,
      // `screenLocked` var tidigare hårdkodat `false` — aldrig sant, alltså
      // ingen diagnostisk signal alls. Räknas nu ut från `lastFrameAtRef`
      // (satt varje `animate()`-anrop): sant om render-loopen inte kört på
      // över en halv sekund, oavsett OM webbläsaren råkat pausa rAF (t.ex.
      // bakom en overlay/annan flik) eller loopen faktiskt kraschat.
      screenLocked: lastFrameAtRef.current !== null && Date.now() - lastFrameAtRef.current > 500,
      renderMode:
        worldLockBlendRef.current <= 0 ? "direct" : worldLockBlendRef.current >= 1 ? "world-locked" : "stabilizing",
      trueVisibleTurbineCount: trueVisibleTurbineCountRef.current,
      // V34/C2b: kamerans framåt-y för pitch-detektion i Home.tsx.
      cameraForwardY: cameraForwardYRef.current,
    }),
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
    // V23: Filmisk tonemapping — förhindrar överexponering i starkt ljus/sol.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.85;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
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
    console.info("[AR][pipeline] Renderer attached");

    // V23: Sänkt ljusstyrka — förhindrar vita tvättade verk i solljus.
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambient);
    const sunLight = new THREE.DirectionalLight(0xffffff, 0.3);
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
        // Juli 2026-fix (SJÄTTE kritiska buggrapporten, punkt 1 & 5): under
        // "Direkt AR" (`worldLockBlendRef` nära 0, se `WORLD_LOCK_BLEND_MS`)
        // ska ocklusionen INTE dämpa alls — verket ska synas fullt oavsett
        // vad himmelsmasken tror den ser. `uWorldLockBlend` blandas in i
        // else-grenen nedan, precis som `applyFinalOpacities` blandar sina
        // motsvarande faktorer, så övergången är mjuk snarare än ett hopp.
        shader.uniforms.uWorldLockBlend = { value: worldLockBlendRef.current };
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec4 vOcclusionClipPos;")
          .replace("#include <project_vertex>", "#include <project_vertex>\nvOcclusionClipPos = gl_Position;");
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            `#include <common>
            varying vec4 vOcclusionClipPos;
            uniform sampler2D uOcclusionMap;
            uniform float uShowHidden;
            uniform float uWorldLockBlend;`,
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
                // Juli 2026-fix (kritisk buggrapport: "vindkraftverken
                // renderas aldrig, trots att GPS/kompass/AR-stabilitet är
                // helt friska"): denna gren körde tidigare discard() när
                // visMask var nära 0, dvs. skar bort fragmentet HELT.
                // occlusion kommer från useSkyDetection.ts:s lätta
                // ljusstyrke/textur/mättnad-heuristik (classifyCell) — en
                // grov kamerabild-klassificering, inte en riktig semantisk
                // segmentering. Den kan (och gör, på riktiga enheter i t.ex.
                // disigt/mulet ljus, motljus, eller när kameran råkar peka
                // mot en ljus men "texturerad" himmel) felklassificera FRI
                // himmel som "ej himmel" över hela eller stora delar av
                // bilden samtidigt, vilket tidigare gjorde att discard()
                // slog till för alla 29 verkens samtliga fragment på en
                // gång — verken existerade i scenen (scene.add(),
                // korrekt world-position, korrekt skala) men syntes ändå
                // aldrig, vilket är exakt symptomet i buggrapporten. Detta
                // bryter också mot det uttryckliga produktkravet att
                // ocklusion bara ska DÄMPA (som INDOOR_DIM_FACTOR/
                // MIN_CONFIDENCE_VISIBILITY_FACTOR gör på annat håll i
                // denna fil), aldrig ta bort verket helt. Ett golv
                // (OCCLUSION_MIN_ALPHA) ersätter discard() — ett verk bakom
                // ett äkta hinder (träd/byggnad) blir alltså kraftigt
                // nedtonat men aldrig helt osynligt, och en felklassificerad
                // "falsk ocklusion" kan därför aldrig ensam förklara att ett
                // verk inte syns alls.
                //
                // Juli 2026-fix (SJÄTTE kritiska buggrapporten, punkt 1 & 2):
                // uWorldLockBlend (0 precis vid AR-start, mjukt mot 1 över
                // WORLD_LOCK_BLEND_MS) blandas in HÄR — vid blend=0 är
                // alpha-faktorn tvingad till 1.0 (ingen ocklusionsdämpning
                // alls, "Direkt AR"), vid blend=1 är den den fulla, normalt
                // beräknade ocklusionsdämpningen ovan. Aldrig ett hopp.
                float occlusionAlphaFactor = mix(${OCCLUSION_MIN_ALPHA.toFixed(2)}, 1.0, visMask);
                gl_FragColor.a *= mix(1.0, occlusionAlphaFactor, uWorldLockBlend);
              }
            }
            #include <dithering_fragment>`,
          );
        occlusionShaders.push(shader);
      };
    }

    console.info(`[AR][pipeline] Loaded ${turbines.length} turbines`);
    const objects: TurbineObject[] = turbines.map((turbine, index) => {
      console.info(`[AR][pipeline] Creating turbine #${index} (${turbine.name})`);
      const { lat, lon } = swerefToWgs84(turbine.easting, turbine.northing);
      const { group, bladesGroup, materials } = buildTurbineMesh(turbine);
      for (const mat of materials) attachOcclusionShader(mat);
      scene.add(group);
      // V29: Samla alla Mesh-barn i en array vid init så vi kan toggla
      // frustumCulled per frame utan att traversera scengraphen varje gång.
      const cachedMeshes: THREE.Mesh[] = [];
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) cachedMeshes.push(child);
      });
      // "Anchor created"/"Model loaded": denna app använder inte WebXR/
      // ARCore-ankare (se replit.md: bäring/avstånd + enhetsorientering,
      // för bred webbläsarkompatibilitet) — gruppens/mesh:ens skapande OCH
      // tillägg till scenen ÄR motsvarigheten, loggas därför direkt här.
      console.info(`[AR][pipeline] Anchor created for turbine #${index} (${turbine.name})`);
      console.info(`[AR][pipeline] Model loaded for turbine #${index} (${turbine.name})`);
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
        originalColors: materials.map((mat) => mat.color.clone()),
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
        viewPresence: 0,
        cachedMeshes,
        loggedPlaced: false,
        loggedVisible: false,
        lastBearingDeg: 0,
      };
    });

    sceneStateRef.current = { scene, camera, renderer, objects, ambient, sunLight, sunSprite, sunGlow };

    // Juli 2026-fix (TREDJE kritiska buggrapporten, punkt 1): garanterad
    // felsökningsmarkör för det närmaste verket (se `debugMarkerRef`s jsdoc).
    // Egna material (INTE `attachOcclusionShader`), `depthTest: false` och
    // extremt hög `renderOrder` gör att markören alltid ritas ovanpå ALLT
    // annat i scenen — helt oberoende av ocklusionsrutnätet, himmelsmasken,
    // frustum-testet och `angleFromOpticalAxisDeg`, precis som efterfrågat.
    // `frustumCulled = false` säkerställer dessutom att Three.js egna
    // (bounding-sphere-baserade) frustum-culling aldrig kan dölja den, även
    // om markören råkar hamna utanför kamerans synfält.
    const debugLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]);
    const debugLineMat = new THREE.LineBasicMaterial({ color: 0xffdd00, depthTest: false, linewidth: 3 });
    const debugLine = new THREE.Line(debugLineGeo, debugLineMat);
    debugLine.frustumCulled = false;
    debugLine.renderOrder = 10000;
    debugLine.visible = false;
    scene.add(debugLine);

    const debugSphereGeo = new THREE.SphereGeometry(3 * METERS_TO_UNITS, 16, 16);
    const debugSphereMat = new THREE.MeshBasicMaterial({ color: 0xff2020, depthTest: false });
    const debugSphere = new THREE.Mesh(debugSphereGeo, debugSphereMat);
    debugSphere.frustumCulled = false;
    debugSphere.renderOrder = 10001;
    debugSphere.visible = false;
    scene.add(debugSphere);

    const debugLabel = createCanvasLabel();
    debugLabel.sprite.frustumCulled = false;
    debugLabel.sprite.renderOrder = 10002;
    debugLabel.sprite.visible = false;
    debugLabel.sprite.scale.set(60, 24, 1);
    scene.add(debugLabel.sprite);

    debugMarkerRef.current = { line: debugLine, lineGeo: debugLineGeo, sphere: debugSphere, label: debugLabel };

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
      // Juli 2026-fix (TREDJE kritiska buggrapporten, punkt 1): håller reda
      // på det GEOMETRISKT närmaste verket (rent GPS-avstånd, oberoende av
      // riktning/synlighet) medan loopen ändå går igenom alla objekt, så
      // `updateDebugMarker` nedan slipper en egen extra genomgång.
      let nearestObj: TurbineObject | null = null;
      let nearestDist = Infinity;
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

        // Juli 2026-fix (kritisk buggrapport punkt 1): exakt den loggtext
        // felrapporten efterfrågade, EN gång per verk, precis när
        // världspositionen (`obj.group.position`) faktiskt satts för första
        // gången — bevisar att detta steg körs oavsett vad som händer
        // längre ner i pipelinen (himmelsmask/opacitet/frustum).
        if (!obj.loggedPlaced && Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          obj.loggedPlaced = true;
          console.info(
            `[AR] Modell placerad (${obj.turbine.name}, avstånd=${dist.toFixed(0)}m, bäring=${bearing.toFixed(1)}°, world=(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}), skala=${scaleDamp.toFixed(3)})`,
          );
        }

        const totalHeightUnits = obj.turbine.heightMeters * METERS_TO_UNITS;
        const hubHeightUnits = obj.turbine.hubHeightMeters * METERS_TO_UNITS;
        const labelHeight = totalHeightUnits * scaleDamp * 0.42 - 8;
        obj.label.sprite.position.set(x, y + labelHeight + 34 * scaleDamp, z);
        obj.label.sprite.scale.set(34 * scaleDamp, 8.5 * scaleDamp, 1);
        obj.distanceLabel.sprite.position.set(x, y + labelHeight + 22 * scaleDamp, z);
        obj.distanceLabel.sprite.scale.set(24 * scaleDamp, 6 * scaleDamp, 1);

        // V39: placera hinderljuset på verkets allra högsta punkt (bladspets).
        const lightY = y + (totalHeightUnits + LIGHT_TOP_OFFSET_M * METERS_TO_UNITS) * scaleDamp;
        obj.light.position.set(x, lightY, z);
        // Minsta synliga storlek för flygsäkerhetsbelysning oavsett avstånd —
        // annars försvinner de vid >2 km som enkla pixels. `Math.max` säker-
        // ställer att lampan alltid syns som minst en tydlig prick på skärmen.
        obj.light.scale.setScalar(Math.max(6 * scaleDamp, 16));
        obj.glow.position.set(x, lightY, z);
        obj.glow.scale.setScalar(Math.max(26 * scaleDamp, 70));

        drawLabel(obj.label, obj.turbine.name, "");
        drawLabel(obj.distanceLabel, formatDistance(dist), "");

        layoutShadow(obj, x, y, z, scaleDamp);
        applyVisibility(obj, dist);
        obj.lastBearingDeg = bearing;
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestObj = obj;
        }
      }
      updateDebugMarker(nearestObj);
    }

    // Juli 2026-fix (TREDJE kritiska buggrapporten, punkt 1): omplacerar
    // felsökningsmarkören på det närmaste verkets FAKTISKA världsposition
    // (samma `obj.group.position`/`obj.light.position` som allt annat läser)
    // varje bildruta, och slår av/på dess synlighet ENBART via
    // `modeRef.current.debugForceNearest` — ingen ocklusion, himmelsmask,
    // frustum- eller vinkelkontroll rör vid den här funktionen alls.
    function updateDebugMarker(nearest: TurbineObject | null) {
      const marker = debugMarkerRef.current;
      if (!marker) return;
      const on = modeRef.current.debugForceNearest && nearest !== null;
      marker.line.visible = on;
      marker.sphere.visible = on;
      marker.label.sprite.visible = on;
      if (!on || !nearest) return;

      const groundPos = nearest.group.position;
      const hubPos = nearest.light.position;
      const positions = marker.lineGeo.attributes.position as THREE.BufferAttribute;
      positions.setXYZ(0, groundPos.x, groundPos.y, groundPos.z);
      positions.setXYZ(1, hubPos.x, hubPos.y, hubPos.z);
      positions.needsUpdate = true;
      marker.lineGeo.computeBoundingSphere();

      marker.sphere.position.copy(hubPos);
      const labelYOffset = 14 * METERS_TO_UNITS;
      marker.label.sprite.position.set(hubPos.x, hubPos.y + labelYOffset, hubPos.z);

      const { lat: uLat, lon: uLon } = userRef.current;
      drawDebugLabel(marker.label, [
        `FELSÖKNING: ${nearest.turbine.name}`,
        `GPS mål: ${nearest.lat.toFixed(5)}, ${nearest.lon.toFixed(5)}`,
        `GPS jag: ${uLat.toFixed(5)}, ${uLon.toFixed(5)}`,
        `ENU x/y/z: ${groundPos.x.toFixed(1)} / ${groundPos.y.toFixed(1)} / ${groundPos.z.toFixed(1)}`,
        `Nav x/y/z: ${hubPos.x.toFixed(1)} / ${hubPos.y.toFixed(1)} / ${hubPos.z.toFixed(1)}`,
        `Bäring: ${nearest.lastBearingDeg.toFixed(1)}°  Avstånd: ${nearest.renderDistM.toFixed(0)} m`,
      ]);
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
      // `globalVisibilityFactor` (Outdoor Confidence Index-tröskeln) och
      // `hideAll` (inomhus-/fri sikt-heuristiken) verkar båda som DÄMPNINGAR,
      // aldrig som fullständiga döljningar — se motiveringen vid
      // `INDOOR_DIM_FACTOR`/`MIN_CONFIDENCE_VISIBILITY_FACTOR` ovan.
      // `obj.forceVisible` (rakt-fram-garanti ±25° eller
      // kalibreringsfallbackens `forceVisibleIds`, se `animate`) vinner nu
      // över BÅDA — 2-sekunderssäkerhetsnätet ska garantera att användaren
      // ser något på riktigt, inte bara en dämpad skugga, oavsett vad
      // inomhusheuristiken eller Outdoor Confidence Index tycker just då.
      // Juli 2026-fix (TREDJE kritiska buggrapporten, punkt 3): `disableOcclusion`
      // kortsluter BÅDA dämpningsfaktorerna (Outdoor Confidence Index/
      // inomhus-heuristiken OCH himmelsmasken) till 1 — se propens jsdoc.
      const { disableOcclusion: occlusionDisabled } = modeRef.current;
      // V35/Fix1: presence (0..1) kopplar forceVisible-banan till faktisk vinkel.
      const presence = Math.min(1, Math.max(0, obj.viewPresence));
      // V36: under de första sekunderna av en AR-session (worldLockBlend < 1)
      // tvingar vi force-visible-verk till full närvaro oavsett om kameran
      // pekar åt rätt håll. Verken dyker upp direkt i riktig AR; fades
      // korrekt mot vinkelstyrd opacitet när blenden nått 1.
      const isSafetyForced = modeRef.current.forceVisibleIds.has(obj.turbine.id);
      const forceVisibleCold =
        isSafetyForced || (obj.forceVisible && worldLockBlendRef.current < 1);
      const effectivePresence = forceVisibleCold ? 1 : presence;
      const naturalGlobalFactor = occlusionDisabled
        ? 1
        : obj.forceVisible
          ? effectivePresence
          : modeRef.current.hideAll
            ? INDOOR_DIM_FACTOR
            : Math.max(modeRef.current.globalVisibilityFactor, MIN_CONFIDENCE_VISIBILITY_FACTOR);
      // Juli 2026-fix (SJÄTTE kritiska buggrapporten, punkt 1 & 2): "Direkt
      // AR"-övertoningen (`worldLockBlendRef`, 0 precis vid AR-start, mjukt
      // mot 1 över `WORLD_LOCK_BLEND_MS`) tvingar globalFactor/skyFactor mot
      // 1 (fullt synligt) i början, oavsett Outdoor Confidence Index/
      // inomhus-heuristik/himmelsmask, och blandas sedan LINJÄRT (aldrig ett
      // hopp) mot deras normalt beräknade ("naturliga") värden. `1 + (x-1)*b`
      // ger exakt 1 vid b=0 och exakt x vid b=1.
      // V35: force-banan hoppar worldLockBlend-boost — annars hänger fallback
      // kvar off-axis med konstant opacity 1.
      const worldLockBlend = worldLockBlendRef.current;
      const globalFactor = obj.forceVisible
        ? naturalGlobalFactor
        : 1 + (naturalGlobalFactor - 1) * worldLockBlend;
      const forcedSky = obj.forceVisible ? effectivePresence : obj.skyFactor;
      const naturalSkyFactor = occlusionDisabled ? 1 : forcedSky * (obj.forceVisible ? 1 : naturalGlobalFactor);
      // "Visa/dölj verk"-togglens egna, oberoende 0..1-tonings-faktor
      // (`turbinesVisibleFactorRef`, 0.5s in/ut) multipliceras in sist, på
      // BÅDA kanalerna, så hela verket (kropp + etiketter/ljus/glöd) tonar
      // enhetligt.
      const turbinesVisibleFactor = turbinesVisibleFactorRef.current;
      const skyFactor = (obj.forceVisible
        ? naturalSkyFactor
        : 1 + (naturalSkyFactor - 1) * worldLockBlend) * turbinesVisibleFactor;
      const bodyOpacity = obj.baseOpacity * globalFactor * turbinesVisibleFactor;
      // Grå/blå ton (produktkrav: "gray/blue tint" när verket visas dämpat
      // p.g.a. inomhus-heuristiken) — blandas alltid tillbaka mot
      // `originalColors` när `hideAll`/`forceVisible` inte längre gäller, så
      // färgen aldrig fastnar tonad. Tonings-ANDELEN skalas också med
      // `worldLockBlend` så tonen fasas in mjukt istället för att dyka upp
      // direkt när `hideAll` blir sant strax efter AR-start.
      const tintFraction =
        !occlusionDisabled && modeRef.current.hideAll && !obj.forceVisible ? INDOOR_TINT_BLEND * worldLockBlend : 0;
      for (let i = 0; i < obj.materials.length; i++) {
        const mat = obj.materials[i];
        mat.transparent = true;
        mat.opacity = bodyOpacity;
        mat.color.copy(obj.originalColors[i]);
        if (tintFraction > 0) {
          mat.color.lerp(INDOOR_TINT_COLOR, tintFraction);
        }
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
    // V32: cameraYawEuler (Euler-YXZ ur full camera-quat) borttagen — gav
    // systematiskt ~90–180° offset vs Heading eftersom Q1-rotationen (−90° X
    // för skärmplan) ingår i camera.quaternion. Optisk yaw beräknas nu från
    // (0,0,-1) transformerad med camera quaternion (se nedan).

    // Juli 2026-fix (kritisk buggrapport punkt 4: "logga avstånd/bäring/
    // cameraForward/isVisible/frustumVisible per verk för att kontrollera
    // om modellerna filtreras bort av frustum-culling"): återanvänd
    // frustum/vektor-instanser (samma prestandaresonemang som ovan).
    // `frustum` byggs om från kamerans faktiska projektions-/världsmatris
    // varje bildruta (INTE cachat), så `frustumVisible` alltid speglar
    // kamerans verkliga rotation just nu.
    const frustum = new THREE.Frustum();
    const frustumMatrix = new THREE.Matrix4();
    const cameraForward = new THREE.Vector3();
    let lastDiagnosticDumpAt = 0;

    let raf = 0;
    let lastTimestamp: number | null = null;

    // V20: fall-in animation — verken startar 180 Three.js-enheter (~200m) ovanför
    // slutpositionen och dal in med ease-out-cubic på 1.5 s.
    const FALL_DURATION_MS = 1500;
    const FALL_HEIGHT_UNITS = 180;
    const fallStartMs = performance.now();
    let landedReported = -1; // senast rapporterat antal, -1 = inget ännu

    function animate(timestamp: number) {
      raf = requestAnimationFrame(animate);
      lastFrameAtRef.current = Date.now();
      if (!firstRenderFrameLoggedRef.current) {
        firstRenderFrameLoggedRef.current = true;
        console.info("[AR][pipeline] Första renderFrame() kördes");
      }
      const state = sceneStateRef.current;
      if (!state) return;

      // V24: Skippa rendering tills första orientation-event kommit in.
      // heading=null = ingen sensor-data ännu → alla verk placeras mot
      // norr i första frame och "fastnar" synligt tills gyro-fix ger riktig heading.
      if (headingDegRef.current === null) return;

      const dt = lastTimestamp === null ? 0 : Math.min((timestamp - lastTimestamp) / 1000, 0.25);
      lastTimestamp = timestamp;

      // Juli 2026-fix ("pilen/verken fryser helt trots bra FPS/AR-
      // stabilitet"): placeringen räknades tidigare bara om när GPS-
      // positionen förflyttat sig märkbart eller ett visualiseringsläge
      // ändrats — en ren prestandaoptimering. Men om en refresh av
      // `userRef`/`modeRef` uteblir (t.ex. en overordnad state-uppdatering
      // som fastnar) frös verkens världsposition kvar helt, oavsett att
      // kamerarotationen (nedan) fortsatte uppdateras varje bildruta. Att
      // räkna om placeringen VARJE bildruta är enligt uttrycklig
      // produktbegäran — trigonometrin för 29 verk är för billig för att
      // motivera riskkant caching här; se `layoutObjects` för kostnaden.
      layoutObjects();

      // V20: fall-in animation — lägg till Y-offset som minskar från FALL_HEIGHT
      // till 0 under FALL_DURATION_MS. Körs EFTER layoutObjects() så den riktiga
      // världspositionen redan är satt och vi bara justerar uppåt tillfälligt.
      const fallElapsed = performance.now() - fallStartMs;
      if (fallElapsed < FALL_DURATION_MS) {
        const t = fallElapsed / FALL_DURATION_MS;
        const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
        const fallOffsetY = FALL_HEIGHT_UNITS * (1 - eased);
        const total = state.objects.length;
        for (const obj of state.objects) {
          obj.group.position.y += fallOffsetY;
        }
        const landedNow = Math.min(Math.floor(total * eased), total);
        if (landedNow !== landedReported) {
          landedReported = landedNow;
          onTurbineLandedRef.current?.(landedNow, total);
        }
      } else if (landedReported < state.objects.length) {
        // Animationen klar — rapportera att alla är på plats EN gång
        landedReported = state.objects.length;
        onTurbineLandedRef.current?.(state.objects.length, state.objects.length);
      }

      // V28: VISIBLE_RADIUS_M-filtret (3 km, satt i V22) borttaget —
      // rotorsak för "inga verk i vanlig AR". `renderDistM` är det VERKLIGA
      // GPS-avståndet (inte det komprimerade `planeDist`), och Länsterbergets
      // verk ligger 15–20 km från Katrineholm → alltid tooFar → group.visible=false.
      // Opaciteten (applyFinalOpacities / applyVisibility) och det komprimerade
      // planDist-systemet hanterar synlighet och storlek för avlägsna verk.
      for (const obj of state.objects) {
        obj.group.visible = true;
        obj.label.sprite.visible = true;
        obj.distanceLabel.sprite.visible = true;
      }

      // Kamerans riktning styrs av enhetens sensorer (gir/pitch/roll).
      // V18: Nollställ alltid roll (Z-axeln). Behåll yaw (Y) och pitch (X).
      // V25: Yaw-komponenten smoothas med EMA (ALPHA=0.35) för att dämpa
      // diskreta CoreMotion-hopp vid snabb rotation. Pitch/roll lämnas råa
      // (de är redan stabila och smoothing där orsakar horizon-drift).
      // V26: NaN-säker heading-smoothing (V25 hade NaN-bugg på första frame
      // eftersom smoothedYawDegRef.current=null → delta=NaN → permanent NaN).
      const HEADING_SMOOTHING_ALPHA = 0.35;
      const sensorEuler = new THREE.Euler().setFromQuaternion(quaternionRef.current, "YXZ");
      const rawYawDeg = ((sensorEuler.y * (180 / Math.PI)) % 360 + 360) % 360;
      // Helper: giltigt ändlikt tal i [0, 360)
      const isValidYaw = (v: unknown): v is number =>
        typeof v === "number" && Number.isFinite(v);
      if (isValidYaw(rawYawDeg)) {
        if (!isValidYaw(smoothedYawDegRef.current)) {
          // Första giltiga frame (eller recovery efter NaN) — initiera direkt
          smoothedYawDegRef.current = rawYawDeg;
        } else {
          // EMA med wrap-around-hantering (359° → 1° via 0°, inte via 358°)
          let delta = rawYawDeg - smoothedYawDegRef.current;
          if (delta > 180) delta -= 360;
          if (delta < -180) delta += 360;
          smoothedYawDegRef.current = ((smoothedYawDegRef.current + delta * HEADING_SMOOTHING_ALPHA) % 360 + 360) % 360;
          // Sanity-check: om smoothing producerade NaN, återgå till rå heading
          if (!isValidYaw(smoothedYawDegRef.current)) {
            smoothedYawDegRef.current = rawYawDeg;
          }
        }
      }
      // Använd smoothad heading om giltig, annars sensorns råa yaw som fallback
      const effectiveYawRad = isValidYaw(smoothedYawDegRef.current)
        ? (smoothedYawDegRef.current * Math.PI) / 180
        : sensorEuler.y;
      sensorEuler.y = effectiveYawRad;
      sensorEuler.z = 0; // nollställ roll
      // V27: Belt-and-suspenders NaN-guard — applicera INTE quaternion om
      // någon euler-axel är NaN/Infinity (kan hända vid sensorhardwarefel).
      // Om vi sätter en NaN-quaternion korrumperas Three.js-scenen permanent
      // (verken renderas 241 km bort). Behåll förra framens quaternion istället.
      const isValidNumber = (v: unknown): v is number =>
        typeof v === "number" && Number.isFinite(v);
      if (
        isValidNumber(sensorEuler.x) &&
        isValidNumber(sensorEuler.y) &&
        isValidNumber(sensorEuler.z)
      ) {
        // V36: Lagra i target-ref istället för att sätta kameran direkt —
        // kameran slerpar sedan mjukt mot detta värde nedan.
        cameraTargetQuatRef.current.setFromEuler(sensorEuler);
      } else if (typeof window !== "undefined" && !(window as unknown as Record<string, unknown>)["__nanGuardLogged"]) {
        console.warn("[ARScene] sensorEuler innehåller NaN/Infinity — hoppar över quaternion-set denna frame");
        (window as unknown as Record<string, unknown>)["__nanGuardLogged"] = true;
      }
      // V36: Mjuk kamera-slerp mot senaste giltiga sensor-kvaternion.
      // Tau=0.04s → ~120ms till 95% vid 60fps. Vid sensor-stall (sensorn
      // tystnar tillfälligt på iOS) snappar vi direkt till senaste kända
      // kvaternion så att sol/sprite inte fastnar på skärmen.
      {
        // V37: ännu snabbare kamerainterpolation så sol/sprite/verk följer
        // telefonrörelserna tätare.
        const CAMERA_SLERP_TAU = 0.03;
        const stalled = modeRef.current.orientationStalled;
        const slerpFactor = dt > 0 ? 1 - Math.exp(-dt / CAMERA_SLERP_TAU) : 1;
        state.camera.quaternion.slerp(cameraTargetQuatRef.current, stalled ? 1 : slerpFactor);
      }
      // Juli 2026-fix (TREDJE kritiska buggrapporten — trolig rotorsak):
      // `matrixWorldInverse` uppdateras normalt bara inuti
      // `WebGLRenderer.render()`, som körs i SLUTET av denna funktion. Utan
      // detta explicita anrop läste alltså `frustumMatrix`/`camSpaceVec`
      // nedan förra bildrutans kamerarotation (en bildruta "efter" — worst
      // case exakt den lagg som gör att "rakt fram"-vinkeltestet aldrig
      // stabiliserar sig kring 0° om enhetens sensorer levererar events i
      // en annan takt än rAF). `updateMatrixWorld()` på en kamera utan
      // förälder (`camera.parent === null`, vilket är fallet här) uppdaterar
      // BÅDE `matrixWorld` OCH `matrixWorldInverse` synkront, så alla
      // beräkningar nedan garanterat använder DENNA bildrutas riktiga
      // kameraorientering.
      state.camera.updateMatrixWorld(true);

      // Blinkande flyghinderljus styrs enbart av det manuella Nattläge-valet
      // (aldrig av den faktiska klockan eller av "Kväll"-visualiseringsläget).
      // Dagsläge ska alltid stänga av detta helt tills användaren ändrar det.
      const { nightMode: curNightMode } = modeRef.current;
      const night = curNightMode;
      const now = Date.now();

      // Juli 2026-fix (SJÄTTE kritiska buggrapporten, punkt 1 & 2): räknar
      // om "Direkt AR → World locked"-övertoningen varje bildruta från
      // `modeRef.current.arStartedAtMs` (satt EN gång i Home.tsx när
      // AR-sessionen blir synlig). `arStartedAtMs === null` betyder "redan
      // world-locked" (blend=1 direkt, bakåtkompatibelt). Sparas i
      // `worldLockBlendRef` så `applyFinalOpacities`/`attachOcclusionShader`s
      // uniform-uppdatering OCH `getDebugStats()` läser exakt samma tal.
      const arStartedAt = modeRef.current.arStartedAtMs;
      const worldLockBlend =
        arStartedAt == null ? 1 : Math.max(0, Math.min(1, (now - arStartedAt) / WORLD_LOCK_BLEND_MS));
      worldLockBlendRef.current = worldLockBlend;

      // "Visa/dölj verk"-togglen tonas mjukt över `TURBINES_VISIBLE_FADE_MS`
      // (0.5s) — en enkel linjär närmande-per-sekund, inte en threshold-
      // snap, så växlingen aldrig känns som ett hopp.
      const turbinesVisibleTarget = modeRef.current.turbinesVisible ? 1 : 0;
      const visibilityLerpStep = dt > 0 ? Math.min(dt / (TURBINES_VISIBLE_FADE_MS / 1000), 1) : 1;
      turbinesVisibleFactorRef.current +=
        (turbinesVisibleTarget - turbinesVisibleFactorRef.current) * visibilityLerpStep;
      if (Math.abs(turbinesVisibleFactorRef.current - turbinesVisibleTarget) < 0.002) {
        turbinesVisibleFactorRef.current = turbinesVisibleTarget;
      }

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
      const curMode = modeRef.current.sunMode;
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
      // Juli 2026-fix (TREDJE kritiska buggrapporten, punkt 3): `disableOcclusion`
      // forcerar `uShowHidden` till 1 precis som "Visa dolda verk", men som
      // en oberoende FELSÖKNINGS-överstyrning (oavsett vad den vanliga
      // produktinställningen `showHiddenTurbines` står på).
      const showHiddenValue = modeRef.current.showHiddenTurbines || modeRef.current.disableOcclusion ? 1 : 0;
      for (const shader of occlusionShaders) {
        shader.uniforms.uShowHidden.value = showHiddenValue;
        shader.uniforms.uWorldLockBlend.value = worldLockBlend;
      }

      // Juli 2026-fix (kritisk buggrapport punkt 4): kamerans faktiska
      // "titta framåt"-vektor och synlighetsfrustum, omräknade varje
      // bildruta från `state.camera`s FAKTISKA (sensorstyrda) matriser —
      // används enbart för felsökningsloggningen nedan, aldrig för att
      // fatta några synlighetsbeslut (det gör redan `angleFromOpticalAxisDeg`/
      // `applyFinalOpacities`), så loggningen kan aldrig i sig påverka vad
      // som faktiskt renderas.
      cameraForward.set(0, 0, -1).applyQuaternion(state.camera.quaternion);
      cameraForwardYRef.current = cameraForward.y;
      frustumMatrix.multiplyMatrices(state.camera.projectionMatrix, state.camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(frustumMatrix);

      // Nollställs varje bildruta, se `inFrontOfCameraCountRef`.
      let inFrontOfCameraCount = 0;
      let visibleCountThisFrame = 0;
      // Juli 2026-fix (TREDJE kritiska buggrapporten, punkt 2): utökad
      // per-verk-diagnostik med precis de fält felrapporten efterfrågade
      // (GPS, ENU-koordinater, bäring, pitch, avstånd, InFrustum, Occluded,
      // Visible, ScreenX/ScreenY) — inga nya beräkningar utöver vad som
      // redan görs i loopen nedan, bara insamling.
      const diagnosticRows: Array<{
        namn: string;
        lat: number;
        lon: number;
        enu_x: number;
        enu_y: number;
        enu_z: number;
        avstånd_m: number;
        bäring_deg: number;
        pitch_deg: number | null;
        inFrustum: boolean;
        occluded: boolean;
        isVisible: boolean;
        screenX: number | null;
        screenY: number | null;
        relativeAngle_deg: number | null;
        forceVisible: boolean;
      }> = [];

      // V32: "Camera yaw" = optisk axel i världen. Euler-Y ur full
      // camera-quat (Q1 −90° X + skärm) gav ofta ~90–180° fel vs Heading
      // trots att AR-scenen följde sensorn. Optisk yaw från (0,0,-1)
      // applyQuaternion är samma konvention som cameraForward/synlighetslogik.
      const cameraForwardForYaw = new THREE.Vector3(0, 0, -1).applyQuaternion(
        state.camera.quaternion,
      );
      const cameraYawDeg =
        ((Math.atan2(cameraForwardForYaw.x, -cameraForwardForYaw.z) * 180) /
          Math.PI +
          360) %
        360;

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
        // V35/Fix1: viewPresence (0..1) — mjuk fade från FOV-kant till
        // FORCE_FADE_OUT_DEG. Stoppar "fastklistrade" verk utanför kamerans
        // synfält.
        let viewPresence = 0;
        if (angleFromOpticalAxisDeg !== null) {
          if (angleFromOpticalAxisDeg <= IN_VIEW_HALF_ANGLE_DEG) {
            viewPresence = 1;
          } else if (angleFromOpticalAxisDeg >= FORCE_FADE_OUT_DEG) {
            viewPresence = 0;
          } else {
            viewPresence =
              1 -
              (angleFromOpticalAxisDeg - IN_VIEW_HALF_ANGLE_DEG) /
                (FORCE_FADE_OUT_DEG - IN_VIEW_HALF_ANGLE_DEG);
          }
        }
        obj.viewPresence = viewPresence;
        const isSafetyForced = modeRef.current.forceVisibleIds.has(obj.turbine.id);
        obj.forceVisible =
          (nearCenter && obj.renderDistM <= MAX_RENDER_DISTANCE_M) || isSafetyForced;
        // V29: Bypass Three.js frustum culling när forceVisible är sant.
        // V40: safety-forced ritas alltid, oavsett presence/worldLockBlend.
        const forceDraw =
          obj.forceVisible &&
          (isSafetyForced || viewPresence > 0.02 || worldLockBlendRef.current < 1);
        for (const mesh of obj.cachedMeshes) {
          mesh.frustumCulled = !forceDraw;
        }
        // V34/C2a: Skalboost för force-visible verk långt bort — säkerställer
        // att de syns som mer än enstaka pixlar trots 3–14 km avstånd.
        // Boost: 1× vid <2 km, linjärt upp till 3× vid ≥6 km.
        if (obj.forceVisible && obj.renderDistM > 2000) {
          const boost = Math.min(3, obj.renderDistM / 2000);
          obj.group.scale.setScalar(obj.scaleDamp * boost);
        } else if (!obj.forceVisible) {
          // Återställ till originalskalan om forceVisible precis stängts av.
          obj.group.scale.setScalar(obj.scaleDamp);
        }
        // V39: lås lampan på verkets totalhöjd (bladspets) så den följer
        // gruppens aktuella skala/pos (forceVisible-boost + fall-in).
        {
          const s = obj.group.scale.x;
          const lightLocalY =
            (obj.turbine.heightMeters + LIGHT_TOP_OFFSET_M) * METERS_TO_UNITS;
          const lightY = obj.group.position.y + lightLocalY * s;
          obj.light.position.set(obj.group.position.x, lightY, obj.group.position.z);
          obj.glow.position.set(obj.group.position.x, lightY, obj.group.position.z);
          obj.light.scale.setScalar(Math.max(6 * s, 16));
          obj.glow.scale.setScalar(Math.max(26 * s, 70));
        }
        if (
          angleFromOpticalAxisDeg !== null &&
          angleFromOpticalAxisDeg <= IN_VIEW_HALF_ANGLE_DEG &&
          obj.renderDistM <= MAX_RENDER_DISTANCE_M
        ) {
          inFrontOfCameraCount++;
        }

        let skyTarget = obj.skyFactor;
        let screenX: number | null = null;
        let screenY: number | null = null;
        if (inFrontOfCamera) {
          ndcVec.copy(obj.light.position).project(state.camera);
          const u = (ndcVec.x + 1) / 2;
          const v = (1 - ndcVec.y) / 2;
          skyTarget = u >= 0 && u <= 1 && v >= 0 && v <= 1 ? (currentIsPointSky(u, v) ? 1 : 0) : obj.skyFactor;
          // Juli 2026-fix (TREDJE kritiska buggrapporten, punkt 2):
          // ScreenX/ScreenY i faktiska pixlar (canvasens klientstorlek),
          // beräknat från samma NDC-projektion som redan görs ovan för
          // himmelsmasken — ingen extra `project()`-kostnad.
          const canvasEl = state.renderer.domElement;
          screenX = Math.round(u * canvasEl.clientWidth);
          screenY = Math.round(v * canvasEl.clientHeight);
        } else {
          skyTarget = 0; // bakom kameran
        }
        obj.skyFactor += (skyTarget - obj.skyFactor) * skyLerpRate;
        applyFinalOpacities(obj);

        // Juli 2026-fix (kritisk buggrapport punkt 1 & 4): `isVisible` läser
        // den FAKTISKA opaciteten som just skrevs till materialet ovan (inte
        // en separat, egen beräkning som skulle kunna divergera från vad som
        // verkligen ritas) — och `frustumVisible` testar verkets faktiska
        // världsposition mot kamerans riktiga frustum. Om `isVisible` är
        // sant men `frustumVisible` falskt (eller tvärtom) pekar det direkt
        // ut ROTORSAKEN till "verk renderas inte": antingen döljs det av
        // opacitet/ocklusion trots att det ligger i bild, eller så ligger
        // det utanför kamerans synfält trots att opaciteten är hög.
        const currentOpacity = obj.materials[0]?.opacity ?? 0;
        const isVisible = currentOpacity > 0.02;
        const frustumVisible = frustum.containsPoint(obj.group.position);
        // Juli 2026-fix (TREDJE kritiska buggrapporten, punkt 2): "Occluded"
        // = verket är i bild (framför kameran) men himmelsmasken bedömer att
        // det INTE projiceras mot himmel just nu (`obj.skyFactor` lågt) —
        // dvs. exakt vad som gör att det tonas bort trots frisk GPS/kompass.
        const occluded = inFrontOfCamera && obj.skyFactor < 0.5;
        // Juli 2026-fix (TREDJE kritiska buggrapporten, punkt 2): pitch =
        // vertikal vinkel (grader) mellan navhöjdspunkten och kamerans
        // optiska axel i kamerarymden — positivt värde betyder att verket
        // ligger ovanför skärmens mittlinje.
        const pitchDeg =
          camSpaceDist > 0 ? (Math.atan2(-camSpaceVec.y, -camSpaceVec.z) * 180) / Math.PI : null;
        if (isVisible) visibleCountThisFrame++;
        if (isVisible && !obj.loggedVisible) {
          obj.loggedVisible = true;
          console.info(
            `[AR] Modell synlig (${obj.turbine.name}, opacitet=${currentOpacity.toFixed(2)}, avstånd=${obj.renderDistM.toFixed(0)}m, frustumVisible=${frustumVisible})`,
          );
        }
        diagnosticRows.push({
          namn: obj.turbine.name,
          lat: Number(obj.lat.toFixed(5)),
          lon: Number(obj.lon.toFixed(5)),
          enu_x: Number(obj.group.position.x.toFixed(1)),
          enu_y: Number(obj.group.position.y.toFixed(1)),
          enu_z: Number(obj.group.position.z.toFixed(1)),
          avstånd_m: Math.round(obj.renderDistM),
          bäring_deg: Math.round(obj.lastBearingDeg),
          pitch_deg: pitchDeg !== null ? Math.round(pitchDeg * 10) / 10 : null,
          inFrustum: frustumVisible,
          occluded,
          isVisible,
          screenX,
          screenY,
          relativeAngle_deg: angleFromOpticalAxisDeg !== null ? Math.round(angleFromOpticalAxisDeg * 10) / 10 : null,
          forceVisible: obj.forceVisible,
        });

        const phase = (now + obj.blinkOffsetMs) % obj.blinkPeriodMs;
        const blinkOn = night && phase < obj.blinkOnMs;
        obj.light.visible = blinkOn;
        obj.glow.visible = blinkOn;

        // V35/Fix1: Skuggans globalFactor följer presence längs force-banan.
        const shadowGlobalFactor = obj.forceVisible
          ? (modeRef.current.forceVisibleIds.has(obj.turbine.id)
              ? 1
              : Math.min(1, Math.max(0, obj.viewPresence)))
          : modeRef.current.hideAll
            ? INDOOR_DIM_FACTOR
            : Math.max(modeRef.current.globalVisibilityFactor, MIN_CONFIDENCE_VISIBILITY_FACTOR);
        const shadowSkyFactor = obj.skyFactor * shadowGlobalFactor;
        if (flickerActive && obj.shadow.visible) {
          const flicker = 0.55 + 0.45 * Math.cos(obj.bladesGroup.rotation.z * 3);
          obj.shadowMaterial.opacity = obj.shadowBaseOpacity * shadowSkyFactor * flicker;
        } else {
          obj.shadowMaterial.opacity = obj.shadowBaseOpacity * shadowSkyFactor;
        }
      }

      inFrontOfCameraCountRef.current = inFrontOfCameraCount;
      // Juli 2026-fix (SJÄTTE kritiska buggrapporten, punkt 4): den FAKTISKA
      // opacitetsbaserade räkningen (`visibleCountThisFrame`, `isVisible =
      // currentOpacity > 0.02` ovan i denna loop) — till skillnad från
      // `inFrontOfCameraCountRef` (vinkel-/FOV-baserad, blind för faktisk
      // opacitet) — exponeras separat för produktkravets "Synliga verk:
      // antal"-felsökningsfält.
      trueVisibleTurbineCountRef.current = visibleCountThisFrame;

      // Juli 2026-fix (kritisk buggrapport punkt 1 & 4): dumpa en
      // per-verk-diagnostiktabell var 3:e sekund — ALLTID (inte bara på
      // fel), men extra viktigt när `visibleCountThisFrame === 0` trots att
      // `state.objects.length > 0`, eftersom det är exakt symptomet i
      // felrapporten ("verk renderas inte trots frisk GPS/kompass/AR-
      // stabilitet"). `cameraForward` visar vart kameran FAKTISKT pekar
      // just nu (efter gir+pitch+roll), så man kan se om avsaknad av
      // synliga verk beror på att användaren pekar åt fel håll eller på ett
      // faktiskt renderingsfel.
      if (timestamp - lastDiagnosticDumpAt >= 3000 && state.objects.length > 0) {
        lastDiagnosticDumpAt = timestamp;
        const headingForLog = headingDegRef.current;
        console.info(
          `[AR][diagnostik] ${visibleCountThisFrame}/${state.objects.length} verk synliga denna bildruta. Heading=${headingForLog === null ? "–" : headingForLog.toFixed(1) + "°"} Camera yaw=${cameraYawDeg.toFixed(1)}° cameraForward=(${cameraForward.x.toFixed(2)}, ${cameraForward.y.toFixed(2)}, ${cameraForward.z.toFixed(2)})`,
        );
        console.table(diagnosticRows);
        // V34/C2b: Enstaka rad för närmaste verk — direkt läsbar i iPhone-logg.
        if (diagnosticRows.length > 0) {
          const nr = diagnosticRows.reduce((a, b) => (a.avstånd_m <= b.avstånd_m ? a : b));
          console.info(
            `[AR][v34] nearest=${nr.namn} dist=${nr.avstånd_m}m` +
            ` ang=${nr.relativeAngle_deg ?? "?"}°` +
            ` scr=(${nr.screenX ?? "?"},${nr.screenY ?? "?"})` +
            ` force=${nr.forceVisible ? 1 : 0}` +
            ` frust=${nr.inFrustum ? 1 : 0}` +
            ` vis=${nr.isVisible ? 1 : 0}` +
            ` camFwdY=${cameraForwardYRef.current.toFixed(2)}`,
          );
        }
      }

      // FPS mäts över ett rullande ~500ms-fönster (inte ett enskilt dt) för
      // en stabil, läsbar siffra i felsökningstexten istället för att
      // studsa bildruta för bildruta.
      frameCountRef.current += 1;
      fpsWindowFramesRef.current += 1;
      if (fpsWindowStartRef.current === null) {
        fpsWindowStartRef.current = timestamp;
      } else if (timestamp - fpsWindowStartRef.current >= 500) {
        fpsRef.current = Math.round((fpsWindowFramesRef.current * 1000) / (timestamp - fpsWindowStartRef.current));
        fpsWindowStartRef.current = timestamp;
        fpsWindowFramesRef.current = 0;
      }

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

    // Sjunde kritiska buggrapporten (punkt 2, "väcks bara av en
    // skärmdump"): tidigare initierades `lastFrameAtRef` till `null` och
    // sattes bara INIFRÅN `animate` självt (rad ~1381 ovan) — så OM webbläsaren
    // av någon anledning aldrig levererar den allra första rAF-callbacken
    // (t.ex. en flik som öppnas i bakgrunden), stod `lastAt === null` kvar
    // för alltid och vakthunden nedan (som explicit `return`:ar på `null`)
    // fick ALDRIG en chans att upptäcka eller åtgärda det — precis det
    // "tyst fastnad tills något (t.ex. en skärmdump) råkar väcka fliken"-
    // beteendet som rapporterades. Genom att sätta ett tidsstämpel HÄR,
    // innan den första `requestAnimationFrame`-anropet överhuvudtaget görs,
    // har vakthunden alltid ett konkret värde att jämföra mot och kan
    // riva/återskapa loopen inom sitt vanliga 500ms-fönster även om
    // `animate` aldrig hunnit köras en enda gång.
    lastFrameAtRef.current = Date.now();
    console.info("[AR][pipeline] startAR(): render-loop initierad, väntar på första renderFrame()");
    raf = requestAnimationFrame(animate);
    // Exponera en loop-omstarts-callback till `visible`-effekten ovan (som
    // inte kan komma åt de lokala `raf`/`animate`-variablerna direkt).
    // Täcker fallet "appen gick till bakgrunden → rAF pausades → vyn öppnades
    // igen innan watchdog-intervallet hann starta om loopen".
    restartRafRef.current = () => {
      cancelAnimationFrame(raf);
      lastFrameAtRef.current = Date.now();
      raf = requestAnimationFrame(animate);
    };

    // Juli 2026-fix ("pilen/verken fryser helt trots bra FPS/AR-
    // stabilitet"): en fristående (rAF-oberoende) vakthund som upptäcker om
    // render-loopen självt har fastnat — t.ex. om `animate` kastar ett fel
    // eller webbläsaren av någon anledning slutar leverera rAF-callbacks —
    // vilket varken FPS-siffran (som bara mäts INIFRÅN loopen och därför
    // fryser kvar på sitt senaste goda värde) eller `useArTrackingStability`
    // (som mäter sensordata, inte renderingen) kan upptäcka på egen hand.
    // `setInterval` körs oberoende av rAF och kan därför både upptäcka
    // stillastående och starta om loopen.
    const renderLoopWatchdog = window.setInterval(() => {
      const lastAt = lastFrameAtRef.current;
      if (lastAt === null) return;
      const stalled = Date.now() - lastAt > 500;
      renderLoopStalledRef.current = stalled;
      if (stalled) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(animate);
      }
    }, 250);

    function handleResize() {
      if (!mount) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    }
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(renderLoopWatchdog);
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
      // Juli 2026-fix (TREDJE kritiska buggrapporten, punkt 1): städa upp
      // felsökningsmarkörens geometrier/material precis som alla andra
      // scenobjekt ovan, annars läcker en `THREE.BufferGeometry` +
      // material + canvas-etikett-textur varje gång komponenten monteras om.
      const debugMarker = debugMarkerRef.current;
      if (debugMarker) {
        debugMarker.lineGeo.dispose();
        (debugMarker.line.material as THREE.Material).dispose();
        debugMarker.sphere.geometry.dispose();
        (debugMarker.sphere.material as THREE.Material).dispose();
        debugMarker.label.texture.dispose();
        (debugMarker.label.sprite.material as THREE.SpriteMaterial).dispose();
        debugMarkerRef.current = null;
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
      // B2: Om simulerad tid anges, bygg ett Date med den timmen men dagens datum.
      const simHour = modeRef.current.simTimeHour;
      let sunDate: Date;
      if (simHour != null) {
        sunDate = new Date();
        sunDate.setHours(simHour, 0, 0, 0);
      } else {
        sunDate = new Date();
      }
      return getCurrentSunPosition(sunDate, lat, lon);
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
