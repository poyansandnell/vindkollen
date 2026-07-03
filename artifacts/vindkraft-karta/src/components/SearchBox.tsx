import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, MapPin, Search } from "lucide-react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useSearchLocalities } from "@workspace/api-client-react";
import type { Locality } from "@workspace/api-client-react";
import type { UseQueryOptions } from "@tanstack/react-query";

interface GeocodeFeature {
  id: string;
  place_name: string;
  center: [number, number];
}

interface SearchBoxProps {
  mapboxToken: string;
  onSelectLocation: (point: { lat: number; lng: number; label: string }) => void;
  onLocateMe: () => void;
  locating: boolean;
}

export default function SearchBox({
  mapboxToken,
  onSelectLocation,
  onLocateMe,
  locating,
}: SearchBoxProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const debouncedQuery = useDebouncedValue(query, 300);
  const [geocodeResults, setGeocodeResults] = useState<GeocodeFeature[]>([]);
  const [geocoding, setGeocoding] = useState(false);

  const { data: localities = [] } = useSearchLocalities(
    { q: debouncedQuery, limit: 6 },
    { query: { enabled: debouncedQuery.trim().length >= 2 } as UseQueryOptions<Locality[]> },
  );

  useEffect(() => {
    if (debouncedQuery.trim().length < 2) {
      setGeocodeResults([]);
      return;
    }
    let cancelled = false;
    setGeocoding(true);
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
      debouncedQuery,
    )}.json?access_token=${mapboxToken}&country=se&language=sv&limit=5`;
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setGeocodeResults(data.features ?? []);
      })
      .catch(() => {
        if (!cancelled) setGeocodeResults([]);
      })
      .finally(() => {
        if (!cancelled) setGeocoding(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, mapboxToken]);

  const handleSelectLocality = (locality: Locality) => {
    onSelectLocation({ lat: locality.lat, lng: locality.lng, label: locality.name });
    setQuery(locality.name);
    setOpen(false);
  };

  const handleSelectGeocode = (feature: GeocodeFeature) => {
    onSelectLocation({
      lat: feature.center[1],
      lng: feature.center[0],
      label: feature.place_name,
    });
    setQuery(feature.place_name);
    setOpen(false);
  };

  const hasResults = localities.length > 0 || geocodeResults.length > 0;

  return (
    <div className="relative w-full max-w-sm">
      <div className="flex items-center gap-2 rounded-md border bg-background shadow-sm px-2">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Sök ort eller adress i Sverige..."
          className="border-0 shadow-none focus-visible:ring-0 px-1"
          data-testid="input-search-location"
        />
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={onLocateMe}
          disabled={locating}
          title="Använd min plats"
          data-testid="button-locate-me"
        >
          {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
        </Button>
      </div>

      {open && (hasResults || geocoding) && (
        <div className="absolute top-full left-0 right-0 mt-1 rounded-md border bg-popover shadow-md max-h-80 overflow-y-auto z-10">
          {localities.length > 0 && (
            <div>
              <div className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                Orter
              </div>
              {localities.map((locality) => (
                <button
                  key={`locality-${locality.id}`}
                  className="w-full text-left px-3 py-2 hover:bg-accent text-sm"
                  onClick={() => handleSelectLocality(locality)}
                  data-testid={`option-locality-${locality.id}`}
                >
                  <div className="font-medium">{locality.name}</div>
                  {locality.kommun && (
                    <div className="text-xs text-muted-foreground">{locality.kommun}</div>
                  )}
                </button>
              ))}
            </div>
          )}
          {geocodeResults.length > 0 && (
            <div>
              <div className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                Adresser
              </div>
              {geocodeResults.map((feature) => (
                <button
                  key={feature.id}
                  className="w-full text-left px-3 py-2 hover:bg-accent text-sm"
                  onClick={() => handleSelectGeocode(feature)}
                  data-testid={`option-geocode-${feature.id}`}
                >
                  {feature.place_name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
