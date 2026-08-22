import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, BookOpen, CheckSquare, Info, MapPin } from "lucide-react";
import { Footer, Header } from "../components/Layout";
import { LocationSearch, type Resolved } from "../components/LocationSearch";
import { StoryCard } from "../components/StoryCard";
import { useFeaturedStories, useLocations } from "../lib/queries";
import { exploreHref, lastExploreHref } from "../lib/utils";

const PILLARS = [
  {
    icon: BookOpen,
    title: "What happened",
    body: "A short, factual summary of a real reported development, written from the original article and nothing else.",
  },
  {
    icon: Info,
    title: "Why it matters",
    body: "The significance behind the headline, so that a good story is more than a feel-good moment.",
  },
  {
    icon: CheckSquare,
    title: "What you can do",
    body: "Three realistic actions tied to that specific story. No empty gestures, no petitions to nowhere.",
  },
];

export default function Home() {
  const navigate = useNavigate();
  const { data: locations = [] } = useLocations();
  const {
    data: featured = [],
    isLoading: featuredLoading,
    isError: featuredError,
  } = useFeaturedStories(6);

  function go(place: Resolved) {
    // Navigation only. No Firecrawl, no OpenAI, no waiting.
    navigate(exploreHref(place));
  }

  const showGrid = featuredLoading || featured.length > 0;

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header and hero share one dark band; the seam between them must not
          show, so they live in the same element. */}
      <div className="bg-forest text-forest-foreground">
        <Header />

        {/* max-w-4xl, not 3xl: at 92px the first line of the headline needs
            ~900px to stay on one line, which is how the design breaks it. */}
        <section className="mx-auto flex max-w-4xl flex-col items-center gap-6 px-6 pb-16 pt-12 text-center sm:pb-[74px] sm:pt-[62px]">
          {locations.length > 0 && (
            <p className="inline-flex h-8 items-center gap-2.5 rounded-full border border-forest-foreground/15 px-4 text-xs font-medium text-forest-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              Verified stories from {locations.length}{" "}
              {locations.length === 1 ? "place" : "places"}
            </p>
          )}

          <h1 className="display animate-fade-up text-5xl leading-[0.96] tracking-[-0.025em] sm:text-[76px] lg:text-[92px]">
            Good things are happening{" "}
            {/* Its own line from sm up, exactly as the design breaks it. */}
            <span className="italic text-forest-accent sm:block">everywhere.</span>
          </h1>

          <p className="max-w-lg text-pretty text-base leading-[1.6] text-forest-muted sm:text-lg">
            Search any city and see what is actually getting better there — every
            story linked to the publication that reported it.
          </p>

          <div className="mt-2 w-full max-w-xl">
            <LocationSearch
              onResolved={go}
              action="Search"
              placeholder="Try Mumbai, Cayenne or New York"
              pill
              autoFocus
            />
          </div>

          {locations.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <span className="text-[13px] text-forest-muted/80">or jump to</span>
              {locations.slice(0, 4).map((l) => (
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
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-forest-foreground/15 px-3.5 text-[13px] font-medium text-forest-foreground/90 transition hover:border-forest-foreground/40"
                >
                  <MapPin className="h-3.5 w-3.5 text-forest-muted" />
                  {l.name.split(",")[0]}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      <main className="flex-1">
        {showGrid && (
          <section className="mx-auto max-w-7xl px-6 pt-12 sm:pt-[52px]">
            <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="display text-[34px] leading-[1.03] sm:text-[40px]">
                  Good news worth knowing
                </h2>
                <p className="mt-1.5 text-[15px] text-muted-foreground">
                  Real stories of positive change, with the evidence and what you
                  can do about it.
                </p>
              </div>
              <Link
                to={lastExploreHref()}
                className="inline-flex h-11 items-center gap-2 rounded-full border border-input bg-card px-5 text-sm font-semibold transition hover:border-primary/40"
              >
                View all
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            {featuredError ? (
              <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
                Could not reach the story database. The map still works —{" "}
                <Link to={lastExploreHref()} className="font-semibold text-primary underline">
                  try exploring
                </Link>
                .
              </p>
            ) : (
              <div className="grid gap-[22px] sm:grid-cols-2 lg:grid-cols-3">
                {featuredLoading
                  ? Array.from({ length: 6 }, (_, i) => <CardSkeleton key={i} />)
                  : featured.map((story) => (
                      <StoryCard key={story.id} story={story} variant="feature" />
                    ))}
              </div>
            )}
          </section>
        )}

        <section className="mx-auto max-w-7xl px-6 pb-16 pt-14 sm:pt-[58px]">
          <div className="grid gap-[22px] rounded-2xl border border-border bg-card p-7 sm:grid-cols-3 sm:p-[34px]">
            {PILLARS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex flex-col gap-3">
                <span className="grid h-[42px] w-[42px] place-items-center rounded-md bg-accent text-accent-foreground">
                  <Icon className="h-5 w-5" strokeWidth={1.8} />
                </span>
                <h3 className="display text-[26px] leading-[1.1]">{title}</h3>
                <p className="text-sm leading-[1.7] text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="aspect-[16/10] animate-pulse bg-muted" />
      <div className="space-y-3 p-4 sm:px-[18px]">
        <div className="h-3 w-1/3 animate-pulse rounded-sm bg-muted" />
        <div className="h-5 w-5/6 animate-pulse rounded-sm bg-muted" />
        <div className="h-3 w-full animate-pulse rounded-sm bg-muted" />
        <div className="h-3 w-4/6 animate-pulse rounded-sm bg-muted" />
      </div>
    </div>
  );
}
