// Vindkraftverk för Katrineholm Vind Ericsberg, Katrineholms Kommun.
// Koordinater från officiellt projektunderlag (Renewable Sweden / OX2),
// datum 2024. SWEREF99 TM (EPSG:3006) — öst = easting, nord = northing.
// Turbintyp: RT90 2.5 gon V, navhöjd 169 m, rotordiameter 162 m, totalhöjd 250 m.
export interface TurbineSweref {
  id: string;
  name: string;
  /** SWEREF99 TM easting (meter) */
  easting: number;
  /** SWEREF99 TM northing (meter) */
  northing: number;
  /** Totalhöjd i meter (mark till bladspets) — används för visuell storlek */
  heightMeters: number;
  /** Markhöjd (Z) i meter över havet */
  groundHeightMeters: number;
  /** Navhöjd i meter */
  hubHeightMeters: number;
  /** Rotordiameter i meter */
  rotorDiameterMeters: number;
  /** Totalhöjd över havet (markhöjd + totalhöjd) i meter */
  totalHeightAboveSeaMeters: number;
}

interface RawTurbine {
  name: string;
  easting: number;
  northing: number;
  groundHeightMeters: number;
  hubHeightMeters: number;
  rotorDiameterMeters: number;
  totalHeightMeters: number;
  totalHeightAboveSeaMeters: number;
}

// 8 verk enligt officiellt samrådsunderlag — SWEREF99 TM (Öst/Nord).
const RAW_TURBINES: RawTurbine[] = [
  { name: "V1", easting: 573286, northing: 6540093, groundHeightMeters: 60.0, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 310.0 },
  { name: "V2", easting: 573685, northing: 6539247, groundHeightMeters: 60.0, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 310.0 },
  { name: "V3", easting: 574124, northing: 6539911, groundHeightMeters: 55.0, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 305.0 },
  { name: "V4", easting: 574825, northing: 6539527, groundHeightMeters: 58.4, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 308.4 },
  { name: "V5", easting: 575006, northing: 6538807, groundHeightMeters: 62.5, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 312.5 },
  { name: "V6", easting: 573308, northing: 6538050, groundHeightMeters: 65.0, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 315.0 },
  { name: "V7", easting: 574192, northing: 6538668, groundHeightMeters: 60.5, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 310.5 },
  { name: "V8", easting: 574557, northing: 6537995, groundHeightMeters: 69.0, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 319.0 },
];

export const TURBINES: TurbineSweref[] = RAW_TURBINES.map((t, index) => ({
  id: `t${index + 1}`,
  name: t.name,
  easting: t.easting,
  northing: t.northing,
  heightMeters: t.totalHeightMeters,
  groundHeightMeters: t.groundHeightMeters,
  hubHeightMeters: t.hubHeightMeters,
  rotorDiameterMeters: t.rotorDiameterMeters,
  totalHeightAboveSeaMeters: t.totalHeightAboveSeaMeters,
}));
