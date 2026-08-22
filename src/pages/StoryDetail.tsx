import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Clock,
  ExternalLink,
  Link2,
  Loader2,
  MapPin,
  Share2,
  Sparkle,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { Footer, Header } from "../components/Layout";
import { useRateStory, useStory, useStoryRatings } from "../lib/queries";
import { CATEGORY_COLORS, CATEGORY_ICONS, CATEGORY_LABELS, categoryOf } from "../lib/types";
import { asStringList, cn, formatDate, getSessionId, hostnameOf, shareUrl } from "../lib/utils";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="display text-[26px] leading-[1.1] sm:text-[30px]">{title}</h2>
      {children}
    </section>
  );
}

/** Initials for the publisher badge — two words at most, letters only. */
function initialsOf(name: string): string {
  return (
    name
      .replace(/[^\p{L}\s]/gu, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?"
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
    const result = await shareUrl(
      window.location.href,
      story?.title ?? "Good News AI Map",
    );
    if (result === "copied") {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    }
  }

  function vote(value: 1 | -1) {
    setMyVote(value);
    rate.mutate({ rating: value, sessionId: getSessionId() });
  }

  if (isLoading) {
    return (
      <Shell>
        <div className="flex items-center gap-2.5 py-24 text-[13px] font-semibold text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Reading this story from the database
        </div>
      </Shell>
    );
  }

  // A processing or rejected story is invisible at the database level, so it
  // reaches this branch and is simply "not found".
  if (isError || !story) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-4 py-24 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-muted text-muted-foreground">
            <Link2 className="h-6 w-6" strokeWidth={1.6} />
          </span>
          <h1 className="display text-[28px] leading-[1.1]">Story not available</h1>
          <p className="max-w-xs text-[13px] leading-[1.65] text-muted-foreground">
            This story may not be published, or the link may be wrong.
          </p>
          <Link
            to="/explore"
            className="inline-flex h-11 items-center rounded-full bg-forest px-5 text-sm font-semibold text-forest-foreground transition hover:brightness-110"
          >
            Explore the map
          </Link>
        </div>
      </Shell>
    );
  }

  const category = categoryOf(story.category);
  const CategoryIcon = CATEGORY_ICONS[category];
  const colour = CATEGORY_COLORS[category];
  const lessons = asStringList(story.lessons);
  const actions = asStringList(story.actions);
  const date = formatDate(story.published_at);
  const publisher = story.source_name || hostnameOf(story.source_url);
  const showAi = story.ai_relevance === true && Boolean(story.ai_outlook);

  return (
    <Shell>
      <article className="pb-16 pt-8">
        <Link
          to="/explore"
          className="mb-7 inline-flex h-9 items-center gap-2 rounded-full border border-input bg-card pl-3 pr-4 text-[13px] font-semibold text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to the map
        </Link>

        <div className="mb-4 flex flex-wrap items-center gap-x-2.5 gap-y-2">
          <span
            className="inline-flex h-[30px] items-center gap-1.5 rounded-full px-3 text-xs font-bold"
            style={{ backgroundColor: `${colour}1f`, color: colour }}
          >
            <CategoryIcon className="h-3.5 w-3.5" />
            {CATEGORY_LABELS[category]}
          </span>
          {story.location_name && (
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              {story.location_name}
            </span>
          )}
          {story.location_name && date && (
            <span className="text-[13px] font-semibold text-muted-foreground" aria-hidden>
              ·
            </span>
          )}
          {date && (
            <span className="text-[13px] font-semibold text-muted-foreground">{date}</span>
          )}
        </div>

        <h1 className="display text-balance text-[38px] leading-[1.02] sm:text-5xl lg:text-[58px]">
          {story.title}
        </h1>

        <div className="mt-5 flex items-center gap-3 border-b border-border pb-7">
          <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full bg-forest text-sm font-bold text-forest-accent">
            {initialsOf(publisher)}
          </span>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">
              Reported by{" "}
              <a
                href={story.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-foreground underline underline-offset-[3px] hover:text-primary"
              >
                {publisher}
              </a>
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {hostnameOf(story.source_url)}
            </p>
          </div>
        </div>

        {story.image_url && (
          <img
            src={story.image_url}
            alt=""
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
            className="mt-8 aspect-[16/8] w-full rounded-lg border border-border object-cover"
          />
        )}

        <div className="prose-block mt-8 flex flex-col gap-[34px]">
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
              <ul className="flex flex-col gap-3">
                {lessons.map((lesson, i) => (
                  <li key={i} className="flex gap-3.5">
                    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-[13px] font-bold text-accent-foreground">
                      {i + 1}
                    </span>
                    <span className="text-base leading-[1.75] text-foreground/90">{lesson}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {actions.length > 0 && (
            <Section title="What can I do?">
              <ul className="grid gap-3.5 sm:grid-cols-3">
                {actions.map((action, i) => (
                  <li
                    key={i}
                    className="flex flex-col gap-2.5 rounded-lg border border-border bg-card p-[18px]"
                  >
                    <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-primary">
                      Action {i + 1}
                    </span>
                    <span className="text-sm leading-[1.6]">{action}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {story.future_outlook && (
            <Section title="What could happen next?">
              <div className="flex gap-3.5 rounded-lg border border-dashed border-input bg-background p-5">
                <Clock
                  className="mt-1 h-[19px] w-[19px] shrink-0 text-muted-foreground"
                  strokeWidth={1.8}
                />
                <div className="flex flex-col gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    Forward-looking — not established fact
                  </span>
                  <p>{story.future_outlook}</p>
                </div>
              </div>
            </Section>
          )}

          {/* Only rendered when the model found a genuine AI angle. The forest
              band marks the section as speculative rather than reported. */}
          {showAi && (
            <Section title="How could AI help?">
              <div className="flex gap-3.5 rounded-lg bg-forest p-5">
                <Sparkle
                  className="mt-1 h-[19px] w-[19px] shrink-0 text-forest-accent"
                  strokeWidth={1.8}
                />
                <div className="flex flex-col gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-forest-accent">
                    Speculative
                  </span>
                  <p className="text-base leading-[1.75] text-forest-foreground/90">
                    {story.ai_outlook}
                  </p>
                </div>
              </div>
            </Section>
          )}
        </div>

        {/* Source block */}
        <section className="mt-10 flex flex-col gap-[18px] rounded-2xl border border-border bg-card p-6">
          <h2 className="text-[15px] font-bold">Original source</h2>
          <dl className="grid gap-x-6 gap-[18px] sm:grid-cols-2">
            <Row label="Publisher" value={publisher} />
            <Row label="Published" value={date ?? "Not stated"} />
            <Row label="Location" value={story.location_name ?? "Not stated"} />
            <Row label="Category" value={CATEGORY_LABELS[category]} />
          </dl>
          <a
            href={story.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-[46px] w-fit items-center gap-2 rounded-full bg-forest px-5 text-sm font-semibold text-forest-foreground transition hover:brightness-110"
          >
            Read the original article
            <ExternalLink className="h-4 w-4" />
          </a>
        </section>

        {/* Feedback + share */}
        <section className="mt-5 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => vote(1)}
            className={cn(
              "inline-flex h-11 items-center gap-2 rounded-full px-[18px] text-sm font-semibold transition",
              myVote === 1
                ? "bg-primary text-primary-foreground"
                : "border border-input bg-card hover:border-primary/40",
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
              "inline-flex h-11 items-center gap-2 rounded-full px-[18px] text-sm font-semibold transition",
              myVote === -1
                ? "bg-forest text-forest-foreground"
                : "border border-input bg-card hover:border-primary/40",
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
            className="inline-flex h-11 items-center gap-2 rounded-full border border-input bg-card px-[18px] text-sm font-semibold transition hover:border-primary/40"
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

        <p className="mt-6 flex items-start gap-2.5 text-[13px] leading-[1.65] text-muted-foreground">
          <Link2 className="mt-1 h-3.5 w-3.5 shrink-0" />
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
    <div className="flex flex-col gap-1">
      <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 sm:px-10">{children}</main>
      <Footer />
    </div>
  );
}
