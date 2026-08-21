// Place-name lookup for the search box.
//
// Prefers the geocode edge function (which sends the User-Agent Nominatim asks
// for), and falls back to calling Nominatim straight from the browser when that
// function is not deployed. Either way this is a coordinate lookup and nothing
// more: it never triggers ingestion, and never touches Firecrawl or OpenAI.

import { supabase } from "./supabase";

export type GeocodeHit = {
  name: string;
  latitude: number;
  longitude: number;
  country: string | null;
};

const NOMINATIM = "https://nominatim.openstreetmap.org/search";

function fromNominatimRow(row: Record<string, any>, fallbackName: string): GeocodeHit | null {
  const lat = parseFloat(row?.lat);
  const lng = parseFloat(row?.lon);
  if (isNaN(lat) || isNaN(lng)) return null;
  return {
    name: typeof row?.display_name === "string" ? row.display_name : fallbackName,
    latitude: lat,
    longitude: lng,
    country: row?.address?.country ?? null,
  };
}

async function viaEdgeFunction(query: string): Promise<GeocodeHit[] | null> {
  try {
    const { data, error } = await supabase.functions.invoke("geocode", {
      body: { query },
    });
    if (error || !data) return null;
    const results = data.results;
    return Array.isArray(results) ? (results as GeocodeHit[]) : null;
  } catch {
    return null;
  }
}

async function viaBrowser(query: string, signal?: AbortSignal): Promise<GeocodeHit[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      format: "jsonv2",
      limit: "5",
      addressdetails: "1",
    });
    const res = await fetch(`${NOMINATIM}?${params}`, {
      headers: { Accept: "application/json" },
      signal,
    });
    if (!res.ok) return [];
    const rows = await res.json();
    if (!Array.isArray(rows)) return [];
    return rows
      .map((r) => fromNominatimRow(r, query))
      .filter((h): h is GeocodeHit => h !== null);
  } catch {
    return [];
  }
}

export async function geocodePlace(
  query: string,
  signal?: AbortSignal,
): Promise<GeocodeHit[]> {
  const viaFunction = await viaEdgeFunction(query);
  if (viaFunction && viaFunction.length > 0) return viaFunction;
  return viaBrowser(query, signal);
}
