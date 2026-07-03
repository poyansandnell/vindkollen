export * from "./generated/api";
// Note: "./generated/types" also exports combined path+query param interfaces
// (e.g. GetWindProjectAreaParams, GetWindTurbineParams) whose names collide with
// the path-only zod schemas of the same name exported from "./generated/api". The
// zod schemas from "./generated/api" are what the server actually validates
// against, so we re-export "./generated/types" with those names excluded.
export type {
  HealthStatus,
  ListBestLocalitiesToTestParams,
  ListWindProjectAreasCategory,
  ListWindProjectAreasParams,
  ListWindTurbinesParams,
  Locality,
  LocalityImpactDetail,
  LocalityImpactDetailScoreBreakdown,
  LocalityRanking,
  PublicConfig,
  SearchLocalitiesParams,
  WindProjectArea,
  WindProjectAreaCategory,
  WindProjectAreaPolygon,
  WindSyncStatus,
  WindTurbine,
} from "./generated/types";
