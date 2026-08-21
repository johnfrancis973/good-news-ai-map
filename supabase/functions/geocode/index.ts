// geocode — thin OpenStreetMap/Nominatim proxy for the home-page search box.
//
// Exists because browsers cannot set the User-Agent header Nominatim requires.
// No API keys are involved. It resolves a place name to coordinates and nothing
// more: it never triggers ingestion, never calls Firecrawl and never calls OpenAI.

import { corsHeaders, json } from "../_shared/cors.ts";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "GoodNewsAIMap/1.0 (hackathon MVP)";
const MAX_QUERY_LEN = 120;

type Hit = {
  name: string;
  latitude: number;
  longitude: number;
  country: string | null;
  country_code: string | null;
};

// Small in-process cache. Edge instances are short-lived; this only spares
// Nominatim repeated identical lookups within one instance's lifetime.
const cache = new Map<string, { at: number; hits: Hit[] }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  let body: { query?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (query.length < 2) {
    return json({ results: [] });
  }
  if (query.length > MAX_QUERY_LEN) {
    return json({ error: "query too long" }, 400);
  }

  const key = query.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return json({ results: cached.hits });
  }

  try {
    const params = new URLSearchParams({
      q: query,
      format: "jsonv2",
      limit: "5",
      addressdetails: "1",
    });

    const res = await fetch(`${NOMINATIM}?${params}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });

    if (!res.ok) {
      return json({ results: [], error: "geocoder unavailable" }, 200);
    }

    const rows = await res.json();
    const hits: Hit[] = (Array.isArray(rows) ? rows : [])
      .map((r: Record<string, any>) => {
        const lat = parseFloat(r?.lat);
        const lng = parseFloat(r?.lon);
        if (isNaN(lat) || isNaN(lng)) return null;
        return {
          name: typeof r?.display_name === "string" ? r.display_name : query,
          latitude: lat,
          longitude: lng,
          country: r?.address?.country ?? null,
          country_code: r?.address?.country_code ?? null,
        };
      })
      .filter((h): h is Hit => h !== null);

    cache.set(key, { at: Date.now(), hits });
    return json({ results: hits });
  } catch (err) {
    console.error("geocode failed", err);
    return json({ results: [], error: "geocoder unavailable" }, 200);
  }
});
