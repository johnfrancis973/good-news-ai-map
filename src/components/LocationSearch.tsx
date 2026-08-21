import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MapPin, Search } from "lucide-react";
import { geocodePlace, useLocations } from "../lib/queries";
import type { LocationRow } from "../lib/types";
import { cn } from "../lib/utils";

export type Resolved = {
  name: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
};

type Props = {
  onResolved: (place: Resolved) => void;
  autoFocus?: boolean;
  size?: "lg" | "md";
};

/**
 * Resolves a place to coordinates. Known locations (those we have already
 * ingested) match instantly from Postgres; anything else falls back to the
 * Nominatim proxy. Neither path triggers ingestion — selecting a place never
 * makes the user wait on Firecrawl or OpenAI.
 */
export function LocationSearch({ onResolved, autoFocus, size = "lg" }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [remote, setRemote] = useState<Resolved[]>([]);
  const [searching, setSearching] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const { data: locations = [] } = useLocations();

  const localMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return locations
      .filter(
        (l: LocationRow) =>
          l.name.toLowerCase().includes(q) ||
          (l.country ?? "").toLowerCase().includes(q),
      )
      .slice(0, 5)
      .map((l) => ({
        name: l.name,
        latitude: l.latitude,
        longitude: l.longitude,
        radiusKm: l.default_radius_km ?? 50,
      }));
  }, [locations, query]);

  // Only reach for the geocoder when we have nothing locally.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3 || localMatches.length > 0) {
      setRemote([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const hits = await geocodePlace(q);
      if (cancelled) return;
      setRemote(
        hits.slice(0, 5).map((h) => ({
          name: h.name,
          latitude: h.latitude,
          longitude: h.longitude,
          radiusKm: 50,
        })),
      );
      setSearching(false);
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setSearching(false);
    };
  }, [query, localMatches.length]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const suggestions = localMatches.length > 0 ? localMatches : remote;

  function pick(place: Resolved) {
    setQuery(place.name);
    setOpen(false);
    onResolved(place);
  }

  function submit() {
    if (suggestions.length > 0) pick(suggestions[0]);
  }

  return (
    <div ref={boxRef} className="relative w-full">
      <div
        className={cn(
          "flex items-center gap-2 rounded-xl border border-input bg-card shadow-sm transition focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-ring/25",
          size === "lg" ? "px-4 py-3" : "px-3 py-2",
        )}
      >
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Search a city or region"
          aria-label="Search a city or region"
          className={cn(
            "w-full bg-transparent outline-none placeholder:text-muted-foreground",
            size === "lg" ? "text-base" : "text-sm",
          )}
        />
        {searching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        <button
          type="button"
          onClick={submit}
          disabled={suggestions.length === 0}
          className={cn(
            "shrink-0 rounded-lg bg-primary font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-40",
            size === "lg" ? "px-4 py-2 text-sm" : "px-3 py-1.5 text-xs",
          )}
        >
          Explore
        </button>
      </div>

      {open && suggestions.length > 0 && (
        <ul className="absolute z-40 mt-2 w-full overflow-hidden rounded-xl border border-border bg-card shadow-lg">
          {suggestions.map((s, i) => (
            <li key={`${s.name}-${i}`}>
              <button
                type="button"
                onClick={() => pick(s)}
                className="flex w-full items-start gap-2 px-4 py-2.5 text-left text-sm transition hover:bg-muted"
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="line-clamp-2">{s.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
