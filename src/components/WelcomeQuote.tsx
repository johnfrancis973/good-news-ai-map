import { useEffect, useState } from "react";
import { X } from "lucide-react";

/**
 * A short quotation, credited, a couple of seconds after arrival.
 *
 * EVERY AUTHOR HERE IS IN THE PUBLIC DOMAIN - dead more than seventy years, or
 * first published before 1929. That is what makes it safe to print the words
 * and the name without a licence. Quote sites and quote APIs are the obvious
 * source and the wrong one: their collections carry their own terms, and the
 * famous lines they lead with are mostly still in copyright.
 *
 * ATTRIBUTIONS ARE CHECKED, and the most quotable lines were dropped because
 * they are misattributed: "Be the change you wish to see in the world" is not
 * Gandhi, "What lies behind us and what lies before us..." is Henry Stanley
 * Haskins rather than Emerson, and "In the middle of difficulty lies
 * opportunity" is not Einstein. On a map whose whole claim is that each story
 * was verified, printing a false attribution would be the one unforced error
 * worth avoiding. If you add a line, source it before you add it.
 *
 * It is a card, not a modal. Something that blocks the page two seconds after
 * arrival is an obstacle, not a welcome.
 */
type Quote = { emoji: string; text: string; author: string };

const LINES: Quote[] = [
  {
    emoji: "🌱",
    text: "Great things are not done by impulse, but by a series of small things brought together.",
    author: "Vincent van Gogh",
  },
  {
    emoji: "🤝",
    text: "No act of kindness, no matter how small, is ever wasted.",
    author: "Aesop",
  },
  {
    emoji: "🌞",
    text: "Optimism is the faith that leads to achievement.",
    author: "Helen Keller",
  },
  {
    emoji: "💚",
    text: "No one is useless in this world who lightens the burden of it for anyone else.",
    author: "Charles Dickens",
  },
  {
    emoji: "🌉",
    text: "I am not afraid of storms, for I am learning how to sail my ship.",
    author: "Louisa May Alcott",
  },
  {
    emoji: "🎉",
    text: "Nothing great was ever achieved without enthusiasm.",
    author: "Ralph Waldo Emerson",
  },
  {
    emoji: "🔬",
    text: "Nothing in life is to be feared, it is only to be understood.",
    author: "Marie Curie",
  },
  {
    emoji: "🏗️",
    text: "Success is to be measured not so much by the position that one has reached, as by the obstacles overcome.",
    author: "Booker T. Washington",
  },
  {
    emoji: "🌤️",
    text: "Dwell on the beauty of life.",
    author: "Marcus Aurelius",
  },
  {
    emoji: "🕯️",
    text: "A single sunbeam is enough to drive away many shadows.",
    author: "Francis of Assisi",
  },
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
  const [line, setLine] = useState<Quote | null>(null);
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
          {line.emoji}
        </span>
        <div className="flex flex-1 flex-col gap-2">
          <p className="display text-[20px] leading-[1.3] sm:text-[26px]">
            &ldquo;{line.text}&rdquo;
          </p>
          <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {line.author}
          </p>
        </div>
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
