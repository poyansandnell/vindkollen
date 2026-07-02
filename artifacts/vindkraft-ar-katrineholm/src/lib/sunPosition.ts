/**
 * Ungefärlig solposition (höjd/altitud + azimut) baserad på datum, tid och
 * GPS-position. Använder en förenklad, allmänt känd algoritm (ekliptiska
 * koordinater -> ekvatoriella -> horisontella) — tillräckligt noggrann för
 * en visualisering, men INTE avsedd för exakta astronomiska beräkningar.
 */
export interface SunPosition {
  /** Höjd över horisonten i grader. Negativ = solen har gått ner. */
  altitudeDeg: number;
  /** Azimut i grader, medurs från norr (0 = norr, 90 = öster, 180 = söder, 270 = väster). */
  azimuthDeg: number;
}

const RAD = Math.PI / 180;

export function getCurrentSunPosition(date: Date, latDeg: number, lonDeg: number): SunPosition {
  const J2000 = Date.UTC(2000, 0, 1, 12, 0, 0);
  const d = (date.getTime() - J2000) / 86400000; // dagar sedan J2000.0

  const meanLongitude = normalize360(280.46 + 0.9856474 * d);
  const meanAnomaly = normalize360(357.528 + 0.9856003 * d);
  const eclipticLongitude = normalize360(
    meanLongitude + 1.915 * Math.sin(meanAnomaly * RAD) + 0.02 * Math.sin(2 * meanAnomaly * RAD),
  );
  const obliquity = 23.439 - 0.0000004 * d;

  const eclLonRad = eclipticLongitude * RAD;
  const oblRad = obliquity * RAD;

  const rightAscensionDeg = Math.atan2(Math.cos(oblRad) * Math.sin(eclLonRad), Math.cos(eclLonRad)) / RAD;
  const declinationDeg = Math.asin(Math.sin(oblRad) * Math.sin(eclLonRad)) / RAD;

  const gmstDeg = normalize360(280.46061837 + 360.98564736629 * d);
  const localSiderealDeg = normalize360(gmstDeg + lonDeg);
  let hourAngleDeg = localSiderealDeg - rightAscensionDeg;
  if (hourAngleDeg > 180) hourAngleDeg -= 360;
  if (hourAngleDeg < -180) hourAngleDeg += 360;

  const latRad = latDeg * RAD;
  const decRad = declinationDeg * RAD;
  const haRad = hourAngleDeg * RAD;

  const altitudeRad = Math.asin(
    Math.sin(latRad) * Math.sin(decRad) + Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad),
  );

  const azimuthFromSouthRad = Math.atan2(
    Math.sin(haRad),
    Math.cos(haRad) * Math.sin(latRad) - Math.tan(decRad) * Math.cos(latRad),
  );
  const azimuthDeg = normalize360(azimuthFromSouthRad / RAD + 180);

  return { altitudeDeg: altitudeRad / RAD, azimuthDeg };
}

function normalize360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}
