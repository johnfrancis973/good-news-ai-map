import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  HandCoins,
  Handshake,
  Mail,
  TriangleAlert,
} from "lucide-react";
import { Footer, Header } from "../components/Layout";
import { Toast } from "../components/Toast";

/**
 * Sponsorship and donations, without a payment provider.
 *
 * There is no Stripe, no Patreon and no checkout in this project, so this screen
 * does not pretend to take money. It composes an email and hands it to the
 * visitor's own mail client, which is the only channel that works today and the
 * only one needing no key, no webhook and no card data anywhere near us.
 *
 * mailto: FAILS SILENTLY. A browser with no mail client registered does nothing
 * at all when the link opens - no error, no tab, nothing. That is why the
 * acknowledgement is not a thank-you and stop: it shows the address, the exact
 * message that was composed, and a copy button, so a visitor whose client never
 * opened still has everything needed to send it by hand.
 */

/** The one line to change if support mail should go somewhere else. */
export const SUPPORT_EMAIL = "john@jfmedias.fr";

const FIELD =
  "w-full rounded-md border border-input bg-card px-[18px] py-3 text-[15px] outline-none transition focus:border-primary focus:ring-[3px] focus:ring-primary/20 placeholder:text-muted-foreground/70";

export type Intent = "sponsor" | "donate";

const COPY = {
  sponsor: {
    eyebrow: "Sponsorship",
    title: "Sponsor the map",
    lead:
      "Every story on the map costs a search, a scrape and a validation pass. Sponsorship covers that running cost for a region, a category or the whole map, and we will tell you exactly what your support paid for.",
    subject: "Sponsorship enquiry - Good News AI Map",
    amountLabel: "What did you have in mind?",
    amountHint: "Optional. A budget, a region you want to back, or nothing at all.",
    amountPlaceholder: "e.g. one region for a year",
    button: "Send sponsorship enquiry",
  },
  donate: {
    eyebrow: "Donations",
    title: "Support the map",
    lead:
      "A one-off contribution goes straight into the cost of finding and checking stories: search, scraping, and the validation that keeps announcements and press releases off the map. No account, no subscription, no tracking.",
    subject: "Donation - Good News AI Map",
    amountLabel: "Amount you have in mind",
    amountHint: "Optional. We will reply with how to send it.",
    amountPlaceholder: "e.g. 25 EUR",
    button: "Send donation message",
  },
} as const;

