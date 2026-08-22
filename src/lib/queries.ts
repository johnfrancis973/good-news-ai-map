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
 * site: an operator still has to harvest and validate the article before
 * anything appears on the map. `submit_suggestion` is a security-definer
 * function over a table anon cannot read, so nothing submitted can be read
 * back — not by the submitter, not by anyone else.
 */
export function useSubmitSuggestion() {
  return useMutation({
    mutationFn: async (input: Suggestion): Promise<void> => {
      const { error } = await supabase.rpc("submit_suggestion", {
        p_url: input.url,
        p_place: input.place,
        p_submitter: input.submitter || null,
        p_note: input.note || null,
        p_session_id: getSessionId(),
      });
      if (error) throw error;
    },
  });
}

// Place lookup lives in ./geocode, re-exported here so callers have one import.
export { geocodePlace } from "./geocode";
export type { GeocodeHit } from "./geocode";
