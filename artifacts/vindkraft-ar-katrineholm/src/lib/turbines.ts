// Vindkraftverk baserade på verkliga planerade positioner norr om
// Katrineholm. Koordinaterna är lagrade i SWEREF99 TM (EPSG:3006) — Sveriges
// officiella referenssystem för lantmäteridata — och konverteras till WGS84
// i realtid med proj4, se `sweref.ts`.
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

const RAW_TURBINES: RawTurbine[] = [
  { name: "V1-1", easting: 572831, northing: 6531802, groundHeightMeters: 60, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 310 },
  { name: "V1-2", easting: 573444, northing: 6531358, groundHeightMeters: 60, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 310 },
  { name: "V1-3", easting: 572209, northing: 6531313, groundHeightMeters: 59.6, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 309.6 },
  { name: "V1-4", easting: 574009, northing: 6530860, groundHeightMeters: 60, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 310 },
  { name: "V1-5", easting: 574764, northing: 6530671, groundHeightMeters: 60, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 310 },
  { name: "V1-6", easting: 574133, northing: 6530099, groundHeightMeters: 60, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 310 },
  { name: "V1-7", easting: 574383, northing: 6529391, groundHeightMeters: 53.1, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 303.1 },

  { name: "V2-1", easting: 570530, northing: 6528757, groundHeightMeters: 67.5, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 317.5 },
  { name: "V2-2", easting: 570907, northing: 6528120, groundHeightMeters: 50, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 300 },
  { name: "V2-3", easting: 571323, northing: 6527324, groundHeightMeters: 50, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 300 },
  { name: "V2-4", easting: 571487, northing: 6526310, groundHeightMeters: 60, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 310 },
  { name: "V2-5", easting: 570688, northing: 6526208, groundHeightMeters: 60, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 310 },
  { name: "V2-6", easting: 571139, northing: 6525624, groundHeightMeters: 60, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 310 },

  { name: "V3-1", easting: 571183, northing: 6532917, groundHeightMeters: 50, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 300 },
  { name: "V3-2", easting: 569746, northing: 6532282, groundHeightMeters: 50, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 300 },
  { name: "V3-3", easting: 570696, northing: 6532228, groundHeightMeters: 50, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 300 },
  { name: "V3-4", easting: 570080, northing: 6531618, groundHeightMeters: 60, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 310 },

  { name: "V4-1", easting: 576748, northing: 6531209, groundHeightMeters: 55.6, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 305.6 },
  { name: "V4-2", easting: 576740, northing: 6530470, groundHeightMeters: 60, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 310 },
  { name: "V4-3", easting: 576668, northing: 6529730, groundHeightMeters: 50, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 300 },
  { name: "V4-4", easting: 576040, northing: 6528983, groundHeightMeters: 50, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 300 },
  { name: "V4-5", easting: 576840, northing: 6528959, groundHeightMeters: 50, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 300 },
  { name: "V4-6", easting: 576159, northing: 6528257, groundHeightMeters: 51.9, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 301.9 },

  { name: "V5-1", easting: 573567, northing: 6540090, groundHeightMeters: 60, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 310 },
  { name: "V5-2", easting: 572745, northing: 6539926, groundHeightMeters: 60, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 310 },
  { name: "V5-3", easting: 574324, northing: 6539816, groundHeightMeters: 60, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 310 },
  { name: "V5-4", easting: 574887, northing: 6539328, groundHeightMeters: 60, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 310 },
  { name: "V5-5", easting: 574869, northing: 6538522, groundHeightMeters: 60, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 310 },
  { name: "V5-6", easting: 573824, northing: 6538206, groundHeightMeters: 69.6, hubHeightMeters: 169, rotorDiameterMeters: 162, totalHeightMeters: 250, totalHeightAboveSeaMeters: 319.6 },
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
