# Good News AI Map — handoff

Everything needed to pick this up cold. Verified against the live system, not
recalled from memory.

| | |
|---|---|
| **Live site** | https://johnfrancis973.github.io/good-news-ai-map/ |
| **Source** | https://github.com/johnfrancis973/good-news-ai-map (public) |
| **Database** | Lovable Cloud / Supabase `oskgbaudwjxttfzxzbmx`, PostgreSQL 17.6 |
| **Lovable project** | `a9b1c62b-8943-42e7-8e7e-ac3f05331fc6` |
| **Status** | Working end to end. 24 stories, 4 locations, 29/29 checks passing. |

Run `node scripts/verify.mjs` at any time. It exercises the live API exactly as
a browser does and exits non-zero if anything is broken.

---

## 1. The one rule

**Write slow → database → read fast.** Two loops that meet only in PostgreSQL.

```
Loop A, write (slow, 3-5 min per location, run by an operator)
  Location → Firecrawl Search → candidate URLs → deduplicate
           → Firecrawl Scrape → OpenAI validation → PostgreSQL

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

`harvest.mjs` runs search → dedupe → scrape → validate and writes finished
stories to `harvest/<place>.json` along with every rejection and its reason.
Read those reasons: they are the fastest way to see whether the validator is
behaving.

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
supabase/functions/ingest-location/
  pipeline.js                         ALL ingestion logic, shared
  index.ts                            HTTP wrapper (not deployed yet)
scripts/harvest.mjs                   offline collection → JSON
scripts/ingest-local.mjs              same pipeline, writes to the DB
scripts/suggestions.mjs               read/triage the queue (needs the service key)
scripts/verify.mjs                    29 acceptance checks against the live API
scripts/build-pages.mjs               production build + secret guard
```

`pipeline.js` is plain JavaScript depending only on `fetch` and a Supabase
client passed in as an argument, so the edge function and both local runners use
identical logic. **Change ingestion behaviour there and nowhere else.**

---

## 5. Data

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
  and returns `{"ok":true}` — never an id, never a stored value. There is no
  read path at all, not even for the person who submitted the row.
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

---

## 10. Files kept out of the repo

- `transcripts/` — the hackathon's own course transcripts, 6.1 MB. Third-party
  material, not ours to republish on a public repo.
- `*.docx` / `*.pdf` — the JF MÉDIAS branded technical review, in French and
  English. Internal documents; they live in the working directory. Remove the
  ignore rule if the team wants them versioned.
