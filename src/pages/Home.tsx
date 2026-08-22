import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, LayoutGrid, MapPin, Sparkle } from "lucide-react";
import { Footer, Header } from "../components/Layout";
import { LocationSearch, type Resolved } from "../components/LocationSearch";
import { StoryCard } from "../components/StoryCard";
import { useFeaturedStories, useLocations } from "../lib/queries";
import { exploreHref } from "../lib/utils";

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
      <Header />

      <main className="flex-1">
        <section className="relative overflow-hidden">
          {/* Restrained atmosphere: a single soft wash, no gimmicks. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(70%_60%_at_50%_-10%,hsl(var(--accent))_0%,transparent_70%)]"
          />

          <div className="mx-auto max-w-3xl px-6 pb-16 pt-16 text-center sm:pt-24">
            <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-card px-3.5 py-1.5 text-xs font-medium text-primary">
              <Sparkle className="h-3.5 w-3.5" />
              Positive news, real-world impact
            </p>

            <h1 className="animate-fade-up font-display text-4xl font-bold leading-[1.08] tracking-tight sm:text-6xl">
              Good things are happening{" "}
              {/* Its own line from sm up, exactly as the mockup breaks it. */}
              <span className="text-primary sm:block">everywhere.</span>
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg">
              Discover positive change and real-world solutions from around the
              globe — and see how AI could help create more of them.
            </p>

            <div className="mx-auto mt-9 max-w-xl">
              <LocationSearch
                onResolved={go}
                action="Search"
                placeholder="Search a city — e.g. New York, Tokyo, Amsterdam"
                pill
                autoFocus
              />
            </div>

            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link
                to="/explore"
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
              >
                Explore Stories
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/submit"
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-2.5 text-sm font-semibold text-foreground transition hover:border-primary/40 hover:bg-accent"
              >
                <Sparkle className="h-4 w-4" />
                Share Good News
              </Link>
            </div>

            {/* Only shown when the grid below cannot be: never a dead section. */}
            {!showGrid && locations.length > 0 && (
              <div className="mt-10">
                <p className="mb-2.5 text-xs uppercase tracking-wide text-muted-foreground">
                  Start with
                </p>
                <div className="flex flex-wrap justify-center gap-2">
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
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-sm text-foreground transition hover:border-primary/40 hover:bg-accent"
                    >
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                      {l.name.split(",")[0]}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {showGrid && (
          <section className="mx-auto max-w-7xl px-6 pb-20">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
                  Good News Worth Knowing
                </h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Real stories of positive change, with evidence and lessons you
                  can use.
                </p>
              </div>
              <Link
                to="/explore"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground"
              >
                View all
                <LayoutGrid className="h-4 w-4" />
              </Link>
            </div>

            {featuredError ? (
              <p className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
                Could not reach the story database. The map still works —{" "}
                <Link to="/explore" className="text-primary underline">
                  try exploring
                </Link>
                .
              </p>
            ) : (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {featuredLoading
                  ? Array.from({ length: 6 }, (_, i) => <CardSkeleton key={i} />)
                  : featured.map((story) => (
                      <StoryCard key={story.id} story={story} variant="feature" />
                    ))}
              </div>
            )}
          </section>
        )}

        <section className="mx-auto max-w-5xl px-6 pb-24">
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              {
                title: "What happened",
                body: "A short, factual summary of a real reported development, written from the original article.",
              },
              {
                title: "Why it matters",
                body: "The significance behind the headline, so a good story is more than a feel-good moment.",
              },
              {
                title: "What you can do",
                body: "Three realistic, concrete actions tied to that specific story. No empty gestures.",
              },
            ].map((c) => (
              <div key={c.title} className="rounded-2xl border border-border bg-card p-5">
                <h3 className="font-display text-base font-bold">{c.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{c.body}</p>
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
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="aspect-[16/10] animate-pulse bg-muted" />
      <div className="space-y-3 p-5">
        <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
        <div className="h-3 w-full animate-pulse rounded bg-muted" />
        <div className="h-3 w-4/6 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}
