import { useEffect, useRef } from "react";
import * as THREE from "three";
import { bearingDegrees, distanceMeters, formatDistance, isNightTime, normalizeAngle } from "@/lib/geo";
import type { TurbineSweref } from "@/lib/turbines";
import { swerefToWgs84 } from "@/lib/sweref";

interface ARSceneProps {
  userLat: number;
  userLon: number;
  headingDeg: number;
  turbines: TurbineSweref[];
}

interface TurbineObject {
  turbine: TurbineSweref;
  lat: number;
  lon: number;
  group: THREE.Group;
  label: CanvasLabel;
  distanceLabel: CanvasLabel;
  light: THREE.Sprite;
}

interface CanvasLabel {
  sprite: THREE.Sprite;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
}

const FOV_DEGREES = 65;
const MAX_RENDER_DISTANCE_M = 9000;

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
 * placeras utifrån bäring och avstånd relativt användarens position och
 * enhetens kompassriktning — en enkel men robust "AR utan markörer"-teknik
 * som inte kräver WebXR (brett webbläsarstöd).
 */
export function ARScene({ userLat, userLon, headingDeg, turbines }: ARSceneProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneStateRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    objects: TurbineObject[];
  } | null>(null);
  const headingRef = useRef(headingDeg);
  const userRef = useRef({ lat: userLat, lon: userLon });

  headingRef.current = headingDeg;
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
      const group = buildTurbineMesh(turbine.heightMeters);
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

      return { turbine, lat, lon, group, label, distanceLabel, light };
    });

    sceneStateRef.current = { scene, camera, renderer, objects };

    let raf = 0;
    let blinkPhase = 0;

    function animate() {
      raf = requestAnimationFrame(animate);
      const state = sceneStateRef.current;
      if (!state) return;
      const { lat: uLat, lon: uLon } = userRef.current;
      const heading = headingRef.current;

      blinkPhase += 0.05;
      const blinkOn = isNightTime() && Math.sin(blinkPhase) > 0.75;

      for (const obj of state.objects) {
        const dist = distanceMeters(uLat, uLon, obj.lat, obj.lon);
        const bearing = bearingDegrees(uLat, uLon, obj.lat, obj.lon);
        const relativeAngle = normalizeAngle(bearing - heading);

        // Map relative angle + distance to a 3D position around the camera.
        const angleRad = (relativeAngle * Math.PI) / 180;
        const renderDist = Math.min(dist, MAX_RENDER_DISTANCE_M);
        const scaleDamp = 1 - Math.min(renderDist / MAX_RENDER_DISTANCE_M, 1) * 0.55;
        const planeDist = 400 + renderDist * 0.12;

        const x = Math.sin(angleRad) * planeDist;
        const z = -Math.cos(angleRad) * planeDist;
        const y = -8;

        obj.group.position.set(x, y, z);
        obj.group.scale.setScalar(scaleDamp);
        obj.group.lookAt(0, y, 0);

        const visible = Math.abs(relativeAngle) < FOV_DEGREES * 0.9;
        obj.group.visible = visible;
        obj.label.sprite.visible = visible;
        obj.distanceLabel.sprite.visible = visible;
        obj.light.visible = visible && blinkOn;

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

      state.renderer.render(state.scene, state.camera);
    }
    animate();

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

function buildTurbineMesh(heightMeters: number): THREE.Group {
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
  const rotor = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    blade.rotation.z = (i * Math.PI * 2) / 3;
    rotor.add(blade);
  }
  rotor.position.set(5 * scale, 70 * scale, 0);
  rotor.rotation.x = Math.PI / 2;
  group.add(rotor);

  return group;
}
