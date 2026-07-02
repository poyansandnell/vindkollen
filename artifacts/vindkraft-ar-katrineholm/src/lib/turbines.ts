// Vindkraftverk baserade på det planerade Länsterberget-projektet norr om
// Katrineholm (gränsen mot Flen/Eskilstuna). Koordinaterna är lagrade i
// SWEREF99 TM (EPSG:3006) — Sveriges officiella referenssystem för
// lantmäteridata — och konverteras till WGS84 i realtid med proj4, se
// `sweref.ts`.
export interface TurbineSweref {
  id: string;
  name: string;
  /** SWEREF99 TM easting (meter) */
  easting: number;
  /** SWEREF99 TM northing (meter) */
  northing: number;
  /** Totalhöjd i meter (nav + rotorblad) */
  heightMeters: number;
}

export const TURBINES: TurbineSweref[] = [
  { id: "t1", name: "Länsterberget 1", easting: 581376, northing: 6559753, heightMeters: 250 },
  { id: "t2", name: "Länsterberget 2", easting: 581949, northing: 6559745, heightMeters: 250 },
  { id: "t3", name: "Länsterberget 3", easting: 582438, northing: 6559736, heightMeters: 250 },
  { id: "t4", name: "Länsterberget 4", easting: 583004, northing: 6559616, heightMeters: 250 },
  { id: "t5", name: "Länsterberget 5", easting: 583583, northing: 6559747, heightMeters: 250 },
  { id: "t6", name: "Länsterberget 6", easting: 584144, northing: 6559664, heightMeters: 250 },
  { id: "t7", name: "Länsterberget 7", easting: 581110, northing: 6560297, heightMeters: 250 },
  { id: "t8", name: "Länsterberget 8", easting: 581715, northing: 6560287, heightMeters: 250 },
  { id: "t9", name: "Länsterberget 9", easting: 582129, northing: 6560150, heightMeters: 250 },
  { id: "t10", name: "Länsterberget 10", easting: 582774, northing: 6560276, heightMeters: 250 },
  { id: "t11", name: "Länsterberget 11", easting: 583246, northing: 6560205, heightMeters: 250 },
  { id: "t12", name: "Länsterberget 12", easting: 583833, northing: 6560215, heightMeters: 250 },
  { id: "t13", name: "Länsterberget 13", easting: 581337, northing: 6560653, heightMeters: 250 },
  { id: "t14", name: "Länsterberget 14", easting: 581875, northing: 6560782, heightMeters: 250 },
  { id: "t15", name: "Länsterberget 15", easting: 582414, northing: 6560778, heightMeters: 250 },
  { id: "t16", name: "Länsterberget 16", easting: 582918, northing: 6560809, heightMeters: 250 },
  { id: "t17", name: "Länsterberget 17", easting: 583542, northing: 6560678, heightMeters: 250 },
  { id: "t18", name: "Länsterberget 18", easting: 584174, northing: 6560680, heightMeters: 250 },
  { id: "t19", name: "Länsterberget 19", easting: 581038, northing: 6561303, heightMeters: 250 },
  { id: "t20", name: "Länsterberget 20", easting: 581588, northing: 6561171, heightMeters: 250 },
  { id: "t21", name: "Länsterberget 21", easting: 582273, northing: 6561199, heightMeters: 250 },
  { id: "t22", name: "Länsterberget 22", easting: 582776, northing: 6561336, heightMeters: 250 },
  { id: "t23", name: "Länsterberget 23", easting: 583272, northing: 6561283, heightMeters: 250 },
  { id: "t24", name: "Länsterberget 24", easting: 583789, northing: 6561177, heightMeters: 250 },
  { id: "t25", name: "Länsterberget 25", easting: 581292, northing: 6561827, heightMeters: 250 },
  { id: "t26", name: "Länsterberget 26", easting: 581934, northing: 6561754, heightMeters: 250 },
  { id: "t27", name: "Länsterberget 27", easting: 582425, northing: 6561714, heightMeters: 250 },
  { id: "t28", name: "Länsterberget 28", easting: 583066, northing: 6561796, heightMeters: 250 },
  { id: "t29", name: "Länsterberget 29", easting: 583514, northing: 6561782, heightMeters: 250 },
];
