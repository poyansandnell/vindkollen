const GEONAMES_ZIP_BASE = "https://download.geonames.org/export/zip";

export interface NormalizedPostcode {
  postcode: string;
  lat: number;
  lng: number;
}

/**
 * Swedish postal codes (postnummer) are sourced from GeoNames' postal code
 * dump (CC BY 4.0), not an official PostNord dataset (which requires a paid
 * license to redistribute). Each row is a postcode + place name + point;
 * this is later spatially joined to the nearest locality in run.ts so the
 * locality table itself can be searched by postcode.
 */
export async function fetchSwedenPostcodes(): Promise<NormalizedPostcode[]> {
  const res = await fetch(`${GEONAMES_ZIP_BASE}/SE.zip`);
  if (!res.ok) {
    throw new Error(`Failed to download GeoNames postal code SE.zip: ${res.status} ${res.statusText}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());

  const AdmZip = (await import("adm-zip")).default;
  const zip = new AdmZip(buffer);
  const entry = zip.getEntries().find((e) => e.entryName.toUpperCase() === "SE.TXT");
  if (!entry) {
    throw new Error("SE.txt entry not found in GeoNames postal code SE.zip");
  }
  const text = entry.getData().toString("utf-8");

  const postcodes: NormalizedPostcode[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const cols = line.split("\t");
    // country code, postal code, place name, admin name1, admin code1,
    // admin name2, admin code2, admin name3, admin code3, latitude, longitude, accuracy
    const [, postalCode, , , , , , , , latitude, longitude] = cols;
    if (!postalCode || !latitude || !longitude) continue;

    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    postcodes.push({ postcode: postalCode.replace(/\s+/g, ""), lat, lng });
  }

  return postcodes;
}
