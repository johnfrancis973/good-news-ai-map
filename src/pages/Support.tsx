import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  HandCoins,
  Handshake,
  Loader2,
  Shield,
  TriangleAlert,
  WifiOff,
} from "lucide-react";
import { Footer, Header } from "../components/Layout";
import { Toast } from "../components/Toast";
import { useSubmitSupportRequest } from "../lib/queries";
import { lastExploreHref } from "../lib/utils";

const FIELD =
  "w-full rounded-md border border-input bg-card px-[18px] py-3 text-[15px] outline-none transition focus:border-primary focus:ring-[3px] focus:ring-primary/20 placeholder:text-muted-foreground/70";

export type Intent = "sponsor" | "donate";

/**
 * Sponsorship and donations, on the same contract as the story queue.
 *
 * What is sent here lands in a table the public cannot read, through a
 * security-definer function that validates every field and rate-limits by
 * session. There is no read path back out — not for the sender, not for anyone
 * holding the public key. An operator reads it with the service role.
 *
 * This deliberately replaced a mailto: link. mailto FAILS SILENTLY when the
 * visitor has no mail client registered: no error, no tab, nothing, and a
 * person who filled in the whole form has sent nothing at all. A row in a
 * table cannot fail silently, and the acknowledgement below is true because
 * the write succeeded rather than because a link was opened.
 *
 * There is still no payment provider in this project. Nothing here takes money;
 * it starts a conversation, and we reply by email.
 */
const COPY = {
  sponsor: {
    eyebrow: "Sponsorship",
    title: "Sponsor the map",
    lead:
      "Every story on the map costs a search, a scrape and a validation pass. Sponsorship covers that running cost for a region, a category or the whole map, and we will tell you exactly what your support paid for.",
    amountLabel: "What did you have in mind?",
    amountHint: "Optional. A budget, a region you want to back, or nothing at all.",
    amountPlaceholder: "e.g. one region for a year",
    button: "Send sponsorship enquiry",
    thanks: "Thank you for your enquiry.",
  },
  donate: {
    eyebrow: "Donations",
    title: "Support the map",
    lead:
      "A one-off contribution goes straight into the cost of finding and checking stories: search, scraping, and the validation that keeps announcements and press releases off the map. No account, no subscription, no tracking.",
    amountLabel: "Amount you have in mind",
    amountHint: "Optional. We will reply with how to send it.",
    amountPlaceholder: "e.g. 25 EUR",
    button: "Send donation message",
    thanks: "Thank you for your message.",
  },
} as const;

export default function Support({ intent: initial }: { intent: Intent }) {
  const [intent, setIntent] = useState<Intent>(initial);
  const [supporter, setSupporter] = useState("");
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [trap, setTrap] = useState(""); // honeypot: bots fill it, people cannot see it
  const [invalid, setInvalid] = useState<string | null>(null);
  const [thanks, setThanks] = useState(false);

  const submit = useSubmitSupportRequest();
  const copy = COPY[intent];

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setInvalid(null);

    if (trap) return; // a bot filled the hidden field; drop it silently
    if (supporter.trim().length < 2) {
      setInvalid("Please tell us who you are, or which organisation.");
      return;
    }
    if (!email.trim()) {
      setInvalid("We need an address to reply to.");
      return;
    }

    try {
      await submit.mutateAsync({
        intent,
        supporter: supporter.trim(),
        email: email.trim(),
        amount: amount.trim(),
        message: message.trim(),
      });
      setThanks(true);
      setSupporter("");
      setEmail("");
      setAmount("");
      setMessage("");
    } catch {
      // Rendered from submit.error below, same as the story form.
    }
  }

  const failure = submit.isError
    ? ((submit.error as { message?: string } | null)?.message ?? "Something went wrong.")
    : null;
  const looksLikeValidation =
    failure !== null && /email|name|intent|limit|invalid|too long|session/i.test(failure);

  return (
    <Shell>
      {thanks && (
        <Toast title={copy.thanks} onClose={() => setThanks(false)} action="Close">
          We read every one and reply by email, usually within a few days.
          <Link
            to={lastExploreHref()}
            className="mt-3 inline-flex font-semibold text-foreground underline underline-offset-4"
          >
            Explore the map
          </Link>
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
            value={supporter}
            onChange={(e) => setSupporter(e.target.value)}
            placeholder="Ada Lovelace, or Lovelace Foundation"
            aria-label="Your name or organisation"
            required
            maxLength={200}
            className={FIELD}
          />
        </Field>

        <Field label="Your email" required hint="This is how we reply. It is never shown on the site.">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-label="Your email"
            required
            maxLength={200}
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
            maxLength={120}
            className={FIELD}
          />
        </Field>

        <Field label="Anything you want to say?" hint="Optional. Up to 2,000 characters.">
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

        {invalid && <Refusal>{invalid}</Refusal>}

        {failure &&
          (looksLikeValidation ? (
            <Refusal>{failure}</Refusal>
          ) : (
            <div className="flex gap-3 rounded-md border border-input bg-background px-[18px] py-4">
              <WifiOff className="mt-0.5 h-[18px] w-[18px] shrink-0 text-muted-foreground" />
              <div className="flex flex-col gap-1">
                <span className="text-[13px] font-bold">Could not reach the database</span>
                <span className="text-[13px] leading-[1.6] text-muted-foreground">
                  Check your connection and try again.
                </span>
              </div>
            </div>
          ))}

        <div className="flex flex-wrap items-center gap-4 pt-1">
          <button
            type="submit"
            disabled={submit.isPending}
            className="inline-flex h-[50px] items-center gap-2 rounded-full bg-primary px-6 text-[15px] font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-50"
          >
            {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {submit.isPending ? "Sending" : copy.button}
            {!submit.isPending && <ArrowRight className="h-4 w-4" />}
          </button>
          <p className="text-[13px] text-muted-foreground">
            No account needed. No payment is taken here.
          </p>
        </div>
      </form>

      <div className="mt-[22px] flex gap-3.5 rounded-lg border border-border bg-background p-5">
        <Shield className="mt-0.5 h-[19px] w-[19px] shrink-0" strokeWidth={1.8} />
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-bold">What happens to what you send</span>
          <span className="text-[13px] leading-[1.65] text-muted-foreground">
            This goes into a queue nobody can read back — not other visitors, not
            you, not anyone holding the public key. We reply from it by email.
            Nothing you send here appears on the map, and no card details are
            asked for or handled anywhere on this site.
          </span>
        </div>
      </div>
    </Shell>
  );
}

function Refusal({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3 rounded-md border border-destructive/30 bg-destructive/[0.06] px-[18px] py-4">
      <TriangleAlert className="mt-0.5 h-[18px] w-[18px] shrink-0 text-destructive" />
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-bold text-destructive">That was refused</span>
        <span className="text-[13px] leading-[1.6] text-destructive">{children}</span>
      </div>
    </div>
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
