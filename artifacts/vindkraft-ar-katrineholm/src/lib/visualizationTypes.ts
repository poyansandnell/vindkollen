/** Sol-/skuggläge — endast ett av dessa kan vara aktivt åt gången. */
export type SunMode = "current" | "low" | "evening" | "none";

/** Siktnivå — påverkar hur mycket vindkraftverk och skuggor tonas bort på avstånd. */
export type VisibilityLevel = "clear" | "haze" | "fog";

/** Är "Skuggflimmer" (blinkande rotorbladsskugga) valt av användaren? Bara
 *  faktiskt aktivt i sol-lägena "current"/"low" — se `shadowFlickerActive`. */
export function shadowFlickerActive(shadowFlickerOn: boolean, sunMode: SunMode): boolean {
  return shadowFlickerOn && (sunMode === "current" || sunMode === "low");
}
