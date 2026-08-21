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

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Header />

      <div className="border-b border-border bg-background/95">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="w-full lg:max-w-md">
            <LocationSearch onResolved={go} size="md" />
          </div>
          <div className="flex items-center gap-3 overflow-x-auto">
            <CategoryFilter value={category} counts={counts} onChange={setCategory} />
          </div>
        </div>
      </div>

      <main className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        {/* Map — 45vh on mobile, a fixed column on desktop. */}
        <div className="h-[45vh] shrink-0 border-b border-border lg:h-auto lg:flex-1 lg:border-b-0 lg:border-r">
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
            <div className="grid h-full place-items-center p-8 text-center text-sm text-muted-foreground">
              <div>
                <Compass className="mx-auto mb-3 h-7 w-7" />
                Search a place to see what is getting better there.
              </div>
            </div>
          )}
        </div>

        {/* Story panel */}
        <aside className="thin-scroll flex-1 overflow-y-auto lg:max-w-[460px] xl:max-w-[520px]">
          <div className="p-4 sm:p-5">
            {hasLocation && (
              <div className="mb-4">
                <h1 className="text-lg font-semibold tracking-tight">
                  {name || "Selected area"}
                </h1>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {isLoading
                    ? "Loading stories…"
                    : `${visible.length} ${visible.length === 1 ? "story" : "stories"} within ${radius} km`}
                </p>
              </div>
            )}

            {isLoading && (
              <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Reading stories from the database
              </div>
            )}

            {isError && (
              <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
                Could not reach the story database. Try again in a moment.
              </div>
            )}

            {/* Empty state — instant. We never hold the user while ingestion runs. */}
            {hasLocation && !isLoading && !isError && visible.length === 0 && (
              <div className="rounded-xl border border-border bg-card p-6">
                <h2 className="text-base font-semibold">
                  No recent positive stories found here yet.
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {category
                    ? "Nothing in this category here yet. Try another category, or another place."
                    : "We have not gathered stories for this area yet. These places are ready now:"}
                </p>

                {category ? (
                  <button
                    type="button"
                    onClick={() => setCategory(null)}
                    className="mt-4 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                  >
                    Show all categories
                  </button>
                ) : (
                  <div className="mt-4 flex flex-wrap gap-2">
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
                        className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm transition hover:border-primary/40 hover:bg-accent"
                      >
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                        {l.name.split(",")[0]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-3">
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
