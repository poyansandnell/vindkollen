import proj4 from "proj4";

// SWEREF99 TM (EPSG:3006) — Sveriges nationella referenssystem, definierat av
// Lantmäteriet. Definitionen nedan används av bl.a. Lantmäteriets egna
// tjänster.
const SWEREF99TM = "EPSG:3006";
proj4.defs(
  SWEREF99TM,
  "+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs",
);

export interface WGS84 {
  lat: number;
  lon: number;
}

/** Konverterar SWEREF99 TM (easting/northing i meter) till WGS84 lat/lon. */
export function swerefToWgs84(easting: number, northing: number): WGS84 {
  const [lon, lat] = proj4(SWEREF99TM, "WGS84", [easting, northing]);
  return { lat, lon };
}

/** Konverterar WGS84 lat/lon till SWEREF99 TM easting/northing. */
export function wgs84ToSweref(lat: number, lon: number): { easting: number; northing: number } {
  const [easting, northing] = proj4("WGS84", SWEREF99TM, [lon, lat]);
  return { easting, northing };
}
