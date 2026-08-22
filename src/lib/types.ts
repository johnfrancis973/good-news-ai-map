import {
  GraduationCap,
  HeartPulse,
  Leaf,
  Lightbulb,
  Newspaper,
  Users,
  type LucideIcon,
} from "lucide-react";

export const CATEGORIES = [
  "environment",
  "community",
  "education",
  "health",
  "innovation",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  environment: "Environment",
  community: "Community",
  education: "Education",
  health: "Health",
  innovation: "Innovation",
  other: "Other",
};

// Marker + chip colours. Deliberately muted — optimistic, not childish.
export const CATEGORY_COLORS: Record<Category, string> = {
  environment: "#2f855a",
  community: "#2b6cb0",
  education: "#6b46c1",
  health: "#c05621",
  innovation: "#0f766e",
  other: "#4a5568",
};

// One icon per category, used on chips and as the stand-in when a story has no
// image. Kept beside the colours so the two never drift apart.
export const CATEGORY_ICONS: Record<Category, LucideIcon> = {
  environment: Leaf,
  community: Users,
  education: GraduationCap,
  health: HeartPulse,
  innovation: Lightbulb,
  other: Newspaper,
};

export function categoryOf(value: string | null | undefined): Category {
  return (CATEGORIES as readonly string[]).includes(value ?? "")
    ? (value as Category)
    : "other";
}

/** Shape returned by the get_nearby_stories RPC — list/map view. */
export type StorySummary = {
  id: string;
  title: string;
  source_url: string;
  source_name: string | null;
  published_at: string | null;
  location_name: string | null;
  latitude: number;
  longitude: number;
  category: string | null;
  summary: string | null;
  why_it_matters: string | null;
  ai_relevance: boolean;
  image_url: string | null;
  distance_km: number;
};

/** Full published story — detail view. */
export type Story = {
  id: string;
  title: string;
  source_url: string;
  source_name: string | null;
  published_at: string | null;
  location_id: string | null;
  location_name: string | null;
  latitude: number;
  longitude: number;
  category: string | null;
  summary: string | null;
  why_it_matters: string | null;
  lessons: string[] | null;
  actions: string[] | null;
  future_outlook: string | null;
  ai_relevance: boolean;
  ai_outlook: string | null;
  image_url: string | null;
  confidence_score: number | null;
  status: string;
  created_at: string;
};

export type LocationRow = {
  id: string;
  name: string;
  normalized_name: string | null;
  country: string | null;
  country_code: string | null;
  latitude: number;
  longitude: number;
  default_radius_km: number | null;
  last_ingested_at: string | null;
};

export type RatingCounts = { useful: number; not_useful: number };

/**
 * What a visitor sends to the suggestion queue. Never read back.
 *
 * The coordinates are what let the link be checked automatically: geography is
 * a hard filter in the validator, so without a resolved place there is nothing
 * to check the article against and the suggestion waits for a human instead.
 */
export type SupportRequest = {
  intent: "sponsor" | "donate";
  supporter: string;
  email: string;
  amount?: string;
  message?: string;
};

export type Suggestion = {
  url: string;
  place: string;
  submitter?: string;
  note?: string;
  latitude?: number | null;
  longitude?: number | null;
};
