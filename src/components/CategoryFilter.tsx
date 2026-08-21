import { CATEGORIES, CATEGORY_COLORS, CATEGORY_LABELS } from "../lib/types";
import type { Category } from "../lib/types";
import { cn } from "../lib/utils";

type Props = {
  value: Category | null;
  counts: Partial<Record<Category, number>>;
  onChange: (value: Category | null) => void;
};

export function CategoryFilter({ value, counts, onChange }: Props) {
  const available = CATEGORIES.filter((c) => (counts[c] ?? 0) > 0);
  if (available.length < 2) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={cn(
          "rounded-full border px-3 py-1 text-xs font-medium transition",
          value === null
            ? "border-foreground bg-foreground text-background"
            : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
        )}
      >
        All
      </button>
      {available.map((c) => {
        const selected = value === c;
        return (
          <button
            key={c}
            type="button"
            onClick={() => onChange(selected ? null : c)}
            style={selected ? { backgroundColor: CATEGORY_COLORS[c], borderColor: CATEGORY_COLORS[c] } : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition",
              selected
                ? "text-white"
                : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
            )}
          >
            {CATEGORY_LABELS[c]}
            <span className={cn("ml-1.5", selected ? "text-white/75" : "text-muted-foreground/70")}>
              {counts[c]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
