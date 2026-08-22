import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Compass, Loader2, MapPin } from "lucide-react";
import { Header } from "../components/Layout";
import { LocationSearch, type Resolved } from "../components/LocationSearch";
import { CategoryFilter } from "../components/CategoryFilter";
import { StoryCard } from "../components/StoryCard";
import { StoryMap } from "../components/StoryMap";
import { useLocations, useNearbyStories } from "../lib/queries";
import { categoryOf, type Category } from "../lib/types";
import { lastExploreSearch, rememberExplore } from "../lib/utils";

export default function Explore() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const name = params.get("name") ?? "";
  const lat = params.get("lat") ? Number(params.get("lat")) : null;
  const lng = params.get("lng") ? Number(params.get("lng")) : null;
  const radius = Number(params.get("radius") ?? 50) || 50;

  const [category, setCategory] = useState<Category | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Only a map interaction should scroll the panel; hovering a card must not
  // yank the list out from under the user.
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const { data: locations = [] } = useLocations();
  const { data: stories = [], isLoading, isError } = useNearbyStories(lat, lng, radius, null);

  const counts = useMemo(() => {
    const acc: Partial<Record<Category, number>> = {};
    for (const s of stories) {
      const c = categoryOf(s.category);
      acc[c] = (acc[c] ?? 0) + 1;
    }
    return acc;
  }, [stories]);

  const visible = useMemo(
    () => (category ? stories.filter((s) => categoryOf(s.category) === category) : stories),
    [stories, category],
  );

  // Remember where the visitor was, so a story's "Back to the map" comes back
  // to this map rather than to the empty one.
  useEffect(() => {
    if (lat !== null && lng !== null) rememberExplore(`?${params.toString()}`);
  }, [params, lat, lng]);

  // Arriving at a bare /explore — from the nav, "View all", or a link that
  // lost its query — restores the last place instead of showing an empty
  // page. Only ever runs once per visit: writing the params makes lat and lng
  // non-null, so the condition cannot hold a second time.
  useEffect(() => {
    if (lat !== null || lng !== null) return;
    const remembered = lastExploreSearch();
    if (remembered) setParams(new URLSearchParams(remembered), { replace: true });
  }, [lat, lng, setParams]);

  // Clicking a marker scrolls its card into view.
  useEffect(() => {
    if (!scrollTarget) return;
    cardRefs.current[scrollTarget]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [scrollTarget]);

  function go(place: Resolved) {
    setCategory(null);
    setActiveId(null);
    setScrollTarget(null);
    setParams({
      name: place.name,
      lat: String(place.latitude),
      lng: String(place.longitude),
      radius: String(place.radiusKm),
    });
  }

  const center: [number, number] = [lat ?? 4.9227, lng ?? -52.3269];
  const hasLocation = lat !== null && lng !== null;
  const place = name.split(",")[0];

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Header active="explore" className="shrink-0" />

      <div className="shrink-0 border-b border-border bg-background">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3.5 sm:px-6 lg:h-[68px] lg:flex-row lg:items-center lg:justify-between lg:gap-6 lg:py-0">
          <div className="w-full lg:max-w-sm">
            <LocationSearch onResolved={go} size="md" action="Go" />
          </div>
          <div className="-mx-4 flex items-center gap-3 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <CategoryFilter value={category} counts={counts} onChange={setCategory} />
          </div>
        </div>
      </div>

      <main className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        {/* Map — 40vh on mobile, half the width on desktop. The map used to
            take the remaining space, which put it above 65% on a laptop and
            squeezed the stories into a strip. The stories are the content;
            the map is the index. */}
        <div className="h-[40vh] shrink-0 border-b border-border lg:h-auto lg:w-1/2 lg:border-b-0 lg:border-r xl:w-[55%]">
          {hasLocation ? (
            <StoryMap
              center={center}
              stories={visible}
              activeId={activeId}
              onMarkerClick={(id) => {
                setActiveId(id);
                setScrollTarget(id);
              }}
              onMarkerHover={(id) => id && setActiveId(id)}
            />
          ) : (
            <div className="grid h-full place-items-center bg-muted/40 p-8 text-center">
              <div className="flex max-w-xs flex-col items-center gap-4">
                <span className="grid h-14 w-14 place-items-center rounded-full bg-accent text-accent-foreground">
                  <Compass className="h-6 w-6" strokeWidth={1.6} />
                </span>
                <p className="display text-2xl leading-[1.12]">
                  Search a place to see what is getting better there.
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {locations.slice(0, 3).map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() =>
                        go({
                          name: l.name,
                          latitude: l.latitude,
                          longitude: l.longitude,
                          radiusKm: l.default_radius_km ?? 50,
                        })
                      }
                      className="inline-flex h-9 items-center rounded-full border border-input bg-card px-3.5 text-[13px] font-semibold transition hover:border-primary/40"
                    >
                      {l.name.split(",")[0]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Story panel */}
        <aside className="thin-scroll flex-1 overflow-y-auto">
          {hasLocation && (
            <div className="flex items-end justify-between gap-4 border-b border-border px-5 py-4 sm:px-[22px]">
              <div className="min-w-0">
                <h1 className="display truncate text-[30px] leading-[1.05]">
                  {place || "Selected area"}
                </h1>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  {isLoading
                    ? "Loading…"
                    : `${visible.length} ${visible.length === 1 ? "story" : "stories"} within ${radius} km`}
                </p>
              </div>
            </div>
          )}

          <div className="p-4 sm:p-[22px]">
            {isLoading && (
              <div className="flex flex-col gap-2.5">
                {/* The wording is deliberate: this is a database read, not a
                    model call. Nothing on this page is generated while you wait. */}
                <div className="flex items-center gap-2.5 pb-1 text-[13px] font-semibold text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Reading stories from the database
                </div>
                {Array.from({ length: 3 }, (_, i) => (
                  <RowSkeleton key={i} />
                ))}
              </div>
            )}

            {isError && (
              <div className="rounded-md border border-border bg-card p-5 text-sm text-muted-foreground">
                Could not reach the story database. Try again in a moment.
              </div>
            )}

            {/* Empty state — instant. We never hold the user while ingestion runs. */}
            {hasLocation && !isLoading && !isError && visible.length === 0 && (
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
                <h2 className="text-[15px] font-bold leading-snug">
                  No recent positive stories here yet.
                </h2>
                <p className="text-[13px] leading-[1.65] text-muted-foreground">
                  {category
                    ? "Nothing in this category here yet. Try another category, or another place."
                    : "We have not gathered stories for this area. Nothing is being fetched right now — these places are ready:"}
                </p>

                {category ? (
                  <button
                    type="button"
                    onClick={() => setCategory(null)}
                    className="inline-flex h-11 w-fit items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:brightness-95"
                  >
                    Show all categories
                  </button>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {locations.slice(0, 6).map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() =>
                          go({
                            name: l.name,
                            latitude: l.latitude,
                            longitude: l.longitude,
                            radiusKm: l.default_radius_km ?? 50,
                          })
                        }
                        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-input bg-background px-3.5 text-[13px] font-semibold transition hover:border-primary/40"
                      >
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                        {l.name.split(",")[0]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2.5">
              {visible.map((story) => (
                <StoryCard
                  key={story.id}
                  story={story}
                  active={activeId === story.id}
                  onHover={setActiveId}
                  onSelect={(id) => navigate(`/story/${id}`)}
                  ref={(el) => {
                    cardRefs.current[story.id] = el;
                  }}
                />
              ))}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}

function RowSkeleton() {
  return (
    <div className="flex gap-3.5 rounded-md border border-border/70 bg-card p-3.5">
      <div className="h-16 w-16 shrink-0 animate-pulse rounded-sm bg-muted" />
      <div className="flex flex-1 flex-col gap-2 pt-1">
        <div className="h-2.5 w-2/5 animate-pulse rounded-sm bg-muted" />
        <div className="h-3 w-11/12 animate-pulse rounded-sm bg-muted" />
        <div className="h-3 w-3/5 animate-pulse rounded-sm bg-muted" />
      </div>
    </div>
  );
}
