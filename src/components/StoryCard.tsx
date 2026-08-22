import { forwardRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Calendar, MapPin, Share2 } from "lucide-react";
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

  const Icon = CATEGORY_ICONS[category];
  const colour = CATEGORY_COLORS[category];
  const hasImage = Boolean(story.image_url) && imageOk;
  const place = story.location_name?.split(",")[0];

  return (
    <div
      ref={ref}
      onMouseEnter={() => onHover?.(story.id)}
      onMouseLeave={() => onHover?.(null)}
      onFocus={() => onHover?.(story.id)}
      className={cn(
        "group relative rounded-md border bg-card transition-all",
        active
          ? "border-primary shadow-[0_8px_22px_hsl(var(--primary)/0.16)]"
          : "border-border/70 hover:border-primary/40 hover:shadow-card",
      )}
    >
      <Link
        to={`/story/${story.id}`}
        onClick={() => onSelect?.(story.id)}
        className="block rounded-md p-3.5 focus-visible:outline-none"
      >
        <div className="flex gap-3.5">
          {hasImage ? (
            <img
              src={story.image_url!}
              alt=""
              loading="lazy"
              onError={() => setImageOk(false)}
              className="h-16 w-16 shrink-0 rounded-sm object-cover"
            />
          ) : (
            // No image is a normal state, not a failure: the three stories
            // without one are all press releases. Show the category, not a
            // broken frame.
            <span
              className="grid h-16 w-16 shrink-0 place-items-center rounded-sm"
              style={{ backgroundColor: `${colour}1a` }}
            >
              <Icon className="h-6 w-6" style={{ color: colour }} strokeWidth={1.5} />
            </span>
          )}

          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span
              className="text-[10px] font-bold uppercase tracking-[0.08em]"
              style={{ color: colour }}
            >
              {CATEGORY_LABELS[category]}
              {place && <span className="text-muted-foreground"> · {place}</span>}
            </span>

            <h3 className="text-[15px] font-semibold leading-[1.32] tracking-[-0.006em] text-foreground transition-colors group-hover:text-primary">
              {story.title}
            </h3>

            <span className="text-[11px] font-semibold text-muted-foreground">
              {story.source_name || hostnameOf(story.source_url)}
              {date && ` · ${date}`}
              {Number.isFinite(story.distance_km) && ` · ${formatDistance(story.distance_km)}`}
            </span>
          </div>
        </div>
      </Link>
    </div>
  );
});

/** Distances come back in km; below 10 km one decimal is the honest precision. */
function formatDistance(km: number): string {
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

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
 * Image on top, category chip over it, serif title.
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
  const place = story.location_name?.split(",")[0];

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
      className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-card transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-raised focus-within:border-primary/40"
    >
      {/* Stretched link: covers the card, sits under the share button. */}
      <Link
        to={`/story/${story.id}`}
        onClick={() => onSelect?.(story.id)}
        className="absolute inset-0 z-10 rounded-lg"
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
          <div
            className="grid h-full w-full place-items-center"
            style={{ backgroundColor: `${colour}1f` }}
          >
            <Icon className="h-11 w-11" style={{ color: colour }} strokeWidth={1.2} />
          </div>
        )}

        <span
          className="absolute left-3 top-3 inline-flex h-7 items-center gap-1.5 rounded-full bg-card/95 px-3 text-[11px] font-bold backdrop-blur"
          style={{ color: colour }}
        >
          <Icon className="h-3 w-3" />
          {CATEGORY_LABELS[category]}
        </span>

        {story.ai_relevance && (
          <span className="absolute right-3 top-3 inline-flex h-7 items-center rounded-full bg-forest px-3 text-[11px] font-semibold text-forest-accent">
            AI angle
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2.5 p-4 pb-[18px] sm:px-[18px]">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-muted-foreground">
          {place && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3 w-3" />
              {place}
            </span>
          )}
          {place && date && <span aria-hidden>·</span>}
          {date && (
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-3 w-3" />
              {date}
            </span>
          )}
        </div>

        <h3 className="display line-clamp-3 text-[23px] leading-[1.1] text-foreground transition-colors group-hover:text-primary">
          {story.title}
        </h3>

        {story.summary && (
          <p className="line-clamp-2 text-[13px] leading-[1.62] text-muted-foreground">
            {story.summary}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between gap-3 border-t border-border/70 pt-3.5 text-xs">
          <span className="min-w-0 truncate font-medium text-muted-foreground">{publisher}</span>

          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={share}
              aria-label={`Share ${story.title}`}
              className="relative z-20 rounded-sm p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <Share2 className="h-3.5 w-3.5" />
            </button>
            <span className="inline-flex items-center gap-1 text-[13px] font-bold text-primary">
              {copied ? "Link copied" : "Read story"}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </div>
      </div>
    </article>
  );
});
