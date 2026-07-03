import type { NormalizedTurbine } from "../types";
import { esriDateToIso, queryArcGisLayer } from "./arcgis";

const SOURCE = "vindbrukskollen";

const TURBINE_LAYERS: { id: number; status: string }[] = [
  { id: 5, status: "uppfort" },
  { id: 6, status: "beviljat" },
  { id: 7, status: "avslaget" },
  { id: 8, status: "handlaggs" },
  { id: 9, status: "nedmonterat" },
  { id: 10, status: "overklagat" },
  { id: 11, status: "uppgift_saknas" },
  { id: 12, status: "inte_aktuellt" },
];

interface TurbineAttributes {
  OBJECTID: number;
  VERKID: string | null;
  OMRID: string | null;
  PROJNAMN: string | null;
  STATUS: string | null;
  TOTALHOJD: number | null;
  NAVHOJD: number | null;
  ROTDIAMETER: number | null;
  MAXEFFEKT: number | null;
  FABRIKAT: string | null;
  MODELL: string | null;
  ORGNAMN: string | null;
  KOMNAMN: string | null;
  LANSNAMN: string | null;
  SenasteUppdatering: number | null;
}

export async function fetchSwedenTurbines(): Promise<NormalizedTurbine[]> {
  const turbines: NormalizedTurbine[] = [];

  for (const layer of TURBINE_LAYERS) {
    const features = await queryArcGisLayer<TurbineAttributes>(layer.id);

    for (const feature of features) {
      const a = feature.attributes;
      const lat = feature.geometry?.y;
      const lng = feature.geometry?.x;
      if (lat === undefined || lng === undefined) continue;

      const externalId = a.VERKID ?? `layer${layer.id}-${a.OBJECTID}`;

      turbines.push({
        externalId,
        projectAreaExternalId: a.OMRID,
        name: a.PROJNAMN ?? externalId,
        status: layer.status,
        kommun: a.KOMNAMN,
        region: a.LANSNAMN,
        totalHeightM: a.TOTALHOJD,
        hubHeightM: a.NAVHOJD,
        rotorDiameterM: a.ROTDIAMETER,
        maxEffectMw: a.MAXEFFEKT,
        manufacturer: a.FABRIKAT,
        model: a.MODELL,
        organisationName: a.ORGNAMN,
        lat,
        lng,
        source: SOURCE,
        lastUpdated: esriDateToIso(a.SenasteUppdatering),
      });
    }
  }

  return turbines;
}
