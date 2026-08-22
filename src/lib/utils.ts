import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const SESSION_KEY = "gnam_session";

/** Stable anonymous id so one visitor cannot inflate a story's rating. */
export function getSessionId(): string {
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    // Private mode / storage blocked — fall back to a per-tab id.
    return "ephemeral-" + Math.random().toString(36).slice(2, 14);
  }
}

/**
 * Share a link: the native sheet where there is one, the clipboard otherwise,
 * and a prompt when even that is blocked. The caller decides what to show —
 * "copied" is the only outcome that needs feedback in the UI.
 */
export async function shareUrl(
  url: string,
  title: string,
): Promise<"shared" | "copied" | "prompted"> {
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return "shared";
    } catch {
      // Sheet dismissed, or sharing refused — fall through to copying.
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    window.prompt("Copy this link:", url);
    return "prompted";
  }
}

export function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  // The interface is English throughout, so the date is too. Reading the
  // visitor's locale here produced French dates on an English page.
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** JSONB columns arrive as arrays, but stay defensive about shape. */
export function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  }
  return [];
}

const LAST_EXPLORE_KEY = "gnam_last_explore";

/**
 * Remember the place the visitor was looking at, so "Back to the map" returns
 * them to that map rather than to an empty one.
 *
 * Explore is a full-height page with its own scrolling panel, so landing on it
 * with no location shows a prompt and nothing else — and since the page itself
 * cannot scroll, that dead end reads as a frozen tab. Session storage rather
 * than router state because a story reached by a deep link has no history to
 * go back to.
 */
export function rememberExplore(search: string): void {
  try {
    if (search) sessionStorage.setItem(LAST_EXPLORE_KEY, search);
  } catch {
    // Private mode. The back link falls back to a bare /explore.
  }
}

/** The remembered query string, including its "?", or "" if there is none. */
export function lastExploreSearch(): string {
  try {
    return sessionStorage.getItem(LAST_EXPLORE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function lastExploreHref(): string {
  return `/explore${lastExploreSearch()}`;
}

/**
 * The one place the /explore query string is built. Takes the fields of a
 * resolved place rather than the component's type, so lib does not depend on
 * components.
 */
export function exploreHref(place: {
  name: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
}): string {
  const params = new URLSearchParams({
    name: place.name,
    lat: String(place.latitude),
    lng: String(place.longitude),
    radius: String(place.radiusKm),
  });
  return `/explore?${params.toString()}`;
}
