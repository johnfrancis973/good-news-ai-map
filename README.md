# Good News AI Map

**See what's getting better around you.**

**Live: https://johnfrancis973.github.io/good-news-ai-map/**

Discover real positive stories near you, understand why they matter, and find
simple ways to take part.

---

## The one architectural rule

> **WRITE SLOW → DATABASE → READ FAST**

Two loops that meet only through Postgres.

**Loop A — ingestion (slow, backend only, 15–40s+)**

```
Location → Firecrawl Search → candidate URLs → deduplicate
        → snippet triage → Firecrawl Scrape
        → OpenAI validation/enrichment → Postgres
```

**Loop B — browsing (fast, what users actually touch)**

```
User searches location → query Postgres → map + stories
                      → open a story → read the finished row
```

Firecrawl and OpenAI are **never** called while a user waits. If both APIs went
offline right now, every published story would still browse perfectly. There is
no Firecrawl or OpenAI import anywhere under `src/`.

---

## Stack

Vite · React · TypeScript · Tailwind · react-leaflet + OpenStreetMap ·
TanStack Query · Supabase/Lovable Cloud (Postgres + Edge Functions) ·
Firecrawl (search + scrape) · OpenAI `gpt-4o-mini` (structured output) ·
Nominatim (geocoding)

---

## Layout

```
src/lib/queries.ts                    read path — Postgres only
src/pages/{Home,Explore,StoryDetail}  the three screens
src/pages/Submit.tsx                  public suggestion form -> queue, not the map
src/components/StoryMap.tsx           react-leaflet + OSM
supabase/migrations/0001_init.sql     schema, RLS, RPCs
supabase/migrations/0002_suggestions.sql  the suggestion queue
supabase/migrations/0003_suggestion_verification.sql  auto-check + daily spend cap
supabase/functions/ingest-location/   write path: pipeline.js (shared) + index.ts (HTTP)
supabase/functions/submit-suggestion/ public: logs a link, then checks it in the background
supabase/functions/geocode/           Nominatim proxy, no keys
scripts/ingest.mjs                    operator CLI -> deployed edge function
scripts/ingest-local.mjs              same pipeline, run locally
scripts/suggestions.mjs               read and triage what the public suggested
```

---

## Setup

### 1. Environment

`.env.local` — frontend, public by design:

```dotenv
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

`.env.ingest` — **server-side only, never bundled, gitignored**:

```dotenv
OPENAI_API_KEY=
FIRECRAWL_API_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_URL=
INGEST_ADMIN_TOKEN=
```

Vite inlines every `VITE_`-prefixed variable into the browser bundle. The
OpenAI, Firecrawl and service-role keys must never carry that prefix and must
never appear in `.env.local` or anywhere under `src/`.

The same four secrets must also be set in **Lovable Cloud → Secrets**, which is
where the edge functions read them from.

### 2. Database

Apply `supabase/migrations/0001_init.sql`, then `0002_suggestions.sql` (Lovable
MCP `query_database`, or the Supabase SQL editor). Both are already applied on
the live project, as is `0003_suggestion_verification.sql` (applied
2026-08-22).

`supabase/functions/submit-suggestion` is **not yet deployed**, so `/submit`
still only queues. Deploy it before publishing a frontend built from this
commit — the new bundle calls that function, and until it exists every
submission 404s. See HANDOVER section 9.

### 2b. Check it works

```sh
node scripts/verify.mjs
```

Acceptance checks against the live API: the read path, every row-level
security guarantee, the anonymous rating flow and the suggestion queue —
including that a submission cannot be read back with its own id and that the
publishable key cannot claim a verification slot. Exits non-zero on failure.

### 3. Run

```sh
npm install
npm run dev
```

### 4. Ingest a location (Loop A)

Against the deployed edge function:

```sh
node scripts/ingest.mjs --preset cayenne
node scripts/ingest.mjs "Cayenne" 4.9227 -52.3269 --radius 150 --cc gf
node scripts/ingest.mjs --status <job_id>
```

Or collect offline, which needs neither a deployed function nor a service role
key:

```sh
node scripts/known-urls.mjs
node scripts/harvest.mjs --preset paris --known harvest/known-urls.json
```

With a service role key in `.env.ingest`, `scripts/ingest-local.mjs` runs the
same pipeline and writes straight to the database.

Both paths import the same `supabase/functions/ingest-location/pipeline.js`, so
they cannot drift apart. Either way, browsing the site during ingestion is
completely unaffected.

### 5. Triage what the public suggested

`/submit` lets a visitor send in a link. It reaches a queue, never the site
directly. Most links are now judged automatically: `submit-suggestion` logs the
submission, answers the browser immediately, and then runs the link through the
same `processCandidate()` every harvested story goes through.

```sh
node scripts/suggestions.mjs                    # everything still 'new'
node scripts/suggestions.mjs --status rejected  # what the check refused, and why
node scripts/suggestions.mjs --mark <id> harvested
```

Needs `SUPABASE_SERVICE_ROLE_KEY`: the publishable key cannot read that table,
which is the point. `new` now means **needs a person** — a place the geocoder
could not resolve, a submission that arrived after the day's verification budget
was spent, or a machine rejection worth overruling. A suggestion is still a
lead, not a story: only the pipeline can publish one.

---

## Guarantees

- **Every story traces to a real source URL.** Nothing is invented.
- **Scraped article text is never persisted.** Markdown lives in an edge
  function variable during processing and is discarded. Only source metadata and
  our own generated content is stored.
- **Only `status = 'published'` is publicly readable**, enforced by a row-level
  security policy — not by frontend filtering. Incomplete or failed processing
  can never become publicly visible.
- **`source_url` is UNIQUE at database level.** Duplicates are dropped before
  they cost a scrape or a model call.
- **Public users cannot write to anything that is displayed.** No
  insert/update/delete policy exists for the anonymous role on any table. The
  two permitted writes each go through a single `SECURITY DEFINER` function:
  ratings (one vote per session, enforced by a unique index) and story
  suggestions (validated, rate limited, into a table nobody can read back).
- **A suggestion is not a publication.** `/submit` writes to
  `story_suggestions`, which no public key can select from. A submitted link
  reaches the map only by passing the same validation as everything else —
  there is one publishing routine, `processCandidate()`, and no way around it.
- **Location ingestion is gated** behind an admin token, so the public cannot
  start a harvest. Submission verification is public by necessity, so it is
  bounded instead: free checks before any paid call, five submissions per
  session per day, and a hard global ceiling of 50 verifications per 24 hours
  (`claim_verification_slot`, service-role only). Past the ceiling, submissions
  still succeed and simply wait for a person.

---

See [HANDOVER.md](HANDOVER.md) for the full handoff: current data, security
model, deployment, and the platform quirks that cost real time.

Map data © OpenStreetMap contributors. Story facts belong to the publishers
linked from each story page.
