const SOURCE_LABELS: Record<string, string> = {
  vindbrukskollen: "Vindbrukskollen (Länsstyrelserna)",
  "geonames:se": "GeoNames",
};

const SOURCE_URLS: Record<string, string> = {
  vindbrukskollen: "https://vbk.lansstyrelsen.se/",
  "geonames:se": "https://www.geonames.org/",
};

export function sourceLabel(source: string | null | undefined): string | null {
  if (!source) return null;
  return SOURCE_LABELS[source.toLowerCase()] ?? source;
}

export function sourceUrl(source: string | null | undefined): string | null {
  if (!source) return null;
  return SOURCE_URLS[source.toLowerCase()] ?? null;
}
