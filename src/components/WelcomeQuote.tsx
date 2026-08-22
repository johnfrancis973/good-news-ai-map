import { useEffect, useState } from "react";
import { Sparkle, X } from "lucide-react";

/**
 * A short line, once per visit, a few seconds after arrival.
 *
 * THE LINES ARE ORIGINAL, ON PURPOSE. The obvious way to build this is to pull
 * from a quotes site or a quotes API, and almost every famous motivational
 * quote worth showing is still in copyright - and those collections carry their
 * own licence terms on top. Writing our own costs nothing, carries no licence,
 * and can actually be about this map rather than about success in general.
 *
 * It is a corner card and not a modal. Something that blocks the page three
 * seconds after arrival is an obstacle, not a welcome, and the first thing a
 * visitor came for is the map behind it.
 */
const LINES = [
  "Something good happened near you today. Someone just has to go and find it.",
  "Progress rarely announces itself. It opens a door, fixes a roof, plants a tree.",
  "The world is not only what breaks. It is also what gets rebuilt.",
  "Small repairs, repeated, become a different city.",
  "Bad news travels on its own. Good news needs someone to carry it.",
  "A bridge opened. A clinic opened. Someone decided to keep going.",
  "Hope is not a mood. It is a record of things that actually happened.",
  "Look closer at your own street. That is where most progress lives.",
  "Nobody fixes everything. Everybody fixes something.",
  "Good news is not the absence of trouble. It is proof that people answered it.",
  "Read one thing today that somebody finished.",
  "The quiet work is the work. It rarely makes the front page.",
];

/** One visit, one line. Internal navigation must not re-trigger it. */
const SEEN_KEY = "gnm.quote.seen";
const APPEAR_AFTER_MS = 2600;
const DISMISS_AFTER_MS = 13000;

export function WelcomeQuote() {
  const [line, setLine] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem(SEEN_KEY) === "1";
    } catch {
      // Private windows and blocked site data throw on access rather than
      // returning null. A visitor who cannot be remembered simply sees it.
    }
    if (seen) return;

    const pick = LINES[Math.floor(Math.random() * LINES.length)];
    const appear = setTimeout(() => {
      setLine(pick);
      // Mount first, then flip the transition on, or it renders in its final
      // position with nothing to animate from.
      requestAnimationFrame(() => setShown(true));
      try {
        sessionStorage.setItem(SEEN_KEY, "1");
      } catch {
        /* nothing to recover from */
      }
    }, APPEAR_AFTER_MS);

    const hide = setTimeout(() => setShown(false), APPEAR_AFTER_MS + DISMISS_AFTER_MS);
    return () => {
      clearTimeout(appear);
      clearTimeout(hide);
    };
  }, []);

  if (!line) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={
        "pointer-events-none fixed inset-x-4 bottom-4 z-50 flex justify-center transition-all duration-500 motion-reduce:transition-none sm:inset-x-auto sm:right-6 sm:justify-end " +
        (shown ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0")
      }
    >
      <div className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-raised">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-forest text-forest-accent">
          <Sparkle className="h-3.5 w-3.5" />
        </span>
        <p className="flex-1 text-[14px] leading-[1.55] text-foreground">{line}</p>
        <button
          type="button"
          onClick={() => setShown(false)}
          aria-label="Dismiss"
          className="-mr-1 -mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
