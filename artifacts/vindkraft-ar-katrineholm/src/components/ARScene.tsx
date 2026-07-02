import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { bearingDegrees, distanceMeters, formatDistance } from "@/lib/geo";
import type { TurbineSweref } from "@/lib/turbines";
import { swerefToWgs84 } from "@/lib/sweref";
import { getCurrentSunPosition } from "@/lib/sunPosition";
import { getBladeRpm, getBladeStartAngleRad, getBlinkOffsetMs, getBlinkPeriodMs, BLINK_ON_MS } from "@/lib/turbineAnimation";
import { shadowFlickerActive, type SunMode, type VisibilityLevel } from "@/lib/visualizationTypes";

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
}

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
  scaleDamp: number;
  bladeRadPerSec: number;
  blinkPeriodMs: number;
  blinkOnMs: number;
  blinkOffsetMs: number;
  renderDistM: number;
}

interface CanvasLabel {
  sprite: THREE.Sprite;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
}

const FOV_DEGREES = 65;
const MAX_RENDER_DISTANCE_M = 9000;
// Meter -> scenens enheter. Vald så att den visuella storleken/avstånden
// matchar kamerans FOV/klippplan (samma skala som tidigare, enklare modell).
const METERS_TO_UNITS = 0.9;

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
  const modeRef = useRef({ sunMode, realScale, visibility, nightMode, shadowFlicker });
  // Väntande Fotomontage-förfrågan — löses in synkront direkt efter nästa
  // renderade bildruta i animationsloopen (se `animate`), istället för att
  // sätta `preserveDrawingBuffer: true` på renderaren. Att läsa canvasen i
  // samma JS-cykel som `renderer.render()` fungerar utan preserveDrawingBuffer
  // (webbläsaren hinner inte rensa/kompositera bufferten emellan), och
  // undviker den extra GPU-minnesbelastning som tidigare kunde göra att hela
  // kameravyn plötsligt försvann bakom en ogenomskinlig canvas (förlorad
  // WebGL-kontext).
  const pendingCaptureRef = useRef<((dataUrl: string | null) => void) | null>(null);

  userRef.current = { lat: userLat, lon: userLon };
  modeRef.current = { sunMode, realScale, visibility, nightMode, shadowFlicker };

  useImperativeHandle(forwardedRef, () => ({
    capturePhoto: () =>
      new Promise<string | null>((resolve) => {
        if (!sceneStateRef.current) {
          resolve(null);
          return;
        }
        pendingCaptureRef.current = resolve;
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
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
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

    const objects: TurbineObject[] = turbines.map((turbine) => {
      const { lat, lon } = swerefToWgs84(turbine.easting, turbine.northing);
      const { group, bladesGroup, materials } = buildTurbineMesh(turbine);
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
        scaleDamp: 1,
        bladeRadPerSec,
        blinkPeriodMs,
        blinkOnMs: BLINK_ON_MS,
        blinkOffsetMs,
        renderDistM: 0,
      };
    });

    sceneStateRef.current = { scene, camera, renderer, objects, ambient, sunLight, sunSprite, sunGlow };

    // Placera varje verk i en fast världsposition utifrån bäring/avstånd.
    // Körs initialt samt varje gång användarens GPS-position uppdateras
    // (i animationsloopen, men bara när koordinaterna faktiskt ändrats) —
    // annars behöver inte positionerna räknas om varje bildruta.
    function layoutObjects() {
      const { lat: uLat, lon: uLon } = userRef.current;
      for (const obj of sceneStateRef.current!.objects) {
        const dist = distanceMeters(uLat, uLon, obj.lat, obj.lon);
        const bearing = bearingDegrees(uLat, uLon, obj.lat, obj.lon);
        const bearingRad = (bearing * Math.PI) / 180;

        const renderDist = Math.min(dist, MAX_RENDER_DISTANCE_M);
        const { realScale: useRealScale } = modeRef.current;
        const scaleDamp = useRealScale
          ? 1 - Math.min(renderDist / MAX_RENDER_DISTANCE_M, 1) * 0.85
          : 1 - Math.min(renderDist / MAX_RENDER_DISTANCE_M, 1) * 0.55;
        const planeDist = 400 + renderDist * 0.12;

        const x = Math.sin(bearingRad) * planeDist;
        const z = -Math.cos(bearingRad) * planeDist;
        const y = -8;

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

    function applyVisibility(obj: TurbineObject, distM: number) {
      const { visibility: vis } = modeRef.current;
      const opacity = opacityForVisibility(vis, distM);
      for (const mat of obj.materials) {
        mat.transparent = opacity < 1;
        mat.opacity = opacity;
      }
      const shadowBaseOpacity = 0.85;
      obj.shadowBaseOpacity = shadowBaseOpacity * opacity;
      obj.shadowMaterial.opacity = obj.shadowBaseOpacity;
    }

    layoutObjects();

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
      for (const obj of state.objects) {
        obj.bladesGroup.rotation.z += obj.bladeRadPerSec * dt;
        const phase = (now + obj.blinkOffsetMs) % obj.blinkPeriodMs;
        const blinkOn = night && phase < obj.blinkOnMs;
        obj.light.visible = blinkOn;
        obj.glow.visible = blinkOn;

        if (flickerActive && obj.shadow.visible) {
          const flicker = 0.55 + 0.45 * Math.cos(obj.bladesGroup.rotation.z * 3);
          obj.shadowMaterial.opacity = obj.shadowBaseOpacity * flicker;
        } else if (obj.shadowMaterial.opacity !== obj.shadowBaseOpacity) {
          obj.shadowMaterial.opacity = obj.shadowBaseOpacity;
        }
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

  return <div ref={mountRef} className="absolute inset-0" />;
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
