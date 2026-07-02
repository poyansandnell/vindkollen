import { useEffect, useRef } from "react";
import * as THREE from "three";
import { bearingDegrees, distanceMeters, formatDistance, isNightTime } from "@/lib/geo";
import type { TurbineSweref } from "@/lib/turbines";
import { swerefToWgs84 } from "@/lib/sweref";

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
  scaleDamp: number;
}

interface CanvasLabel {
  sprite: THREE.Sprite;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
}

const FOV_DEGREES = 65;
const MAX_RENDER_DISTANCE_M = 9000;
// Ungefärlig rotationshastighet för stora vindkraftverk (grader/sekund) —
// motsvarar ca 4 varv per minut, sakta och realistiskt.
const BLADE_DEG_PER_SEC = 24;

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

  ctx.fillStyle = "rgba(9, 20, 28, 0.72)";
  ctx.strokeStyle = "rgba(120, 220, 200, 0.55)";
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

  ctx.fillStyle = "#eafff7";
  ctx.font = "600 40px Inter, sans-serif";
  ctx.fillText(title, canvas.width / 2, canvas.height / 2 - 20);

  ctx.fillStyle = "#9be8d4";
  ctx.font = "400 30px Inter, sans-serif";
  ctx.fillText(subtitle, canvas.width / 2, canvas.height / 2 + 24);

  label.texture.needsUpdate = true;
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

    const objects: TurbineObject[] = turbines.map((turbine) => {
      const { lat, lon } = swerefToWgs84(turbine.easting, turbine.northing);
      const { group, bladesGroup } = buildTurbineMesh(turbine.heightMeters);
      scene.add(group);
      const label = createCanvasLabel();
      label.sprite.scale.set(34, 8.5, 1);
      scene.add(label.sprite);
      const distanceLabel = createCanvasLabel();
      distanceLabel.sprite.scale.set(24, 6, 1);
      scene.add(distanceLabel.sprite);

      const lightGeo = new THREE.CircleGeometry(1, 16);
      const lightMat = new THREE.SpriteMaterial({ color: 0xff2a2a, transparent: true, depthTest: false });
      const light = new THREE.Sprite(lightMat);
      light.renderOrder = 998;
      lightGeo.dispose();
      scene.add(light);

      return { turbine, lat, lon, group, bladesGroup, label, distanceLabel, light, scaleDamp: 1 };
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

        const labelHeight = obj.turbine.heightMeters * scaleDamp * 0.42 - 8;
        obj.label.sprite.position.set(x, y + labelHeight + 34 * scaleDamp, z);
        obj.label.sprite.scale.set(34 * scaleDamp, 8.5 * scaleDamp, 1);
        obj.distanceLabel.sprite.position.set(x, y + labelHeight + 22 * scaleDamp, z);
        obj.distanceLabel.sprite.scale.set(24 * scaleDamp, 6 * scaleDamp, 1);
        obj.light.position.set(x, y + obj.turbine.heightMeters * scaleDamp * 0.86, z);
        obj.light.scale.setScalar(6 * scaleDamp);

        drawLabel(obj.label, obj.turbine.name, "");
        drawLabel(obj.distanceLabel, formatDistance(dist), "");
      }
    }
    layoutObjects();

    let raf = 0;
    let blinkPhase = 0;
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

      blinkPhase += dt * 3.2;
      const blinkOn = isNightTime() && Math.sin(blinkPhase) > 0.75;

      const bladeDelta = THREE.MathUtils.degToRad(BLADE_DEG_PER_SEC) * dt;

      for (const obj of state.objects) {
        obj.bladesGroup.rotation.z += bladeDelta;
        obj.light.visible = blinkOn;
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
      for (const obj of objects) {
        obj.group.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
            else child.material.dispose();
          }
        });
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

function buildTurbineMesh(heightMeters: number): { group: THREE.Group; bladesGroup: THREE.Group } {
  const group = new THREE.Group();
  const scale = heightMeters / 100;

  const towerGeo = new THREE.CylinderGeometry(1.2 * scale, 2.2 * scale, 70 * scale, 10);
  const towerMat = new THREE.MeshStandardMaterial({ color: 0xe9edf0, roughness: 0.6 });
  const tower = new THREE.Mesh(towerGeo, towerMat);
  tower.position.y = 35 * scale;
  group.add(tower);

  const nacelleGeo = new THREE.BoxGeometry(9 * scale, 4 * scale, 4 * scale);
  const nacelleMat = new THREE.MeshStandardMaterial({ color: 0xd7dde0, roughness: 0.5 });
  const nacelle = new THREE.Mesh(nacelleGeo, nacelleMat);
  nacelle.position.y = 70 * scale;
  group.add(nacelle);

  const hubGeo = new THREE.SphereGeometry(2 * scale, 12, 12);
  const hub = new THREE.Mesh(hubGeo, nacelleMat);
  hub.position.set(5 * scale, 70 * scale, 0);
  group.add(hub);

  const bladeGeo = new THREE.BoxGeometry(1.4 * scale, 40 * scale, 0.6 * scale);
  bladeGeo.translate(0, 20 * scale, 0);
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xf5f7f8, roughness: 0.4 });

  // bladesGroup roterar kontinuerligt runt sin lokala Z-axel för att
  // simulera rotorbladens rörelse. Den ligger inuti "rotor" som bara ger
  // den fasta orienteringen (vriden 90° för att peka framåt).
  const bladesGroup = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    blade.rotation.z = (i * Math.PI * 2) / 3;
    bladesGroup.add(blade);
  }

  const rotor = new THREE.Group();
  rotor.add(bladesGroup);
  rotor.position.set(5 * scale, 70 * scale, 0);
  rotor.rotation.x = Math.PI / 2;
  group.add(rotor);

  return { group, bladesGroup };
}
