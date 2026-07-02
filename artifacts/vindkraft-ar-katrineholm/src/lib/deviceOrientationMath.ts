import * as THREE from "three";

// Standardtransformationen som three.js DeviceOrientationControls använder
// för att omvandla enhetens alpha/beta/gamma-sensorvärden till en quaternion
// som matchar hur kameran fysiskt är riktad i rummet (gir, pitch och roll).
// Detta gör att AR-objekt upplevs som fast förankrade i verkligheten/
// horisonten istället för fastklistrade på skärmen när telefonen tiltas.
const EULER_ORDER = "YXZ" as const;
const Q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -90° runt X-axeln
const ZEE = new THREE.Vector3(0, 0, 1);

const workingEuler = new THREE.Euler();
const screenTransform = new THREE.Quaternion();

export function computeDeviceQuaternion(
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
  screenAngleDeg: number,
  target: THREE.Quaternion = new THREE.Quaternion(),
): THREE.Quaternion {
  const alpha = THREE.MathUtils.degToRad(alphaDeg);
  const beta = THREE.MathUtils.degToRad(betaDeg);
  const gamma = THREE.MathUtils.degToRad(gammaDeg);
  const orient = THREE.MathUtils.degToRad(screenAngleDeg);

  workingEuler.set(beta, alpha, -gamma, EULER_ORDER);
  target.setFromEuler(workingEuler);
  target.multiply(Q1);
  target.multiply(screenTransform.setFromAxisAngle(ZEE, -orient));
  return target;
}
