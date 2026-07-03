import type { CountryWindDataAdapter } from "../types";
import { fetchSwedenLocalities } from "./localities";
import { fetchSwedenProjectAreas } from "./projectAreas";
import { fetchSwedenTurbines } from "./turbines";
import { fetchSwedenPostcodes } from "./postcodes";

export const swedenAdapter: CountryWindDataAdapter = {
  countryCode: "SE",
  countryName: "Sverige",
  fetchLocalities: fetchSwedenLocalities,
  fetchProjectAreas: fetchSwedenProjectAreas,
  fetchTurbines: fetchSwedenTurbines,
  fetchPostcodes: fetchSwedenPostcodes,
};
