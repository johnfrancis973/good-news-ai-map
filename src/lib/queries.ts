// LOOP B — the READ path.
//
// Every function here talks to Postgres and nothing else. There is deliberately
// no Firecrawl and no OpenAI import in this file or anywhere under src/: if both
// APIs went offline right now, every already-published story would still browse
// perfectly.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { LocationRow, RatingCounts, Story, StorySummary } from "./types";

const STORY_FIELDS =
  "id,title,source_url,source_name,published_at,location_id,location_name," +
  "latitude,longitude,category,summary,why_it_matters,lessons,actions," +
  "future_outlook,ai_relevance,ai_outlook,image_url,confidence_score,status,created_at";

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

// Place lookup lives in ./geocode, re-exported here so callers have one import.
export { geocodePlace } from "./geocode";
export type { GeocodeHit } from "./geocode";
