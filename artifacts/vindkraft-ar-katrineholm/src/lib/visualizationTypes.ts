/** Sol-/skuggläge — endast ett av dessa kan vara aktivt åt gången. */
export type SunMode = "current" | "low" | "evening" | "none";

/** Siktnivå — påverkar hur mycket vindkraftverk och skuggor tonas bort på avstånd. */
export type VisibilityLevel = "clear" | "haze" | "fog";
