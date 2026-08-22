import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Loader2, Shield, TriangleAlert, WifiOff } from "lucide-react";
import { Footer, Header } from "../components/Layout";
import { LocationSearch } from "../components/LocationSearch";
import { Toast } from "../components/Toast";
import { geocodePlace, useSubmitSuggestion } from "../lib/queries";
import { lastExploreHref } from "../lib/utils";

const FIELD =
  "w-full rounded-md border border-input bg-card px-[18px] py-3 text-[15px] outline-none transition focus:border-primary focus:ring-[3px] focus:ring-primary/20 placeholder:text-muted-foreground/70";

/**
 * A suggestion queue, not a publishing path.
 *
 * What is sent here lands in a table the public cannot read, through a
 * security-definer function. Nothing published here skips validation: the link
 * goes through the same scrape, the same validator and the same deterministic
 * gates as every story already on the map, and only that pipeline can publish
 * it. The checking happens after the response, never during it, which is what
 * keeps the project's one rule intact: write slow, read fast.
 *
 * The coordinates matter more than they look. Geography is a hard filter in the
 * validator, so a place we cannot resolve means there is nothing to check the
 * article against, and the suggestion waits for a person instead.
 */
export default function Submit() {
  const [url, setUrl] = useState("");
  const [place, setPlace] = useState("");
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [submitter, setSubmitter] = useState("");
  const [note, setNote] = useState("");
  const [trap, setTrap] = useState(""); // honeypot: bots fill it, people cannot see it
  const [invalid, setInvalid] = useState<string | null>(null);
  const [thanks, setThanks] = useState(false);

  const submit = useSubmitSuggestion();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setInvalid(null);

    if (trap) return; // silently drop
    const link = url.trim();
    const where = place.trim();

    if (!/^https?:\/\/\S+\.\S+/.test(link)) {
      setInvalid("Paste the full link to the article, starting with https://");
      return;
    }
    if (where.length < 2) {
      setInvalid("Tell us where it happened.");
      return;
    }

    // Typed a place but never picked one from the list. Try to resolve it once
    // so the link can still be checked automatically; if that fails, send it
    // anyway rather than blocking on a geocoder.
    let at = coords;
    if (!at) {
      try {
        const [top] = await geocodePlace(where);
        if (top) at = { latitude: top.latitude, longitude: top.longitude };
      } catch {
        at = null;
      }
    }

    submit.mutate(
      {
        url: link,
        place: where,
        submitter: submitter.trim(),
        note: note.trim(),
        latitude: at?.latitude ?? null,
        longitude: at?.longitude ?? null,
      },
      {
        onSuccess: () => {
          setThanks(true);
          // Reset behind the popup so the form is ready for the next one.
          setUrl("");
          setNote("");
          setCoords(null);
          submit.reset();
        },
      },
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
      {thanks && (
        <Toast
          title="Thank you for your submission."
          onClose={() => setThanks(false)}
          action="Share another"
        >
          It will be reviewed by our team and will be available if it is verified.
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
          Share good news
        </p>
        <h1 className="display text-[38px] leading-[1.02] sm:text-[52px]">
          Suggest a story
        </h1>
        <p className="max-w-xl text-base leading-[1.7] text-muted-foreground">
          Found something good that actually happened, reported by a real
          publication? Send us the link. We read the article at its original
          source within minutes and put it through the same validation as
          everything else on the map — so a story that passes can appear almost
          straight away, and one that does not is looked at by a person.
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
            onQueryChange={(q) => {
              setPlace(q);
              // Editing the text invalidates whatever was resolved before it.
              // Coordinates that outlive their place name would send the
              // validator hunting for the article in the wrong country.
              setCoords(null);
            }}
            onResolved={(p) => {
              setPlace(p.name);
              setCoords({ latitude: p.latitude, longitude: p.longitude });
            }}
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
            not you, not anyone holding the public key. The link is then checked
            automatically: we fetch the article from its publisher and run it
            through the same validation as every other story, which can reject it
            for being an announcement rather than something that happened, for
            being about somewhere else, or for not being traceable to its source.
            Anything the check refuses is looked at by a person.
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
