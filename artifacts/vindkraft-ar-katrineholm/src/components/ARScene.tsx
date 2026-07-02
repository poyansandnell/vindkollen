import { useEffect, useRef } from "react";
import * as THREE from "three";
import { bearingDegrees, distanceMeters, formatDistance, isNightTime } from "@/lib/geo";
import type { TurbineSweref } from "@/lib/turbines";
import { swerefToWgs84 } from "@/lib/sweref";
import { hashSeed } from "@/lib/prng";

interface ARSceneProps {
  userLat: number;
  userLon: number;
  quaternionRef: React.MutableRefObject<THREE.Quaternion>;
  turbines: TurbineSweref[];
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
  scaleDamp: number;
  bladeRadPerSec: number;
  blinkPeriodMs: number;
  blinkOnMs: number;
  blinkOffsetMs: number;
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
// Rotorns hastighet — 6–14 varv/minut, olika för varje verk (deterministiskt
// baserat på verkets namn) så att de inte alla snurrar exakt lika snabbt.
const BLADE_RPM_MIN = 6;
const BLADE_RPM_MAX = 14;
// Flyghinderbelysningen blinkar ungefär var 1:a sekund, men INTE synkront —
// varje verk har en egen liten periodvariation och fasförskjutning
// (deterministiskt baserat på namnet) så blinkningen känns naturlig.
const BLINK_PERIOD_MIN_MS = 900;
const BLINK_PERIOD_MAX_MS = 1150;
const BLINK_ON_MS = 150;

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

  // pill background
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

/**
 * AR-vy: renderar Three.js-objekt ovanpå kameraströmmen. Varje vindkraftverk
 * placeras EN gång i en fast världsposition utifrån bäring (från norr) och
 * avstånd relativt användarens GPS-position. Själva kameran roteras varje
 * bildruta utifrån enhetens fullständiga orientering (gir, pitch och roll)
 * — precis som en riktig kamera — vilket gör att verken upplevs som fast
 * förankrade i verkligheten/horisonten när telefonen tiltas, istället för
 * att följa skärmen. Detta är en enkel men robust "AR utan markörer"-teknik
 * som inte kräver WebXR (brett webbläsarstöd).
 */
export function ARScene({ userLat, userLon, quaternionRef, turbines }: ARSceneProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneStateRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    objects: TurbineObject[];
  } | null>(null);
  const userRef = useRef({ lat: userLat, lon: userLon });

  userRef.current = { lat: userLat, lon: userLon };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV_DEGREES, mount.clientWidth / mount.clientHeight, 1, 20000);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 1.1);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 0.6);
    sun.position.set(5, 10, 5);
    scene.add(sun);

    const glowTexture = createGlowTexture();

    const objects: TurbineObject[] = turbines.map((turbine) => {
      const { lat, lon } = swerefToWgs84(turbine.easting, turbine.northing);
      const { group, bladesGroup } = buildTurbineMesh(turbine);
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

      // Deterministisk men olikartad rotorhastighet och blinkfas per verk,
      // baserad på verkets namn — samma verk får alltid samma värden, men
      // olika verk skiljer sig åt (ingen global synkronisering).
      const rpm = BLADE_RPM_MIN + hashSeed(`${turbine.name}:rpm`) * (BLADE_RPM_MAX - BLADE_RPM_MIN);
      const bladeRadPerSec = (rpm * Math.PI * 2) / 60;
      const blinkPeriodMs =
        BLINK_PERIOD_MIN_MS + hashSeed(`${turbine.name}:period`) * (BLINK_PERIOD_MAX_MS - BLINK_PERIOD_MIN_MS);
      const blinkOffsetMs = hashSeed(`${turbine.name}:phase`) * blinkPeriodMs;

      // Varje rotor startar med en egen, stabil bladvinkel istället för att
      // alla 29 verk pekar likadant vid start.
      bladesGroup.rotation.z = hashSeed(`${turbine.name}:startAngle`) * Math.PI * 2;

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
        scaleDamp: 1,
        bladeRadPerSec,
        blinkPeriodMs,
        blinkOnMs: BLINK_ON_MS,
        blinkOffsetMs,
      };
    });

    sceneStateRef.current = { scene, camera, renderer, objects };

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
        const scaleDamp = 1 - Math.min(renderDist / MAX_RENDER_DISTANCE_M, 1) * 0.55;
        const planeDist = 400 + renderDist * 0.12;

        const x = Math.sin(bearingRad) * planeDist;
        const z = -Math.cos(bearingRad) * planeDist;
        const y = -8;

        obj.group.position.set(x, y, z);
        obj.group.scale.setScalar(scaleDamp);
        obj.group.lookAt(0, y, 0);
        obj.scaleDamp = scaleDamp;

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
      }
    }
    layoutObjects();

    let raf = 0;
    let lastLayoutLat = userRef.current.lat;
    let lastLayoutLon = userRef.current.lon;
    let lastTimestamp: number | null = null;

    function animate(timestamp: number) {
      raf = requestAnimationFrame(animate);
      const state = sceneStateRef.current;
      if (!state) return;

      const dt = lastTimestamp === null ? 0 : Math.min((timestamp - lastTimestamp) / 1000, 0.25);
      lastTimestamp = timestamp;

      // Räkna bara om placeringen när GPS-positionen faktiskt förflyttat sig
      // märkbart, istället för varje bildruta — sparar prestanda.
      const { lat: uLat, lon: uLon } = userRef.current;
      if (Math.abs(uLat - lastLayoutLat) > 1e-6 || Math.abs(uLon - lastLayoutLon) > 1e-6) {
        lastLayoutLat = uLat;
        lastLayoutLon = uLon;
        layoutObjects();
      }

      // Kamerans riktning styrs helt av enhetens sensorer (gir/pitch/roll),
      // så att verken förblir fast förankrade i verkligheten/horisonten
      // istället för att följa skärmen när telefonen tiltas.
      state.camera.quaternion.copy(quaternionRef.current);

      // Varje verk blinkar oberoende av de andra: egen periodlängd + egen
      // fasförskjutning (satt en gång per verk ovan), baserat på väggklockan
      // så mönstret är stabilt oavsett bildfrekvens — men INTE synkront
      // mellan verken, precis som riktiga flyghinderljus i ett vindkraftpark.
      const night = isNightTime();
      const now = Date.now();

      for (const obj of state.objects) {
        obj.bladesGroup.rotation.z += obj.bladeRadPerSec * dt;
        const phase = (now + obj.blinkOffsetMs) % obj.blinkPeriodMs;
        const blinkOn = night && phase < obj.blinkOnMs;
        obj.light.visible = blinkOn;
        obj.glow.visible = blinkOn;
      }

      state.renderer.render(state.scene, state.camera);
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
      glowTexture.dispose();
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
        obj.label.texture.dispose();
        obj.distanceLabel.texture.dispose();
      }
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turbines]);

  return <div ref={mountRef} className="absolute inset-0" />;
}

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
function buildTurbineMesh(turbine: TurbineSweref): { group: THREE.Group; bladesGroup: THREE.Group } {
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

  return { group, bladesGroup };
}
