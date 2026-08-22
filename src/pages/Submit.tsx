import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Check, Loader2, Sparkle } from "lucide-react";
import { Footer, Header } from "../components/Layout";
import { LocationSearch } from "../components/LocationSearch";
import { useSubmitSuggestion } from "../lib/queries";

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
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-accent text-primary">
            <Check className="h-6 w-6" />
          </span>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Thank you — it is in the queue.
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
            A person reads every suggestion. Submitting does not put a story on the
            map: the article still has to be checked against its original source
            before it appears anywhere.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              to="/explore"
              className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
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
              className="rounded-full border border-border bg-card px-5 py-2.5 text-sm font-semibold transition hover:border-primary/40 hover:bg-accent"
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
      <div className="mb-8">
        <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-card px-3.5 py-1.5 text-xs font-medium text-primary">
          <Sparkle className="h-3.5 w-3.5" />
          Share Good News
        </p>
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
          Suggest a story
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground">
          Found something good that actually happened, reported by a real
          publication? Send us the link. Nothing is published automatically — an
          editor checks the source first.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-6 rounded-2xl border border-border bg-card p-6">
        <Field label="Link to the article" required>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/the-article"
            aria-label="Link to the article"
            required
            className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-sm outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-ring/25"
          />
        </Field>

        <Field label="Where did it happen?" required>
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
            className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-sm outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-ring/25"
          />
        </Field>

        <Field label="Anything we should know?" hint="Optional.">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Why this one matters, or what to look at in the article."
            aria-label="Anything we should know?"
            className="w-full resize-y rounded-xl border border-input bg-background px-4 py-2.5 text-sm outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-ring/25"
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
          <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {invalid}
          </p>
        )}

        {failure && (
          <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {looksLikeValidation
              ? `That was refused: ${failure}`
              : "Could not reach the database. Check your connection and try again."}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={submit.isPending}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {submit.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {submit.isPending ? "Sending" : "Send suggestion"}
          </button>
          <p className="text-xs text-muted-foreground">
            No account needed. We store the link, the place and your note.
          </p>
        </div>
      </form>
    </Shell>
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
    <div>
      <span className="mb-2 block text-sm font-medium">
        {label}
        {required && <span className="ml-1 text-primary">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <div className="mx-auto max-w-2xl px-6 py-12 sm:py-16">
          <Link
            to="/"
            className="mb-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
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
