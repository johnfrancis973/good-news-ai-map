# Good News AI Map — handover

State at the end of the overnight session. Read the **Blocker** section first;
everything else is done and verified.

---

## 1. The one blocker (~30 seconds to clear)

**The Supabase REST API cannot see the tables.** Every request returns:

```
PGRST205  Could not find the table 'public.stories' in the schema cache
```

The database itself is completely fine — schema, data, security and the
read-path functions are all verified working through direct SQL. It is
PostgREST's schema cache that is empty and will not rebuild.

### Fix

In the Lovable chat for the project, ask it to **refresh the database schema /
regenerate the Supabase types**. Its migration pipeline rebuilds the API layer.
This costs Lovable credits, which is why it was left for you.

Confirm it worked:

```sh
node scripts/verify.mjs
```

Everything downstream is already in place, so the app should light up
immediately after.

### What was already ruled out

Each of these was tested against the live database, and every setting was
returned to its Supabase default afterwards.

| Hypothesis | Finding |
|---|---|
| Stale cache | `NOTIFY pgrst, 'reload schema'` had no effect |
| DDL watch trigger missing | `pgrst_ddl_watch` present and enabled |
| Wrong database | PostgREST is connected to this exact DB; `sb-project-ref` header matches |
| Missing privileges | `authenticator` and `anon` both see all four tables in the catalog |
| Exposed-schema config | overriding `pgrst.db_schemas` changed nothing |
| Statement timeout | raising `authenticator`'s 8s timeout changed nothing |
| Dead connection | terminating the backend forced a clean reconnect; cache still empty |
| Our own code | Lovable's generated `types.ts` reads `Tables: { [_ in never]: never }` — its tooling cannot see them either |

---

## 2. What exists

**Lovable project** `a9b1c62b-8943-42e7-8e7e-ac3f05331fc6`
· editor: https://lovable.dev/projects/a9b1c62b-8943-42e7-8e7e-ac3f05331fc6
**Supabase** `inpghajvnwdhmozrupfh` · Postgres 17.6

**Code** lives in `x:\hackathon`, committed locally, not pushed anywhere.

Lovable's own repo is a separate scaffold we are not using. It began as
TanStack Start and later converted to plain Vite; either way our app is the one
in this directory.

### Environment

- `.env.local` — `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. Public by
  design, they ship in the bundle.
- `.env.ingest` — `OPENAI_API_KEY`, `FIRECRAWL_API_KEY`, `SUPABASE_URL`,
  `INGEST_ADMIN_TOKEN`. Server-side only, gitignored, never bundled.
- `SUPABASE_SERVICE_ROLE_KEY` is still **empty**. Not required so far: all
  writes went through Lovable's MCP `query_database`. It is needed only to run
  `scripts/ingest-local.mjs` or to deploy the edge function.

---

## 3. Verified

Every line below was checked against the live database, not assumed.

**Security**

- anon sees only `status = 'published'`; a `processing` row is invisible to it
- anon has no INSERT / UPDATE / DELETE / **TRUNCATE** / TRIGGER on any table
- anon cannot read `ingestion_jobs` or `ratings` at all
- duplicate `source_url` is rejected by a unique constraint
- ratings: one row per session, re-voting replaces, out-of-range and oversized
  session ids refused, rows cascade-delete with the story
- no `markdown` / `html` / `content` / `body` / `raw` column exists on `stories`,
  so storing article text is impossible by construction
- `dist/` contains zero server-side secrets

Supabase's defaults had granted anon `TRUNCATE` on `stories`. **TRUNCATE is
exempt from row-level security**, so the anon key could have wiped the table.
That grant is revoked, and default privileges for future tables with it.

**Read path**

- `get_nearby_stories` returns exactly the columns the frontend types expect
- haversine distance is correct (a story 20 km out reports 20)
- radius and category filters work; `processing` rows never leak

---

## 4. Data

17 published stories across 3 locations, every one traced to a real source URL.

| Location | Stories |
|---|---|
| Cayenne / French Guiana | 12 |
| London | 4 |
| Paris | 1 |

Known weaknesses, in priority order:

1. **Paris is thin.** Its first harvest returned mostly promotional and
   celebrity material — two Disneyland pieces, a football transfer, an escape
   room review. Only the Notre-Dame redevelopment was kept. Re-harvest with the
   tightened validator.
2. **Cayenne is single-source.** All 12 stories come from `franceguyane.fr`.
   Real, but a monoculture.
3. **Only one story has `ai_relevance = true`** (London's £12m AI support
   package). That is the "don't force an AI angle" rule working correctly, but
   it means the "How could AI help?" section barely appears. Loosening the rule
   to manufacture an angle would be the fabrication the spec forbids — better to
   ingest more innovation and health stories, which have genuine ones.

---

## 5. Next steps

1. Clear the blocker above.
2. `npm run dev`, walk Cayenne → map → marker → story → source → rate → share.
3. Re-harvest Paris and top up Cayenne from a second outlet:
   ```sh
   node scripts/known-urls.mjs
   node scripts/harvest.mjs --preset paris --known harvest/known-urls.json
   ```
4. Decide on the live URL. The app is a static SPA plus Supabase, so any static
   host works and no SSR is involved.

---

## 6. Things learned the hard way

Kept because they will bite again.

- **Nominatim files French Guiana under `fr`, not `gf`.** `countrycodes=gf`
  returns zero rows for Cayenne, Kourou, Macouria and every other town. This
  silently pinned all 12 stories to jittered points around Cayenne while
  labelling them "Cayenne" — including one about a town 250 km away. Geocoding
  now uses a bounded viewbox plus a distance check, and a named place that
  cannot be resolved in-region is a rejection rather than a guess.
- **Firecrawl rate limits at ~10 requests/minute** on this account and 429s hard
  for the rest of the window once tripped. All traffic is serialised at 8 rpm.
- **Firecrawl returns 403 for nytimes.com**, wsj.com, ft.com and similar. Those
  are blocklisted before they can cost a request.
- **Searching topics returns directories; searching events returns news.**
  "environmental progress" surfaced yellow pages and grant portals;
  "inaugurates", "launches", "awarded" surfaced reported events. The news source
  type plus regional outlet lists is what made the pipeline usable.
- **Supabase's newer `sb_publishable_…` keys are opaque, not JWTs.** supabase-js
  sends them as `Authorization: Bearer`, which the gateway rejects; the header
  must be dropped and the key sent as `apikey` alone.
