import { forwardRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, MapPin, Sparkles } from "lucide-react";
import type { StorySummary } from "../lib/types";
import { CATEGORY_COLORS, CATEGORY_LABELS, categoryOf } from "../lib/types";
import { cn, formatDate, hostnameOf } from "../lib/utils";

type Props = {
  story: StorySummary;
  active?: boolean;
  onHover?: (id: string | null) => void;
  onSelect?: (id: string) => void;
};

export const StoryCard = forwardRef<HTMLDivElement, Props>(function StoryCard(
  { story, active, onHover, onSelect },
  ref,
) {
  const [imageOk, setImageOk] = useState(true);
  const category = categoryOf(story.category);
  const date = formatDate(story.published_at);

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