export default function Support({ intent: initial }: { intent: Intent }) {
  const [intent, setIntent] = useState<Intent>(initial);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [trap, setTrap] = useState(""); // honeypot: bots fill it, people cannot see it
  const [invalid, setInvalid] = useState<string | null>(null);
  const [sent, setSent] = useState<{ subject: string; body: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const copy = COPY[intent];

  function compose() {
    const body = [
      "Intent: " + (intent === "sponsor" ? "Sponsorship" : "Donation"),
      "Name or organisation: " + name.trim(),
      "Reply to: " + email.trim(),
      "Amount / level: " + (amount.trim() || "not specified"),
      "",
      message.trim() || "(no message)",
    ].join("\n");
    return { subject: copy.subject, body };
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setInvalid(null);

    if (trap) return; // a bot filled the hidden field; drop it silently
    if (!name.trim()) {
      setInvalid("Please tell us who you are, or which organisation.");
      return;
    }
    if (!email.trim()) {
      setInvalid("We need an address to reply to.");
      return;
    }

    const composed = compose();
    // Percent-encoded and joined with CRLF: a raw newline inside a mailto is
    // not portable across mail clients.
    const href =
      "mailto:" +
      SUPPORT_EMAIL +
      "?subject=" +
      encodeURIComponent(composed.subject) +
      "&body=" +
      composed.body.split("\n").map(encodeURIComponent).join("%0D%0A");

    window.location.href = href;
    setSent(composed);
    setCopied(false);
  }

  async function copyToClipboard() {
    if (!sent) return;
    try {
      await navigator.clipboard.writeText(
        "To: " + SUPPORT_EMAIL + "\nSubject: " + sent.subject + "\n\n" + sent.body,
      );
      setCopied(true);
    } catch {
      // Clipboard access is permission-gated and refuses outright in some
      // browsers. The message is already on screen, so nothing is lost.
      setCopied(false);
    }
  }

  return (
    <Shell>
      {sent && (
        <Toast
          title="Thank you — your message is ready to send."
          onClose={() => setSent(null)}
          action="Close"
        >
          Your mail app should have opened with it. If nothing happened, the
          message is below and can be sent by hand.
        </Toast>
      )}

      <div className="mb-9 flex flex-col gap-4">
        <p className="inline-flex h-[30px] w-fit items-center gap-2 rounded-full bg-accent px-3.5 text-xs font-bold text-accent-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          {copy.eyebrow}
        </p>
        <h1 className="display text-[38px] leading-[1.02] sm:text-[52px]">{copy.title}</h1>
        <p className="max-w-xl text-base leading-[1.7] text-muted-foreground">{copy.lead}</p>
      </div>

      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-[26px] rounded-2xl border border-border bg-card p-6 sm:p-[30px]"
      >
        <Field label="What kind of support?" required>
          <div className="grid gap-3 sm:grid-cols-2">
            <IntentCard
              selected={intent === "sponsor"}
              onSelect={() => setIntent("sponsor")}
              icon={<Handshake className="h-[18px] w-[18px]" strokeWidth={1.8} />}
              title="Sponsorship"
              note="Ongoing backing for a region or the whole map."
            />
            <IntentCard
              selected={intent === "donate"}
              onSelect={() => setIntent("donate")}
              icon={<HandCoins className="h-[18px] w-[18px]" strokeWidth={1.8} />}
              title="Donation"
              note="A one-off contribution, any size."
            />
          </div>
        </Field>

        <Field label="Your name or organisation" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ada Lovelace, or Lovelace Foundation"
            aria-label="Your name or organisation"
            required
            className={FIELD}
          />
        </Field>

        <Field
          label="Your email"
          required
          hint="So we can reply. It goes into the message and nowhere else."
        >
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-label="Your email"
            required
            className={FIELD}
          />
        </Field>

        <Field label={copy.amountLabel} hint={copy.amountHint}>
          <input
            type="text"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={copy.amountPlaceholder}
            aria-label={copy.amountLabel}
            className={FIELD}
          />
        </Field>

        <Field label="Anything you want to say?" hint="Optional.">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="What you would like your support to go towards."
            aria-label="Anything you want to say?"
            className={`${FIELD} resize-y`}
          />
        </Field>

        {/* Honeypot. Hidden from people, irresistible to form bots. */}
        <input
          type="text"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden
          value={trap}
          onChange={(e) => setTrap(e.target.value)}
          className="absolute left-[-9999px] h-0 w-0 opacity-0"
        />

        {invalid && (
          <div className="flex gap-3 rounded-md border border-destructive/30 bg-destructive/[0.06] px-[18px] py-4">
            <TriangleAlert className="mt-0.5 h-[18px] w-[18px] shrink-0 text-destructive" />
            <span className="text-[13px] leading-[1.6] text-destructive">{invalid}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4 pt-1">
          <button
            type="submit"
            className="inline-flex h-[50px] items-center gap-2 rounded-full bg-primary px-6 text-[15px] font-semibold text-primary-foreground transition hover:brightness-95"
          >
            <Mail className="h-4 w-4" />
            {copy.button}
            <ArrowRight className="h-4 w-4" />
          </button>
          <p className="text-[13px] text-muted-foreground">
            This opens your own mail app. Nothing is stored on the site.
          </p>
        </div>
      </form>

      {sent && (
        <div className="mt-[22px] flex flex-col gap-3.5 rounded-lg border border-border bg-background p-5">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-bold">If your mail app did not open</span>
            <button
              type="button"
              onClick={copyToClipboard}
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-input bg-card px-3.5 text-[13px] font-semibold transition hover:border-primary/40"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy message"}
            </button>
          </div>
          <p className="text-[13px] text-muted-foreground">
            Send it to{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="font-semibold text-foreground underline underline-offset-4"
            >
              {SUPPORT_EMAIL}
            </a>
          </p>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-card p-4 text-[13px] leading-[1.6]">
            {`Subject: ${sent.subject}\n\n${sent.body}`}
          </pre>
        </div>
      )}
    </Shell>
  );
}

function IntentCard({
  selected,
  onSelect,
  icon,
  title,
  note,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  note: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={
        "flex flex-col gap-1.5 rounded-lg border p-4 text-left transition " +
        (selected
          ? "border-primary bg-primary/[0.06] ring-[3px] ring-primary/20"
          : "border-input bg-card hover:border-primary/40")
      }
    >
      <span className="flex items-center gap-2 text-sm font-bold">
        {icon}
        {title}
      </span>
      <span className="text-[13px] leading-[1.55] text-muted-foreground">{note}</span>
    </button>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  // A div, not a <label>: the intent field holds two buttons, and a label must
  // not wrap two interactive controls. Each input carries its own aria-label.
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-sm font-semibold">
        {label}
        {required && <span className="ml-1 text-primary">*</span>}
      </span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header active="support" />
      <main className="flex-1">
        <div className="mx-auto max-w-2xl px-6 py-9 sm:py-[34px]">
          <Link
            to="/"
            className="mb-9 inline-flex h-9 items-center gap-2 rounded-full border border-input bg-card pl-3 pr-4 text-[13px] font-semibold text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          {children}
        </div>
      </main>
      <Footer />
    </div>
  );
}
