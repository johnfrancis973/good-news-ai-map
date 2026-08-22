import { CATEGORIES, CATEGORY_COLORS, CATEGORY_LABELS } from "../lib/types";
import type { Category } from "../lib/types";
import { cn } from "../lib/utils";

type Props = {
  value: Category | null;
  counts: Partial<Record<Category, number>>;
  onChange: (value: Category | null) => void;
};

const PILL = "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition";

export function CategoryFilter({ value, counts, onChange }: Props) {
  const available = CATEGORIES.filter((c) => (counts[c] ?? 0) > 0);
  if (available.length < 2) return null;

  const total = available.reduce((sum, c) => sum + (counts[c] ?? 0), 0);

  return (
    // Nowrap below lg so the filter bar scrolls sideways on a phone instead of
    // stacking into a second row and pushing the map off the screen. The
    // parent supplies the overflow.
    <div className="flex flex-nowrap items-center gap-2 lg:flex-wrap">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={cn(
          PILL,
          value === null
            ? "bg-forest text-forest-foreground"
            : "border border-input bg-card text-foreground hover:border-primary/40",
        )}
      >
        All
        <span className={value === null ? "text-forest-muted" : "text-muted-foreground"}>
          {total}
        </span>
      </button>

      {available.map((c) => {
        const selected = value === c;
        return (
          <button
            key={c}
            type="button"
            onClick={() => onChange(selected ? null : c)}
            // The category's own colour fills the pill when it is the active
            // filter; otherwise it stays a dot, so colour always means content.
            style={selected ? { backgroundColor: CATEGORY_COLORS[c] } : undefined}
            className={cn(
              PILL,
              selected
                ? "text-white"
                : "border border-input bg-card text-foreground hover:border-primary/40",
            )}
          >
            {!selected && (
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: CATEGORY_COLORS[c] }}
              />
            )}
            {CATEGORY_LABELS[c]}
            <span className={selected ? "text-white/70" : "text-muted-foreground"}>
              {counts[c]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
