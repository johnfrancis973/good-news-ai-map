// LOOP B — the READ path.
//
// Every function here talks to Postgres and nothing else. There is deliberately
// no Firecrawl and no OpenAI import in this file or anywhere under src/: if both
// APIs went offline right now, every already-published story would still browse
// perfectly.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { LocationRow, RatingCounts, Story, StorySummary, Suggestion } from "./types";
import { getSessionId } from "./utils";

const STORY_FIELDS =
  "id,title,source_url,source_name,published_at,location_id,location_name," +
  "latitude,longitude,category,summary,why_it_matters,lessons,actions," +
  "future_outlook,ai_relevance,ai_outlook,image_url,confidence_score,status,created_at";

/** A full story row narrowed to what the card components read. */
function toSummary(s: Story): StorySummary {
  return {
    id: s.id,
    title: s.title,
    source_url: s.source_url,
    source_name: s.source_name,
    published_at: s.published_at,
    location_name: s.location_name,
    latitude: s.latitude,
    longitude: s.longitude,
    category: s.category,
    summary: s.summary,
    why_it_matters: s.why_it_matters,
    ai_relevance: s.ai_relevance,
    image_url: s.image_url,
    distance_km: 0,
  };
}

/** Published stories near a point. Radius filtering happens in Postgres. */
export function useNearbyStories(
  lat: number | null,
  lng: number | null,
  radiusKm: number,
  category: string | null,
) {
  return useQuery({
    queryKey: ["nearby", lat, lng, radiusKm, category],
    enabled: lat !== null && lng !== null,
    staleTime: 60_000,
    queryFn: async (): Promise<StorySummary[]> => {
      const { data, error } = await supabase.rpc("get_nearby_stories", {
        p_lat: lat,
        p_lng: lng,
        p_radius_km: radiusKm,
        p_category: category,
        p_limit: 150,
      });
      if (error) throw error;
      return (data ?? []) as StorySummary[];
    },
  });
}

/**
 * One story by id. RLS restricts SELECT to status = 'published', so an
 * unfinished or rejected story simply does not exist as far as this query is
 * concerned — the frontend is not what hides it.
 */
export function useStory(id: string | undefined) {
  return useQuery({
    queryKey: ["story", id],
    enabled: Boolean(id),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Story | null> => {
      const { data, error } = await supabase
        .from("stories")
        .select(STORY_FIELDS)
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return (data as Story | null) ?? null;
    },
  });
}

/**
 * The home page grid: the newest story from each location first, so four
 * locations are represented before any one of them repeats, then filled to
 * `limit` by date.
 *
 * No status filter. RLS already restricts SELECT to published rows, and adding
 * one here would suggest the frontend is what hides unpublished work. It is not.
 */
export function useFeaturedStories(limit = 6) {
  return useQuery({
    queryKey: ["featured", limit],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<StorySummary[]> => {
      const { data, error } = await supabase
        .from("stories")
        .select(STORY_FIELDS)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(40);
      if (error) throw error;

      // supabase-js types a select-with-string-fields loosely; the shape is
      // the same STORY_FIELDS list useStory reads.
      const rows = (data ?? []) as unknown as Story[];

      const seen = new Set<string>();
      const firstPerLocation: Story[] = [];
      const rest: Story[] = [];
      for (const row of rows) {
        const key = row.location_id ?? row.location_name ?? row.id;
        if (seen.has(key)) rest.push(row);
        else {
          seen.add(key);
          firstPerLocation.push(row);
        }
      }
      return [...firstPerLocation, ...rest].slice(0, limit).map(toSummary);
    },
  });
}

/** Locations that already have published stories — powers the home page. */
export function useLocations() {
  return useQuery({
    queryKey: ["locations"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<LocationRow[]> => {
      const { data, error } = await supabase
        .from("locations")
        .select("id,name,normalized_name,country,country_code,latitude,longitude,default_radius_km,last_ingested_at")
        .order("name");
      if (error) throw error;
      return (data ?? []) as LocationRow[];
    },
  });
}

export function useStoryRatings(storyId: string | undefined) {
  return useQuery({
    queryKey: ["ratings", storyId],
    enabled: Boolean(storyId),
    queryFn: async (): Promise<RatingCounts> => {
      const { data, error } = await supabase.rpc("get_story_ratings", {
        p_story_id: storyId,
      });
      if (error) throw error;
      return (data ?? { useful: 0, not_useful: 0 }) as RatingCounts;
    },
  });
}

export function useRateStory(storyId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { rating: 1 | -1; sessionId: string }): Promise<RatingCounts> => {
      const { data, error } = await supabase.rpc("rate_story", {
        p_story_id: storyId,
        p_session_id: input.sessionId,
        p_rating: input.rating,
      });
      if (error) throw error;
      return data as RatingCounts;
    },
    onSuccess: (counts) => {
      qc.setQueryData(["ratings", storyId], counts);
    },
  });
}

/**
 * The only other write the public is allowed. It reaches a queue, never the
 * site directly: the link is checked by the same pipeline every story on the
 * map went through, and only that pipeline can publish it.
 *
 * This returns as soon as the suggestion is logged — 202, not a verdict. The
 * checking happens after the response, server-side, so submitting never makes
 * anyone wait on Firecrawl or OpenAI. The queue stays sealed: there is no way
 * to read a suggestion back, not even your own.
 */
export function useSubmitSuggestion() {
  return useMutation({
    mutationFn: async (input: Suggestion): Promise<void> => {
      const { data, error } = await supabase.functions.invoke("submit-suggestion", {
        body: {
          url: input.url,
          place: input.place,
          submitter: input.submitter || null,
          note: input.note || null,
          session_id: getSessionId(),
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
        },
      });

      // A refusal arrives as a non-2xx body, not a thrown error, and the form
      // reads the message to tell "fix your input" from "try again later".
      // Re-throwing it as an Error keeps that distinction working.
      const refusal = (data as { error?: string } | null)?.error;
      if (refusal) throw new Error(refusal);
      if (error) {
        const body = await readFunctionError(error);
        throw new Error(body ?? error.message);
      }
    },
  });
}

/**
 * supabase-js wraps a non-2xx function response in a FunctionsHttpError and
 * hides the body on `context`. The body is where the Postgres message lives,
 * so without this every validation refusal would read as a network failure.
 */
async function readFunctionError(error: unknown): Promise<string | null> {
  const res = (error as { context?: Response } | null)?.context;
  if (!res || typeof res.json !== "function") return null;
  try {
    const body = await res.json();
    return typeof body?.error === "string" ? body.error : null;
  } catch {
    return null;
  }
}

// Place lookup lives in ./geocode, re-exported here so callers have one import.
export { geocodePlace } from "./geocode";
export type { GeocodeHit } from "./geocode";
