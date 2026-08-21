import { useNavigate } from "react-router-dom";
import { MapPin } from "lucide-react";
import { Footer, Header } from "../components/Layout";
import { LocationSearch, type Resolved } from "../components/LocationSearch";
import { useLocations } from "../lib/queries";

export default function Home() {
  const navigate = useNavigate();
  const { data: locations = [] } = useLocations();

  function go(place: Resolved) {
    // Navigation only. No Firecrawl, no OpenAI, no waiting.
    const params = new URLSearchParams({
      name: place.name,
      lat: String(place.latitude),
      lng: String(place.longitude),
      radius: String(place.radiusKm),
    });
    navigate(`/explore?${params.toString()}`);
  }

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

          <div className="mx-auto max-w-3xl px-6 pb-16 pt-20 text-center sm:pt-28">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              Real stories, real sources
            </p>

            <h1 className="animate-fade-up text-balance text-4xl font-bold leading-[1.1] tracking-tight sm:text-6xl">
              See what&rsquo;s getting better around you.
            </h1>

            <p className="mx-auto mt-5 max-w-2xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg">
              Discover real positive stories near you, understand why they matter,
              and find simple ways to take part.
            </p>

            <div className="mx-auto mt-9 max-w-xl">
              <LocationSearch onResolved={go} autoFocus />
            </div>

            {locations.length > 0 && (
              <div className="mt-6">
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

        <section className="mx-auto max-w-5xl px-6 pb-20">
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
              <div key={c.title} className="rounded-xl border border-border bg-card p-5">
                <h2 className="text-sm font-semibold">{c.title}</h2>
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
