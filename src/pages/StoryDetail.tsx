import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Link2,
  Loader2,
  MapPin,
  Share2,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { Footer, Header } from "../components/Layout";
import { useRateStory, useStory, useStoryRatings } from "../lib/queries";
import { CATEGORY_COLORS, CATEGORY_LABELS, categoryOf } from "../lib/types";
import { asStringList, cn, formatDate, getSessionId, hostnameOf } from "../lib/utils";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-border pt-6">
      <h2 className="mb-2.5 text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

export default function StoryDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: story, isLoading, isError } = useStory(id);
  const { data: ratings } = useStoryRatings(id);
  const rate = useRateStory(id);

  const [myVote, setMyVote] = useState<1 | -1 | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (story?.title) document.title = `${story.title} · Good News AI Map`;
    return () => {
      document.title = "Good News AI Map";
    };
  }, [story?.title]);

  async function share() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: story?.title ?? "Good News AI Map", url });
        return;
      } catch {
        // User dismissed the share sheet — fall through to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      window.prompt("Copy this link:", url);
    }
  }

  function vote(value: 1 | -1) {
    setMyVote(value);
    rate.mutate({ rating: value, sessionId: getSessionId() });
  }

  if (isLoading) {
    return (
      <Shell>
        <div className="flex items-center gap-2 py-24 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading story
        </div>
      </Shell>
    );
  }

  // A processing or rejected story is invisible at the database level, so it
  // reaches this branch and is simply "not found".
  if (isError || !story) {
    return (
      <Shell>
        <div className="py-24 text-center">
          <h1 className="text-xl font-semibold">Story not available</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This story may not be published, or the link may be wrong.
          </p>
          <Link
            to="/explore"
            className="mt-6 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Explore the map
          </Link>
        </div>
      </Shell>
    );
  }

  const category = categoryOf(story.category);
  const lessons = asStringList(story.lessons);
  const actions = asStringList(story.actions);
  const date = formatDate(story.published_at);
  const publisher = story.source_name || hostnameOf(story.source_url);
  const showAi = story.ai_relevance === true && Boolean(story.ai_outlook);

  return (
    <Shell>
      <article className="py-8">
        <Link
          to="/explore"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to the map
        </Link>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white"
            style={{ backgroundColor: CATEGORY_COLORS[category] }}
          >
            {CATEGORY_LABELS[category]}
          </span>
          {story.location_name && (
            <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              {story.location_name}
            </span>
          )}
          {date && <span className="text-sm text-muted-foreground">{date}</span>}
        </div>

        <h1 className="text-balance text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          {story.title}
        </h1>

        <p className="mt-3 text-sm text-muted-foreground">
          Reported by{" "}
          <a
            href={story.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
          >
            {publisher}
          </a>
        </p>

        {story.image_url && (
          <img
            src={story.image_url}
            alt=""
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
            className="mt-6 aspect-[16/8] w-full rounded-xl border border-border object-cover"
          />
        )}

        <div className="prose-block mt-8 space-y-6">
          <Section title="What happened?">
            <p>{story.summary}</p>
          </Section>

          {story.why_it_matters && (
            <Section title="Why does this matter?">
              <p>{story.why_it_matters}</p>
            </Section>
          )}

          {lessons.length > 0 && (
            <Section title="What can I learn?">
              <ul className="space-y-2.5">
                {lessons.map((lesson, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-semibold text-accent-foreground">
                      {i + 1}
                    </span>
                    <span className="text-[15px] leading-7 text-foreground/85">{lesson}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {actions.length > 0 && (
            <Section title="What can I do?">
              <ul className="grid gap-3 sm:grid-cols-3">
                {actions.map((action, i) => (
                  <li
                    key={i}
                    className="rounded-xl border border-border bg-card p-4 text-sm leading-6"
                  >
                    <span className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Action {i + 1}
                    </span>
                    {action}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {story.future_outlook && (
            <Section title="What could happen next?">
              <div className="rounded-xl border border-dashed border-border bg-muted/50 p-4">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Forward-looking — not established fact
                </p>
                <p>{story.future_outlook}</p>
              </div>
            </Section>
          )}

          {/* Only rendered when the model found a genuine AI angle. */}
          {showAi && (
            <Section title="How could AI help?">
              <div className="rounded-xl border border-primary/25 bg-accent/60 p-4">
                <p className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent-foreground">
                  <Sparkles className="h-3.5 w-3.5" />
                  Speculative
                </p>
                <p>{story.ai_outlook}</p>
              </div>
            </Section>
          )}
        </div>

        {/* Source block */}
        <section className="mt-10 rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Original source</h2>
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Row label="Article" value={story.title} />
            <Row label="Publisher" value={publisher} />
            <Row label="Published" value={date ?? "Not stated"} />
            <Row label="Location" value={story.location_name ?? "Not stated"} />
            <Row label="Category" value={CATEGORY_LABELS[category]} />
          </dl>
          <a
            href={story.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-medium transition hover:border-primary/40 hover:bg-accent"
          >
            Read the original article
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </section>

        {/* Feedback + share */}
        <section className="mt-6 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => vote(1)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium transition",
              myVote === 1
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border hover:bg-muted",
            )}
          >
            <ThumbsUp className="h-4 w-4" />
            Useful
            {ratings && ratings.useful > 0 && (
              <span className="opacity-70">{ratings.useful}</span>
            )}
          </button>

          <button
            type="button"
            onClick={() => vote(-1)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium transition",
              myVote === -1
                ? "border-foreground bg-foreground text-background"
                : "border-border hover:bg-muted",
            )}
          >
            <ThumbsDown className="h-4 w-4" />
            Not useful
            {ratings && ratings.not_useful > 0 && (
              <span className="opacity-70">{ratings.not_useful}</span>
            )}
          </button>

          <button
            type="button"
            onClick={share}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-medium transition hover:bg-muted"
          >
            {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
            {copied ? "Link copied" : "Share"}
          </button>

          {rate.isError && (
            <span className="text-xs text-muted-foreground">
              Could not save your rating.
            </span>
          )}
        </section>

        <p className="mt-6 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
          <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Summary, lessons and actions on this page are generated by AI from the
          linked source article. Facts belong to the publisher; always follow the
          link for the full report.
        </p>
      </article>
    </Shell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-foreground">{value}</dd>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 sm:px-6">{children}</main>
      <Footer />
    </div>
  );
}
