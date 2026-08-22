# Good News AI Map — handoff

Everything needed to pick this up cold. Verified against the live system, not
recalled from memory.

| | |
|---|---|
| **Live site** | https://johnfrancis973.github.io/good-news-ai-map/ |
| **Source** | https://github.com/johnfrancis973/good-news-ai-map (public) |
| **Database** | Lovable Cloud / Supabase `oskgbaudwjxttfzxzbmx`, PostgreSQL 17.6 |
| **Lovable project** | `a9b1c62b-8943-42e7-8e7e-ac3f05331fc6` |
| **Status** | Working end to end. 73 published stories, 8 locations (measured 2026-08-22 — the section 5 breakdown below predates the recent harvests). All acceptance checks pass except the one asserting `submit_suggestion` returns an id: migration `0003_suggestion_verification.sql` and the `submit-suggestion` function are written but **not yet applied or deployed**. See section 9. |

Run `node scripts/verify.mjs` at any time. It exercises the live API exactly as
a browser does and exits non-zero if anything is broken.

---

## 1. The one rule

**Write slow → database → read fast.** Two loops that meet only in PostgreSQL.

```
Loop A, write (slow, 3-5 min per location, run by an operator)
  Location → Firecrawl Search → candidate URLs → deduplicate
           → snippet triage → Firecrawl Scrape
           → OpenAI validation → PostgreSQL

Loop B, read (fast, what a visitor does)
  Search a place → query PostgreSQL → map + cards
                 → open a finished story
```

Nothing user-facing ever calls Firecrawl or OpenAI. There is no import of
either anywhere under `src/`. If both APIs went down, the site would stay fully
browsable. That property is the architecture, not an optimisation — please keep
it.

---

## 2. Running it

```sh
npm install
npm run dev            # http://localhost:5173
node scripts/verify.mjs
```

`.env.local` holds the two frontend values. They are public by design and ship
in the browser bundle:

