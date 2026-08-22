import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Loader2, Shield, TriangleAlert, WifiOff } from "lucide-react";
import { Footer, Header } from "../components/Layout";
import { LocationSearch } from "../components/LocationSearch";
import { useSubmitSuggestion } from "../lib/queries";
import { lastExploreHref } from "../lib/utils";

const FIELD =
  "w-full rounded-md border border-input bg-card px-[18px] py-3 text-[15px] outline-none transition focus:border-primary focus:ring-[3px] focus:ring-primary/20 placeholder:text-muted-foreground/70";

/**
 * A suggestion queue, not a publishing path.
 *
 * What is sent here lands in a table the public cannot read, through a
 * security-definer function. An operator still runs the same harvest and
 * validation every other story goes through before anything reaches the map.
 * That is what keeps the project's one rule intact: write slow, read fast.
 */
export default function Submit() {
  const [url, setUrl] = useState("");
  const [place, setPlace] = useState("");
  const [submitter, setSubmitter] = useState("");
  const [note, setNote] = useState("");
  const [trap, setTrap] = useState(""); // honeypot: bots fill it, people cannot see it
  const [invalid, setInvalid] = useState<string | null>(null);

  const submit = useSubmitSuggestion();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setInvalid(null);

    if (trap) return; // silently drop
    if (!/^https?:\/\/\S+\.\S+/.test(url.trim())) {
      setInvalid("Paste the full link to the article, starting with https://");
      return;
    }
    if (place.trim().length < 2) {
      setInvalid("Tell us where it happened.");
      return;
    }

    submit.mutate({
      url: url.trim(),
      place: place.trim(),
      submitter: submitter.trim(),
      note: note.trim(),
    });
  }

  if (submit.isSuccess) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card p-8 text-center sm:p-10">
          <span className="grid h-[54px] w-[54px] place-items-center rounded-full bg-accent text-accent-foreground">
            <Check className="h-[26px] w-[26px]" strokeWidth={2} />
          </span>
          <h1 className="display text-[28px] leading-[1.08] sm:text-[32px]">
            Thank you — it is in the queue.
          </h1>
          <p className="max-w-md text-[13px] leading-[1.65] text-muted-foreground">
            A person reads every suggestion. Submitting does not put a story on the
            map: the article still has to be checked against its original source
            before it appears anywhere.
          </p>
          <div className="mt-1 flex flex-wrap justify-center gap-2.5">
            <Link
              to={lastExploreHref()}
              className="inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:brightness-95"
            >
              Explore the map
            </Link>
            <button
              type="button"
              onClick={() => {
                submit.reset();
                setUrl("");
                setNote("");
              }}
              className="inline-flex h-11 items-center rounded-full border border-input bg-card px-5 text-sm font-semibold transition hover:border-primary/40"
            >
              Share another
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  // A refusal from the RPC is a validation message; anything else is a network
  // problem, and telling the two apart is the difference between "fix your
  // input" and "try again later".
  const failure = submit.isError
    ? ((submit.error as { message?: string } | null)?.message ??
      "Something went wrong.")
    : null;
  const looksLikeValidation =
    failure !== null && /url|place|note|email|limit|invalid|too/i.test(failure);

  return (
    <Shell>
      <div className="mb-9 flex flex-col gap-4">
        <p className="inline-flex h-[30px] w-fit items-center gap-2 rounded-full bg-accent px-3.5 text-xs font-bold text-accent-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          Share good news
        </p>
        <h1 className="display text-[38px] leading-[1.02] sm:text-[52px]">
          Suggest a story
        </h1>
        <p className="max-w-xl text-base leading-[1.7] text-muted-foreground">
          Found something good that actually happened, reported by a real
          publication? Send us the link. Nothing is published automatically — a
          person checks the source first, and the article goes through the same
          validation as everything else on the map.
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-[26px] rounded-2xl border border-border bg-card p-6 sm:p-[30px]"
      >
        <Field label="Link to the article" required>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/the-article"
            aria-label="Link to the article"
            required
            className={FIELD}
          />
        </Field>

        <Field
          label="Where did it happen?"
          required
          hint="We look the place up as you type. If we cannot resolve it, your text is still sent."
        >
          {/* Same geocoder as everywhere else. Free text still submits, so a
              place Nominatim cannot resolve is not a dead end. */}
          <LocationSearch
            size="md"
            action="Use"
            placeholder="City, region or country"
            onQueryChange={setPlace}
            onResolved={(p) => setPlace(p.name)}
          />
        </Field>

        <Field label="Your email" hint="Optional. Only used if we need to ask you something.">
          <input
            type="email"
            value={submitter}
            onChange={(e) => setSubmitter(e.target.value)}
            placeholder="you@example.com"
            aria-label="Your email"
            className={FIELD}
          />
        </Field>

        <Field label="Anything we should know?" hint="Optional. Up to 2,000 characters.">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Why this one matters, or what to look at in the article."
            aria-label="Anything we should know?"
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
            {submit.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            {submit.isPending ? "Sending" : "Send suggestion"}
            {!submit.isPending && <ArrowRight className="h-4 w-4" />}
          </button>
          <p className="text-[13px] text-muted-foreground">
            No account needed. We store the link, the place and your note.
          </p>
        </div>
      </form>

      <div className="mt-[22px] flex gap-3.5 rounded-lg border border-border bg-background p-5">
        <Shield className="mt-0.5 h-[19px] w-[19px] shrink-0" strokeWidth={1.8} />
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-bold">What happens to what you send</span>
          <span className="text-[13px] leading-[1.65] text-muted-foreground">
            Suggestions go into a queue nobody can read back — not other visitors,
            not you, not anyone holding the public key. An operator triages them
            from the command line, and the article is harvested and validated
            exactly like every other story before it appears on the map.
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
  // A div, not a <label>: the place field is a composite with its own button
  // inside, and a label must not wrap two interactive controls. Each input
  // carries its own aria-label instead.
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
      <Header active="submit" />
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
