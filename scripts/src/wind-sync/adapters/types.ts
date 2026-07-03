export interface GeoJsonPolygon {
  type: "Polygon" | "MultiPolygon";
  coordinates: unknown;
}

export interface NormalizedLocality {
  externalId: string;
  name: string;
  kommun: string | null;
  region: string | null;
  population: number | null;
  lat: number;
  lng: number;
  source: string;
}

export interface NormalizedProjectArea {
  externalId: string;
  category: "onshore" | "offshore";
  name: string;
  status: string;
  kommun: string | null;
  region: string | null;
  turbineCountPlannedMin: number | null;
  turbineCountPlannedMax: number | null;
  heightMaxM: number | null;
  installedEffectMw: number | null;
  annualProductionGwh: number | null;
  plannedConstructionStart: string | null;
  plannedOperationDate: string | null;
  organisationName: string | null;
  centerLat: number;
  centerLng: number;
  polygon: GeoJsonPolygon | null;
  source: string;
  sourceLayer: string;
  lastUpdated: string | null;
}

export interface NormalizedTurbine {
  externalId: string;
  projectAreaExternalId: string | null;
  name: string;
  status: string;
  kommun: string | null;
  region: string | null;
  totalHeightM: number | null;
  hubHeightM: number | null;
  rotorDiameterM: number | null;
  maxEffectMw: number | null;
  manufacturer: string | null;
  model: string | null;
  organisationName: string | null;
  lat: number;
  lng: number;
  source: string;
  lastUpdated: string | null;
}

export interface CountryWindDataAdapter {
  countryCode: string;
  countryName: string;
  fetchLocalities(): Promise<NormalizedLocality[]>;
  fetchProjectAreas(): Promise<NormalizedProjectArea[]>;
  fetchTurbines(): Promise<NormalizedTurbine[]>;
}
