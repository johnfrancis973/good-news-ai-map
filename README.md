# Good News AI Map

**See what's getting better around you.**

Discover real positive stories near you, understand why they matter, and find
simple ways to take part.

---

## The one architectural rule

> **WRITE SLOW → DATABASE → READ FAST**

Two loops that meet only through Postgres.

**Loop A — ingestion (slow, backend only, 15–40s+)**

```
Location → Firecrawl Search → candidate URLs → deduplicate
        → Firecrawl Scrape → OpenAI validation/enrichment → Postgres
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
src/components/StoryMap.tsx           react-leaflet + OSM
supabase/migrations/0001_init.sql     schema, RLS, RPCs
supabase/functions/ingest-location/   write path (Firecrawl + OpenAI)
supabase/functions/geocode/           Nominatim proxy, no keys
scripts/ingest.mjs                    operator CLI for the write path
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

Apply `supabase/migrations/0001_init.sql` (Lovable MCP `query_database`, or the
Supabase SQL editor).

### 3. Run

```sh
npm install
npm run dev
```

### 4. Ingest a location (Loop A)

```sh
node scripts/ingest.mjs --preset cayenne
node scripts/ingest.mjs "Cayenne" 4.9227 -52.3269 --radius 150 --cc gf
node scripts/ingest.mjs --status <job_id>
```

The script returns a `job_id` immediately and then polls the job row. Browsing
the site during ingestion is completely unaffected.

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
- **Public users cannot write.** No insert/update/delete policy exists for the
  anonymous role on any table. Ratings go through one `SECURITY DEFINER`
  function with a one-vote-per-session unique index.
- **Ingestion is gated** behind an admin token, so the public cannot burn
  Firecrawl or OpenAI credits.

---

Map data © OpenStreetMap contributors. Story facts belong to the publishers
linked from each story page.
