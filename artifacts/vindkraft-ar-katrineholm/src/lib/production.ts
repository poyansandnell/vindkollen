/**
 * B3: Beräknad elproduktion och CO₂-besparing per vindkraftsprojekt.
 *
 * Antaganden (typiskt modernt landbaserat 3–4 MW-verk, Sverige):
 * - ~8,5 GWh/år per verk (kapacitetsfaktor ~25–30 %).
 * - ~5 000 kWh/år per genomsnittligt hushåll (exkl. uppvärmning).
 * - ~500 ton CO₂/GWh vs. europeisk genomsnittsmix.
 */

const ANNUAL_GWH_PER_TURBINE = 8.5;
const HOUSEHOLD_KWH_PER_YEAR = 5_000;
const CO2_TONS_PER_GWH = 500;

export interface ProductionEstimate {
  annualGWh: number;
  households: number;
  co2OffsetTons: number;
}

export function estimateProduction(turbineCount: number): ProductionEstimate {
  const annualGWh = turbineCount * ANNUAL_GWH_PER_TURBINE;
  const households = Math.round((annualGWh * 1_000_000) / HOUSEHOLD_KWH_PER_YEAR);
  const co2OffsetTons = Math.round(annualGWh * CO2_TONS_PER_GWH);
  return { annualGWh, households, co2OffsetTons };
}
