import proj4 from "proj4";

// SWEREF99 TM (EPSG:3006) — Sveriges nationella referenssystem, definierat av
// Lantmäteriet.
const SWEREF99TM = "EPSG:3006";
proj4.defs(
  SWEREF99TM,
  "+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs",
);

export interface Wgs84Point {
  lat: number;
  lon: number;
}

/** Converts SWEREF99 TM (easting/northing in meters) to WGS84 lat/lon. */
export function swerefToWgs84(easting: number, northing: number): Wgs84Point {
  const [lon, lat] = proj4(SWEREF99TM, "WGS84", [easting, northing]);
  return { lat, lon };
}

/** Converts WGS84 lat/lon to SWEREF99 TM easting/northing. */
export function wgs84ToSweref(lat: number, lon: number): { easting: number; northing: number } {
  const [easting, northing] = proj4("WGS84", SWEREF99TM, [lon, lat]);
  return { easting, northing };
}