```dotenv
VITE_SUPABASE_URL=https://oskgbaudwjxttfzxzbmx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

`.env.ingest` holds the server-side keys. Gitignored, never bundled, and the
build refuses to emit a bundle containing any of them:

```dotenv
OPENAI_API_KEY=
FIRECRAWL_API_KEY=
SUPABASE_URL=
INGEST_ADMIN_TOKEN=
SUPABASE_SERVICE_ROLE_KEY=      # still empty, see section 6
```

> Vite inlines every `VITE_`-prefixed variable into the browser bundle. The
> OpenAI, Firecrawl and service-role keys must never carry that prefix and must
> never appear in `.env.local` or anywhere under `src/`.

---

## 3. Adding stories

The operator interface is a CLI, deliberately — the spec rules out an admin
dashboard.

```sh
node scripts/known-urls.mjs                                   # what's already processed
node scripts/harvest.mjs --preset paris --known harvest/known-urls.json
```

`harvest.mjs` runs search → dedupe → triage → scrape → validate and writes
finished stories to `harvest/<place>.json` along with every rejection and its
reason. Read those reasons: they are the fastest way to see whether the
validator is behaving.

`triaged_out` in the same file lists candidates dropped on their search snippet
before any scrape was spent. Read that too, and for the opposite reason: it is
where a too-strict triage prompt shows up as stories that never got a chance.

Loading `harvest/*.json` into Postgres is currently manual, via Lovable's MCP
`query_database` with a `jsonb_to_recordset` insert. Once a service role key
exists, `scripts/ingest-local.mjs` does it in one step — it imports the *same*
`pipeline.js` and writes straight to the database.

Presets: `cayenne`, `paris`, `london`, `newyork`, `reykjavik`. Each carries
coordinates, radius and a list of regional news outlets.

---

## 4. Where things live

```
src/lib/queries.ts                    read path — Postgres only, no external APIs
src/lib/supabase.ts                   client; strips Bearer for opaque keys (section 7)
src/pages/{Home,Explore,StoryDetail}  the three screens
src/pages/Submit.tsx                  suggestion form — writes to a queue, not the map
src/components/Layout.tsx             header, nav, footer — shared by every page
src/components/StoryCard.tsx          "row" for the Explore panel, "feature" for the grid
src/components/StoryMap.tsx           react-leaflet + OpenStreetMap
supabase/migrations/0001_init.sql     schema, RLS, RPCs
supabase/migrations/0002_suggestions.sql  suggestion queue + submit_suggestion()
supabase/migrations/0003_suggestion_verification.sql  auto-check + spend ceiling
supabase/functions/ingest-location/
  pipeline.js                         ALL ingestion logic, shared
  index.ts                            HTTP wrapper (not deployed yet)
supabase/functions/submit-suggestion/
  index.ts                            public; logs, answers 202, verifies after
  verify.ts                           free checks -> budget -> processCandidate()
scripts/harvest.mjs                   offline collection → JSON
scripts/ingest-local.mjs              same pipeline, writes to the DB
scripts/suggestions.mjs               read/triage the queue (needs the service key)
scripts/verify.mjs                    acceptance checks against the live API
scripts/build-pages.mjs               production build + secret guard
```

`pipeline.js` is plain JavaScript depending only on `fetch` and a Supabase
client passed in as an argument, so the edge function and both local runners use
identical logic. **Change ingestion behaviour there and nowhere else.**

---

## 5. Data

> **Stale.** The live database held 73 published stories across 8 locations
> when last measured (2026-08-22); the table below describes an earlier state
> and the per-location counts have not been re-derived. The weaknesses listed
> underneath may also have been addressed by the harvests since.

24 published stories, 4 locations, 9 publishers, articles dated
2025-09-05 to 2026-08-19. Nothing unpublished is visible to the public.

| Location | Stories | Radius |
|---|---|---|
| Cayenne, French Guiana | 12 | 300 km |
| New York | 7 | 40 km |
| London | 4 | 40 km |
| Paris | 1 | 40 km |

Categories: community 10, education 9, innovation 3, environment 2.

**Known weaknesses, in the order I would fix them:**

1. **Paris has one story.** Its first harvest was mostly promotional (two
   Disneyland pieces, a football transfer, an escape-room review) and was
   discarded. Re-run it with the current validator.
2. **Cayenne is single-source** — all 12 from `franceguyane.fr`. Real, but a
   monoculture. Add a second Guianese outlet.
3. **Only 1 of 24 stories has `ai_relevance`**, so "How could AI help?" rarely
   renders. This is the "don't force an AI angle" rule working correctly.
   Loosening it would fabricate content the source does not support — ingest
   more innovation and health stories instead.
4. **Vote counters can be gamed.** Session ids are browser-generated, so a
   script can mint unlimited ones. Story content is untouchable. Fixable with a
   per-IP limit in `rate_story` if it matters.

---

## 6. Security model

Verified by query against the live database, not assumed.

| | |
|---|---|
| anon can read | published stories, locations |
| anon can call | `get_nearby_stories`, `get_story_ratings`, `rate_story`, `submit_suggestion` |
| anon **cannot** | create/edit/delete stories, read `ingestion_jobs`, `ratings` or `story_suggestions`, see `processing`/`rejected` rows — all 401 |

Two things worth carrying forward:

- **`processing` and `rejected` rows are hidden by an RLS policy filtering on
  status**, not by frontend logic. Incomplete work cannot leak.
- **`story_suggestions` has zero RLS policies and zero grants.** The only way
  in is `submit_suggestion()`, a security-definer function that validates the
  URL and place, caps note length, allows five submissions per session per day,
  and returns `{"ok":true,"id":…}` — the id of the row the caller just created
  and nothing else, never a stored value. There is still no read path at all:
  the id cannot be exchanged for the row, not even by the person who submitted
  it (`verify.mjs` checks exactly this). The id exists because
  `submit-suggestion` needs somewhere to record what the automatic check
  decided.
- **`claim_verification_slot()` is revoked from `anon` and `authenticated`.**
  It is the function that decides to spend Firecrawl and OpenAI credits, so
  nothing reachable with the publishable key may call it.
- **Supabase's defaults granted anon `TRUNCATE` on `stories`.** TRUNCATE is
  exempt from row-level security, so the public key could have wiped the table.
  All privileges were revoked and only `SELECT` granted back, including default
  privileges for future tables. **If you add a table, grant it explicitly — do
  not assume RLS alone protects it.**

`SUPABASE_SERVICE_ROLE_KEY` is still empty. It is not needed to run or browse
the site; it is needed to run `ingest-local.mjs` or deploy the edge functions.
Retrieve it from the Lovable Cloud backend settings when you want either.

---

## 7. Gotchas that cost real time

Kept because they will bite again.

- **Nominatim files French Guiana under `fr`, not `gf`.** `countrycodes=gf`
  returns zero rows for Cayenne, Kourou, Macouria, Sinnamary and Matoury. This
  silently pinned all 12 Cayenne stories to fake points around the city, one of
  them 250 km from where it happened. Geocoding now uses a bounded viewbox plus
  a distance check, and a named place that cannot be resolved in-region causes
  a rejection rather than a guess.
- **A stale project ref in Lovable's generated `.env`** pointed at
  `inpghajvnwdhmozrupfh`, which 404s. SQL through MCP reached the real database
  while every REST check went elsewhere, producing `PGRST205` errors that looked
  exactly like a broken schema cache. Hours went into that. When an API says a
  table does not exist and SQL says it does, **check the `sb-project-ref`
  response header first**.
- **Firecrawl rate limits at ~10 requests/minute** and 429s hard for the rest of
  the window once tripped. All traffic is serialised at 8 rpm with backoff.
- **Firecrawl returns 403 for nytimes.com**, wsj.com, ft.com and similar. One New
  York run burned 18 of 20 candidates on them. They are blocklisted.
- **Searching topics returns directories; searching events returns news.**
  "environmental progress" surfaced yellow pages and grant portals; "opens",
  "launches", "awarded" surfaced reported events. News source type plus regional
  outlet lists is what made the pipeline usable at all.
- **`tbs` does nothing on the news source.** It only applies to `sources:
  ["web"]`. The pipeline sent `tbs: "qdr:y"` on news-only passes for weeks, so
  the one-year bound was never enforced and nothing stopped a stale article
  being published as current. The window now goes in the query as
  `after:YYYY-MM-DD`, which the news source does honour.
- **`includeDomains` and `excludeDomains` are mutually exclusive.** The
  `news+outlets` pass therefore cannot also exclude; it relies on `isBlocked()`
  alone, which is fine because the outlet list is already an allowlist.
- **An unquoted place name matches loosely.** A Paris run published its way
  through Senegal, California and a cookie shop in Vernon. Quoting the place
  fixes that.
- **`location` and `country` barely filter anything.** Sent on every request,
  and a Cayenne harvest still returned Appalachia, Mykonos, Fontainebleau, a
  Counter-Strike roster and a car workshop in Thane - 47 of 166 candidates on
  other continents. They cost nothing so they are still sent, but do not rely
  on them. Geography is really enforced by the query text, the validator and
  the in-region geocode.
- **Place names are homonyms, but the fix belongs on ONE pass only.**
  "Cayenne" is a Porsche, a pepper and a hamlet in Pezenas; quoting it pulled in
  car reviews and pressure-washer adverts. `region_terms` on a preset adds a
  required regional term (`(Guyane OR "French Guiana")`) - **applied to the open
  passes only, never to `news+outlets`.** Measured: applying it everywhere took
  candidates from 166 to 56 and cost 20 real stories (a road bridge opening, a
  health charity going territory-wide, a children's centre), 14 of them from the
  region's own outlets, because articles name the town without repeating the
  region. The junk it targets was 65/65 off-outlet. The outlet allowlist already
  guarantees geography, so a region term there is pure recall loss.
- **The validator was confidently wrong about what "happened".** Every rule it
  needed was in `SYSTEM_PROMPT` as prose, and gpt-4o-mini still published a
  citizen consultation, a hostel's carnival travel guide, a crowdfunding launch
  and a pledge to build 104 homes - all at confidence 0.9, so `MIN_CONFIDENCE`
  never bit. The model reads "launches" as an event. It is reliable at
  *labelling* these cases and unreliable at *deciding* they disqualify, so it
  now labels (`event_status`: completed / announced / planned / consultation /
  guide / none) and `verdictFor()` decides. **Prefer a structural gate over a
  sentence in the prompt whenever the prompt is already long.**
- **Firecrawl 402 used to look like 22 unscrapeable articles.** Out of credits,
  every `/scrape` returns 402; the old code logged it and returned null, so the
  pipeline rejected each candidate as "scrape produced no usable content" and
  worked through the whole list at 8 rpm doing nothing. In `runPipeline` those
  rejected rows then count as *known* to the dedupe query, so a credit outage
  would permanently blacklist a set of perfectly good URLs. 402 and 401 now
  raise `FirecrawlAccountError`, which aborts the run and deletes the claims it
  never finished. **If a harvest reports nothing but "no usable content", check
  the log for 402 before believing it.**
- **`after:` is a request, not a guarantee.** A 2023 article was published
  through an `after:2025-08-22` query. `staleReason()` re-checks the date
  resolved from the page itself before anything is persisted. Undated articles
  are kept: plenty of real local outlets publish without machine-readable dates.
- **`sb_publishable_…` keys are opaque strings, not JWTs.** supabase-js sends
  them as `Authorization: Bearer`, which the gateway rejects.
  `src/lib/supabase.ts` strips that header and sends `apikey` alone.
- **This project sits on `X:`, an SMB share.** Windows does not deliver file
  system events over SMB, so Vite's watcher crashes; `vite.config.ts` polls
  instead. Irrelevant on a local disk.

---

## 8. Deploying

```sh
# PowerShell, because Git Bash rewrites the leading slash into a Windows path
$env:VITE_BASE = "/good-news-ai-map/"; node scripts/build-pages.mjs
```

Then push `dist/` to the `gh-pages` branch. The build copies `index.html` to
`404.html` so deep links like `/story/<id>` resolve, and **refuses to produce a
bundle containing any server-side secret** — it checks key patterns and variable
names both.

Lovable hosting was not attempted. Its scaffold uses bun and Tailwind v4 against
our v3, so it needs a compatibility pass. GitHub Pages is the working target.

---

## 9. What is deliberately not built

Per the spec: accounts, login, profiles, comments, chatbot, moderation
dashboard, admin portal, recommendations, translation, continuous crawler,
gamification, analytics.

**One deliberate addition, August 2026.** The team's landing-page mockup carried
a "Submit Story" nav item and a "Share Good News" button. Rather than a dead
link, `/submit` writes to a queue an operator triages from the CLI
(`scripts/suggestions.mjs`). It is not a moderation dashboard and not a publish
path: a suggestion is an input to Loop A, exactly like a preset, and the
article still goes through the same harvest and validation as everything else.
Nothing a visitor sends can be read back by anyone holding the public key.

**Second addition, 22 August 2026 — submissions are now checked automatically.**
The queue was a dead end: nothing automated read it, and the pipeline could not
accept a URL, only a location. `supabase/functions/submit-suggestion/` closes
that. It logs the submission, answers the browser `202` immediately, and then in
the background runs the submitted link through `processCandidate()` — the exact
per-article routine `runPipeline()` uses, extracted from it unchanged. A link
that passes is on the map in a minute or two; one that fails records the
validator's own reason on the suggestion row.

Three things hold the line this crosses:

- **There is no softer path.** `processCandidate()` is the only way any row
  reaches `published`, so a submission still has to clear `verdictFor()` —
  completed event, confidence ≥ 0.6, geography — like everything else.
- **Free checks run before paid ones.** Blocklist, URL shape, and "do we
  already hold this" all resolve at zero cost. Only then is a budget slot
  claimed.
- **`claim_verification_slot()` is the real spending cap.** The five-per-session
  limit is browser-minted friction (section 7); this is a hard global ceiling of
  50 verifications per rolling 24 hours, service-role only. Over it, submissions
  still succeed and simply wait for a person.

Still not built: a moderation dashboard. `new` in the queue now means *needs a
person* — an unresolvable place, a spent budget, or a machine rejection worth
overruling.

---

## 10. Files kept out of the repo

- `transcripts/` — the hackathon's own course transcripts, 6.1 MB. Third-party
  material, not ours to republish on a public repo.
- `*.docx` / `*.pdf` — the JF MÉDIAS branded technical review, in French and
  English. Internal documents; they live in the working directory. Remove the
  ignore rule if the team wants them versioned.
