import { useEffect, useRef } from "react";
import { Check } from "lucide-react";

type Props = {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  /** Label on the dismiss button at the foot of the card. */
  action?: string;
};

/**
 * The first dialog in the app, and deliberately the smallest one that can be
 * correct. No dependency, no portal, no provider: one card over a dimmed
 * backdrop.
 *
 * It is announced rather than merely drawn — role="dialog" + aria-modal for
 * anyone navigating by landmark, aria-live so a screen reader says the message
 * when it appears rather than leaving it for the user to find. Focus moves in
 * on open and back to whatever opened it on close, because a dialog you cannot
 * tab to is a dialog some people cannot dismiss.
 */
export function Toast({ title, children, onClose, action = "Close" }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    closeRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Keep Tab inside the card. Without this, tabbing walks the form behind
      // the backdrop, which is still there and still focusable.
      if (e.key !== "Tab") return;
      const focusable = cardRef.current?.querySelectorAll<HTMLElement>(
        'button, a[href], input, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      (openerRef.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 px-6 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        // mousedown, not click: a click that starts inside the card and ends on
        // the backdrop (a dragged text selection) must not close it.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-live="polite"
        aria-labelledby="toast-title"
        className="flex w-full max-w-md animate-fade-up flex-col items-center gap-4 rounded-2xl border border-border bg-card p-8 text-center shadow-raised sm:p-10"
      >
        <span className="grid h-[54px] w-[54px] place-items-center rounded-full bg-accent text-accent-foreground">
          <Check className="h-[26px] w-[26px]" strokeWidth={2} />
        </span>

        <h2 id="toast-title" className="display text-[26px] leading-[1.1] sm:text-[28px]">
          {title}
        </h2>

        <div className="text-[13px] leading-[1.65] text-muted-foreground">{children}</div>

        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="mt-1 inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:brightness-95"
        >
          {action}
        </button>
      </div>
    </div>
  );
}
