import { getPublicConfig } from "@workspace/api-client-react";

let cachedTokenPromise: Promise<string | null> | null = null;

export function getMapboxToken(): Promise<string | null> {
  if (!cachedTokenPromise) {
    cachedTokenPromise = getPublicConfig()
      .then((config) => config.mapboxToken)
      .catch(() => null);
  }
  return cachedTokenPromise;
}
