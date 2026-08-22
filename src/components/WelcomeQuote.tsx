import { useEffect, useState } from "react";
import { X } from "lucide-react";

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
const LINES: Array<[string, string]> = [
  ["🌞", "Something good happened near you today. Someone just has to go and find it."],
  ["🌱", "Progress rarely announces itself. It opens a door, fixes a roof, plants a tree."],
  ["🏗️", "The world is not only what breaks. It is also what gets rebuilt."],
  ["🏘️", "Small repairs, repeated, become a different city."],
  ["📣", "Bad news travels on its own. Good news needs someone to carry it."],
  ["🌉", "A bridge opened. A clinic opened. Someone decided to keep going."],
  ["💚", "Hope is not a mood. It is a record of things that actually happened."],
  ["🚲", "Look closer at your own street. That is where most progress lives."],
  ["🤝", "Nobody fixes everything. Everybody fixes something."],
  ["🎉", "Good news is not the absence of trouble. It is proof that people answered it."],
  ["📖", "Read one thing today that somebody finished."],
  ["🙌", "The quiet work is the work. It rarely makes the front page."],
];

/**
 * Once per page LOAD, deliberately not once per tab session.
 *
 * The first version remembered in sessionStorage, which survives a reload -
 * so after a visitor's very first load the line never came back in that tab,
 * including when they refreshed to look for it. This component lives above the
 * router and never remounts, so internal navigation cannot re-trigger it
 * anyway: plain component state is the whole mechanism it needs.
 */
const APPEAR_AFTER_MS = 2200;
const DISMISS_AFTER_MS = 15000;

export function WelcomeQuote() {
  const [line, setLine] = useState<[string, string] | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const pick = LINES[Math.floor(Math.random() * LINES.length)];
    const appear = setTimeout(() => {
      setLine(pick);
      // Mount first, then flip the transition on, or it renders in its final
      // position with nothing to animate from.
      requestAnimationFrame(() => setShown(true));
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
        "pointer-events-none fixed inset-x-4 top-1/4 z-50 flex justify-center transition-all duration-700 ease-out motion-reduce:transition-none " +
        (shown ? "translate-y-0 scale-100 opacity-100" : "translate-y-6 scale-95 opacity-0")
      }
    >
      <div className="pointer-events-auto flex w-full max-w-2xl items-start gap-5 rounded-3xl border-2 border-primary/70 bg-card px-7 py-7 text-foreground shadow-[0_24px_70px_-14px_rgba(0,0,0,0.55)] sm:px-9 sm:py-9">
        <span aria-hidden className="text-[34px] leading-none sm:text-[42px]">
          {line[0]}
        </span>
        <p className="display flex-1 text-[22px] leading-[1.3] sm:text-[28px]">{line[1]}</p>
        <button
          type="button"
          onClick={() => setShown(false)}
          aria-label="Dismiss"
          className="-mr-1.5 -mt-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
