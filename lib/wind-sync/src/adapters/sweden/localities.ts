import type { NormalizedLocality } from "../types";

const GEONAMES_BASE = "https://download.geonames.org/export/dump";
const SOURCE = "geonames:SE";

/**
 * Swedish localities are sourced from GeoNames (CC BY 4.0), not the official
 * SCB tätorter dataset. SCB does not expose a freely fetchable, scriptable
 * geodata service for tätorter boundaries/points without a manual export
 * step, so GeoNames' Sweden populated-places dump (feature class "P") is
 * used as the most complete freely-licensed fallback. This is a documented
 * limitation: locality boundaries are point-based, and population figures
 * may lag SCB's own official statistics.
 */

interface AdminNameMaps {
  admin1: Map<string, string>;
  admin2: Map<string, string>;
}

async function fetchAdminNameMaps(): Promise<AdminNameMaps> {
  const [admin1Text, admin2Text] = await Promise.all([
    fetch(`${GEONAMES_BASE}/admin1CodesASCII.txt`).then((r) => r.text()),
    fetch(`${GEONAMES_BASE}/admin2Codes.txt`).then((r) => r.text()),
  ]);

  const admin1 = new Map<string, string>();
  for (const line of admin1Text.split("\n")) {
    if (!line.startsWith("SE.")) continue;
    const [code, name] = line.split("\t");
    if (code && name) admin1.set(code, name.replace(/\s+län$/i, "").trim());
  }

  const admin2 = new Map<string, string>();
  for (const line of admin2Text.split("\n")) {
    if (!line.startsWith("SE.")) continue;
    const [code, name] = line.split("\t");
    if (code && name) admin2.set(code, name.replace(/\s+[Kk]ommun$/, "").trim());
  }

  return { admin1, admin2 };
}

async function downloadAndExtractSeZip(): Promise<string> {
  const res = await fetch(`${GEONAMES_BASE}/SE.zip`);
  if (!res.ok) {
    throw new Error(`Failed to download GeoNames SE.zip: ${res.status} ${res.statusText}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());

  const AdmZip = (await import("adm-zip")).default;
  const zip = new AdmZip(buffer);
  const entry = zip.getEntries().find((e) => e.entryName.toUpperCase() === "SE.TXT");
  if (!entry) {
    throw new Error("SE.txt entry not found in GeoNames SE.zip");
  }
  return entry.getData().toString("utf-8");
}

export async function fetchSwedenLocalities(): Promise<NormalizedLocality[]> {
  const [{ admin1, admin2 }, seText] = await Promise.all([
    fetchAdminNameMaps(),
    downloadAndExtractSeZip(),
  ]);

  const localities: NormalizedLocality[] = [];

  for (const line of seText.split("\n")) {
    if (!line.trim()) continue;
    const cols = line.split("\t");
    // geonames "geoname" table columns, see http://download.geonames.org/export/dump/readme.txt
    const [
      geonameid,
      name,
      ,
      ,
      latitude,
      longitude,
      featureClass,
      featureCode,
      ,
      ,
      admin1Code,
      admin2Code,
      ,
      ,
      population,
    ] = cols;

    if (featureClass !== "P") continue; // populated places only
    // Skip generic "second-order administrative division" style codes with no real population signal
    if (!name || !latitude || !longitude) continue;

    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const pop = population ? Number(population) : 0;

    localities.push({
      externalId: geonameid,
      name,
      kommun:
        admin1Code && admin2Code ? admin2.get(`SE.${admin1Code}.${admin2Code}`) ?? null : null,
      region: admin1Code ? admin1.get(`SE.${admin1Code}`) ?? null : null,
      population: Number.isFinite(pop) && pop > 0 ? pop : null,
      lat,
      lng,
      source: SOURCE,
    });
  }

  return localities;
}
