import { useCallback, useState } from "react";

export interface GeoPoint {
  lat: number;
  lng: number;
  label?: string;
}

interface UseGeolocationResult {
  locating: boolean;
  error: string | null;
  locate: () => void;
}

export function useGeolocation(onLocated: (point: GeoPoint) => void): UseGeolocationResult {
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setError("Din webbläsare saknar stöd för platsdelning.");
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        onLocated({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          label: "Min plats",
        });
      },
      (err) => {
        setLocating(false);
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Platsåtkomst nekades. Sök på en ort istället."
            : "Kunde inte hämta din plats.",
        );
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [onLocated]);

  return { locating, error, locate };
}
