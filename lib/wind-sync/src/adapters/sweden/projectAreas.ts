import type { NormalizedProjectArea } from "../types";
import {
  esriDateToIso,
  polygonCentroid,
  queryArcGisLayer,
  ringsToGeoJsonPolygon,
} from "./arcgis";

const SOURCE = "vindbrukskollen";

const ONSHORE_LAYERS: { id: number; status: string; name: string }[] = [
  { id: 2, status: "aktuellt", name: "Landbaserade_vindkraftverk_Projekteringsomraden" },
  { id: 3, status: "inte_aktuellt", name: "Landbaserade_vindkraftverk_Ej_aktuella_projekteringsomraden" },
];

const OFFSHORE_LAYERS: { id: number; status: string; name: string }[] = [
  { id: 41, status: "uppfort", name: "Havsbaserad_vindkraft_Uppford" },
  { id: 42, status: "beviljat", name: "Havsbaserad_vindkraft_Tillstandsansokan_beviljad" },
  { id: 43, status: "andringsansokan", name: "Havsbaserad_vindkraft_Andringsansokan" },
  { id: 44, status: "avslaget", name: "Havsbaserad_vindkraft_Tillstandsansokan_avslagen" },
  { id: 45, status: "overklagat", name: "Havsbaserad_vindkraft_Overklagad" },
  { id: 46, status: "ansokan_inlamnad", name: "Havsbaserad_vindkraft_Tillstandsansokan_inlamnad" },
  { id: 47, status: "samrad", name: "Havsbaserad_vindkraft_Samrad_infor_tillstandsansokan" },
  { id: 48, status: "inledande_undersokning", name: "Havsbaserad_vindkraft_Inledande_undersokningar" },
  { id: 49, status: "inte_aktuellt", name: "Havsbaserad_vindkraft_Inte_aktuell_eller_aterkallad" },
  { id: 50, status: "uppgift_saknas", name: "Havsbaserad_vindkraft_Uppgift_saknas" },
];

interface OnshoreAttributes {
  OBJECTID: number;
  OMRID: string | null;
  PROJNAMN: string | null;
  ANTALVERK: number | null;
  CALPROD: number | null;
  PBYGGSTART: number | null;
  PDRIFT: number | null;
  ORGNAMN: string | null;
  KOMNAMN: string | null;
  LANSNAMN: string | null;
  ArendeStatusUppdaterat: number | null;
}

interface OffshoreAttributes {
  OBJECTID: number;
  OMRID: string | null;
  HAVSPARKNAMN: string | null;
  Orgnamn: string | null;
  Planantmin: number | null;
  planantmax: number | null;
  Planhojdmax: number | null;
  BevMaxHojd: number | null;
  InstallEff: number | null;
  BeraknadGWh: number | null;
  PBYGGSTART: number | null;
  PDRIFT: number | null;
  KOMNAMN: string | null;
  LANSNAMN: string | null;
  SenasteUppdaterat: number | null;
}

export async function fetchSwedenProjectAreas(): Promise<NormalizedProjectArea[]> {
  const areas: NormalizedProjectArea[] = [];

  for (const layer of ONSHORE_LAYERS) {
    const features = await queryArcGisLayer<OnshoreAttributes>(layer.id);
    for (const feature of features) {
      const a = feature.attributes;
      const rings = feature.geometry?.rings;
      const centroid = polygonCentroid(rings);
      if (!centroid) continue;

      const externalId = a.OMRID ?? `layer${layer.id}-${a.OBJECTID}`;

      areas.push({
        externalId,
        category: "onshore",
        name: a.PROJNAMN ?? externalId,
        status: layer.status,
        kommun: a.KOMNAMN,
        region: a.LANSNAMN,
        turbineCountPlannedMin: a.ANTALVERK,
        turbineCountPlannedMax: a.ANTALVERK,
        heightMaxM: null,
        installedEffectMw: null,
        annualProductionGwh: a.CALPROD,
        plannedConstructionStart: esriDateToIso(a.PBYGGSTART),
        plannedOperationDate: esriDateToIso(a.PDRIFT),
        organisationName: a.ORGNAMN,
        centerLat: centroid.lat,
        centerLng: centroid.lng,
        polygon: ringsToGeoJsonPolygon(rings),
        source: SOURCE,
        sourceLayer: layer.name,
        lastUpdated: esriDateToIso(a.ArendeStatusUppdaterat),
      });
    }
  }

  for (const layer of OFFSHORE_LAYERS) {
    const features = await queryArcGisLayer<OffshoreAttributes>(layer.id);
    for (const feature of features) {
      const a = feature.attributes;
      const rings = feature.geometry?.rings;
      const centroid = polygonCentroid(rings);
      if (!centroid) continue;

      const externalId = a.OMRID ?? `layer${layer.id}-${a.OBJECTID}`;

      areas.push({
        externalId,
        category: "offshore",
        name: a.HAVSPARKNAMN ?? externalId,
        status: layer.status,
        kommun: a.KOMNAMN,
        region: a.LANSNAMN,
        turbineCountPlannedMin: a.Planantmin,
        turbineCountPlannedMax: a.planantmax,
        heightMaxM: a.BevMaxHojd ?? a.Planhojdmax,
        installedEffectMw: a.InstallEff,
        annualProductionGwh: a.BeraknadGWh,
        plannedConstructionStart: esriDateToIso(a.PBYGGSTART),
        plannedOperationDate: esriDateToIso(a.PDRIFT),
        organisationName: a.Orgnamn,
        centerLat: centroid.lat,
        centerLng: centroid.lng,
        polygon: ringsToGeoJsonPolygon(rings),
        source: SOURCE,
        sourceLayer: layer.name,
        lastUpdated: esriDateToIso(a.SenasteUppdaterat),
      });
    }
  }

  return areas;
}
