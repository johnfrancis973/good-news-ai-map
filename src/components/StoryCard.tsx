import { forwardRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Calendar, MapPin, Share2, Sparkles } from "lucide-react";
import type { StorySummary } from "../lib/types";
import { CATEGORY_COLORS, CATEGORY_ICONS, CATEGORY_LABELS, categoryOf } from "../lib/types";
import { cn, formatDate, hostnameOf, shareUrl } from "../lib/utils";

type Props = {
  story: StorySummary;
  active?: boolean;
  onHover?: (id: string | null) => void;
  onSelect?: (id: string) => void;
  /**
   * "row" is the compact card the Explore panel scrolls through.
   * "feature" is the image-led card used in the home page grid.
   */
  variant?: "row" | "feature";
};

export const StoryCard = forwardRef<HTMLDivElement, Props>(function StoryCard(
  { story, active, onHover, onSelect, variant = "row" },
  ref,
) {
  const [imageOk, setImageOk] = useState(true);
  const category = categoryOf(story.category);
  const date = formatDate(story.published_at);

  if (variant === "feature") {
    return (
      <FeatureCard
        ref={ref}
        story={story}
        category={category}
        date={date}
        imageOk={imageOk}
        onImageError={() => setImageOk(false)}
        onHover={onHover}
        onSelect={onSelect}
      />
    );
  }

  return (
    <div
      ref={ref}
      onMouseEnter={() => onHover?.(story.id)}
      onMouseLeave={() => onHover?.(null)}
      onFocus={() => onHover?.(story.id)}
      className={cn(
        "group relative rounded-xl border bg-card transition-all",
        active
          ? "border-primary/60 shadow-md ring-1 ring-primary/25"
          : "border-border hover:border-primary/35 hover:shadow-sm",
      )}
    >
      <Link
        to={`/story/${story.id}`}
        onClick={() => onSelect?.(story.id)}
        className="block rounded-xl p-4 focus-visible:outline-none"
      >
        <div className="flex gap-4">
          {story.image_url && imageOk && (
            <img
              src={story.image_url}
              alt=""
              loading="lazy"
              onError={() => setImageOk(false)}
              className="hidden h-24 w-24 shrink-0 rounded-lg object-cover sm:block"
            />
          )}

          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white"
                style={{ backgroundColor: CATEGORY_COLORS[category] }}
              >
                {CATEGORY_LABELS[category]}
              </span>
              {story.ai_relevance && (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground">
                  <Sparkles className="h-3 w-3" />
                  AI angle
                </span>
              )}
            </div>

            <h3 className="text-[15px] font-semibold leading-snug text-foreground group-hover:text-primary">
              {story.title}
            </h3>

            {story.summary && (
              <p className="mt-1.5 line-clamp-3 text-sm leading-6 text-muted-foreground">
                {story.summary}
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {story.location_name && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {story.location_name}
                </span>
              )}
              {date && <span>{date}</span>}
              <span className="inline-flex items-center gap-0.5">
                {story.source_name || hostnameOf(story.source_url)}
                <ArrowUpRight className="h-3 w-3" />
              </span>
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
});

type FeatureProps = {
  story: StorySummary;
  category: ReturnType<typeof categoryOf>;
  date: string | null;
  imageOk: boolean;
  onImageError: () => void;
  onHover?: (id: string | null) => void;
  onSelect?: (id: string) => void;
};

/**
 * The card the mockup calls for: image on top, chip over it, serif title.
 *
 * The whole card is clickable through a stretched link overlay rather than by
 * wrapping everything in an <a>, because the share button has to be a real
 * button and a button inside a link is invalid markup.
 */
const FeatureCard = forwardRef<HTMLDivElement, FeatureProps>(function FeatureCard(
  { story, category, date, imageOk, onImageError, onHover, onSelect },
  ref,
) {
  const [copied, setCopied] = useState(false);
  const Icon = CATEGORY_ICONS[category];
  const colour = CATEGORY_COLORS[category];
  const publisher = story.source_name || hostnameOf(story.source_url);
  const hasImage = Boolean(story.image_url) && imageOk;

  async function share(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const url = `${window.location.origin}${import.meta.env.BASE_URL}story/${story.id}`;
    const result = await shareUrl(url, story.title);
    if (result === "copied") {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    }
  }

  return (
    <article
      ref={ref}
      onMouseEnter={() => onHover?.(story.id)}
      onMouseLeave={() => onHover?.(null)}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg focus-within:border-primary/40"
    >
      {/* Stretched link: covers the card, sits under the share button. */}
      <Link
        to={`/story/${story.id}`}
        onClick={() => onSelect?.(story.id)}
        className="absolute inset-0 z-10 rounded-2xl"
      >
        <span className="sr-only">{story.title}</span>
      </Link>

      <div className="relative aspect-[16/10] overflow-hidden">
        {hasImage ? (
          <img
            src={story.image_url!}
            alt=""
            loading="lazy"
            onError={onImageError}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          // No image is a normal state, not a failure: 3 of the published
          // stories have none. Show the category, not a broken frame.
          <div
            className="grid h-full w-full place-items-center"
            style={{ backgroundColor: `${colour}1a` }}
          >
            <Icon className="h-10 w-10" style={{ color: colour }} strokeWidth={1.5} />
          </div>
        )}

        <span
          className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold backdrop-blur"
          style={{ color: colour }}
        >
          <Icon className="h-3 w-3" />
          {CATEGORY_LABELS[category]}
        </span>

        {story.ai_relevance && (
          <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-medium text-primary backdrop-blur">
            <Sparkles className="h-3 w-3" />
            AI angle
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {story.location_name && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {story.location_name}
            </span>
          )}
          {date && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {date}
            </span>
          )}
        </div>

        <h3 className="mt-2 line-clamp-2 font-display text-lg font-bold leading-snug tracking-tight text-foreground transition-colors group-hover:text-primary">
          {story.title}
        </h3>

        {story.summary && (
          <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
            {story.summary}
          </p>
        )}

        <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4 text-xs">
          <span className="min-w-0 truncate text-muted-foreground">{publisher}</span>

          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={share}
              aria-label={`Share ${story.title}`}
              className="relative z-20 rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <Share2 className="h-3.5 w-3.5" />
            </button>
            <span className="inline-flex items-center gap-1 font-semibold text-primary">
              {copied ? "Link copied" : "Read Story"}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </div>
      </div>
    </article>
  );
});
