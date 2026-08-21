// ingest-location — LOOP A, the WRITE path.
//
// Location -> Firecrawl Search -> candidate URLs -> deduplicate ->
// Firecrawl Scrape -> OpenAI validation/enrichment -> Postgres.
//
// This is slow (15-40s+) and is NEVER on a user's browsing request path.
// It returns 202 + job_id immediately and finishes in the background.
//
// Secrets (OPENAI_API_KEY, FIRECRAWL_API_KEY, SUPABASE_SERVICE_ROLE_KEY) are
// read from the environment here and never leave this function.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { corsHeaders, json } from "../_shared/cors.ts";

const FIRECRAWL_BASE = "https://api.firecrawl.dev/v2";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "GoodNewsAIMap/1.0 (hackathon MVP)";

const MAX_CANDIDATES = 20;
const SCRAPE_CONCURRENCY = 3;
const MAX_MARKDOWN_CHARS = 8000;
const MIN_CONFIDENCE = 0.6;

const CATEGORIES = [
  "environment",
  "community",
  "education",
  "health",
  "innovation",
  "other",
] as const;

// Domains that never yield a citable single article.
const DOMAIN_BLOCKLIST = [
  "facebook.com", "instagram.com", "x.com", "twitter.com", "tiktok.com",
  "youtube.com", "youtu.be", "pinterest.com", "linkedin.com", "reddit.com",
  "amazon.", "ebay.", "tripadvisor.", "booking.com", "wikipedia.org",
  "google.com", "news.google.com", "bing.com", "yahoo.com",
];

const TRACKING_PARAMS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "fbclid", "gclid", "mc_cid", "mc_eid", "ref", "source", "amp",
];

type SearchTheme = { key: string; en: string; fr: string };

const THEMES: SearchTheme[] = [
  { key: "community",   en: "community initiative",       fr: "initiative associative locale" },
  { key: "environment", en: "environmental progress",     fr: "projet environnemental réussite" },
  { key: "education",   en: "education success",          fr: "réussite éducative école" },
  { key: "health",      en: "health progress",            fr: "progrès santé initiative" },
  { key: "innovation",  en: "innovation local project",   fr: "innovation projet local" },
  { key: "environment2",en: "conservation biodiversity",  fr: "conservation biodiversité" },
  { key: "improvement", en: "local improvement project",  fr: "amélioration cadre de vie projet" },
];

// Regions where French-language sources dominate.
const FRENCH_HINTS = [
  "guyane", "cayenne", "kourou", "france", "paris", "martinique",
  "guadeloupe", "réunion", "reunion", "mayotte", "lyon", "marseille",
];

const SYSTEM_PROMPT = `You validate and structure constructive ("good news") journalism for a public map.

You are given ONE article's extracted text plus its source URL. Decide whether it qualifies, then produce structured content.

REJECT the article (accepted=false) if ANY of these is true:
- it is not a real, specific event or development
- the event cannot be traced to the supplied source text
- it is primarily negative with only incidental positivity
- it is advertising, PR or marketing disguised as news
- it is unsupported opinion or a column with no reported event
- it is irrelevant to the target geography given below
- the content is too thin to summarise confidently
- source credibility or content quality is too weak
- the text is an index page, paywall stub, cookie notice or navigation shell

ABSOLUTE ANTI-FABRICATION RULE.
Never invent people, organisations, numbers, statistics, dates, quotations,
outcomes or locations. Every fact you write must be present in the supplied text.
If a detail is missing, omit it. If you cannot summarise confidently, reject the
article rather than guess. A rejected article costs nothing; a fabricated one is
a total failure.

WHEN ACCEPTED, produce:
- summary: what happened, factual, ~100 words maximum, no editorialising.
- why_it_matters: why this development is significant. 1-3 sentences.
- lessons: up to 3 genuinely useful, transferable lessons. Fewer is fine. No filler.
- actions: exactly 3 where possible. Realistic, concrete, safe, related to THIS
  story, achievable by an ordinary person. Never invent phone numbers, event
  dates, donation URLs, organisation contact details or opportunities that the
  source does not support. If the source lacks specifics, keep the action
  appropriately general rather than fabricating detail.
- future_outlook: a short, plainly forward-looking and clearly speculative
  outlook on how this could plausibly develop. Do not state it as fact.
- ai_relevance / ai_outlook: set ai_relevance=true ONLY when AI genuinely has a
  meaningful, concrete potential contribution to this specific situation. Then
  ai_outlook explains it in 1-3 sentences. Otherwise ai_relevance=false and
  ai_outlook=null. Do NOT force an AI angle onto stories that have none.
- location_hint: the most specific real place named in the article (city, town
  or district plus region), taken from the text only. null if not stated.
- published_date: ISO 8601 date of publication if clearly present. Otherwise null.
- source_name: the publication/outlet name if identifiable. Otherwise null.
- confidence: 0..1, your honest confidence that this is a real, verifiable,
  constructive story from a credible source.

Write in English regardless of the article's language.`;

// ---------------------------------------------------------------- helpers

// Combining diacritical marks, built from char codes so this source file
// stays pure ASCII and survives any re-encoding.
const COMBINING_MARKS = new RegExp(
  "[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]",
  "g",
);

function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.protocol = "https:";
    u.hash = "";
    for (const p of TRACKING_PARAMS) u.searchParams.delete(p);
    u.hostname = u.hostname.replace(/^www\./, "");
    let out = u.toString();
    if (out.endsWith("/") && u.pathname !== "/") out = out.slice(0, -1);
    return out;
  } catch {
    return null;
  }
}

function isBlocked(url: string): boolean {
  const lower = url.toLowerCase();
  return DOMAIN_BLOCKLIST.some((d) => lower.includes(d));
}

function usesFrench(location: string): boolean {
  const n = normalizeName(location);
  return FRENCH_HINTS.some((h) => n.includes(normalizeName(h)));
}

function firstString(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (Array.isArray(v)) {
    const s = v.find((x) => typeof x === "string" && x.trim());
    return typeof s === "string" ? s.trim() : null;
  }
  return null;
}

function toIso(value: unknown): string | null {
  const s = firstString(value);
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  // Reject absurd dates rather than storing nonsense.
  const year = d.getUTCFullYear();
  if (year < 1990 || year > new Date().getUTCFullYear() + 1) return null;
  return d.toISOString();
}

// Deterministic small offset so several stories at the same fallback centre
// do not stack into a single unclickable marker.
function jitter(seed: string, index: number): [number, number] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const angle = ((Math.abs(h) % 360) + index * 47) * (Math.PI / 180);
  const radius = 0.012 + ((Math.abs(h >> 8) % 40) / 1000);
  return [Math.sin(angle) * radius, Math.cos(angle) * radius];
}

async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------- Firecrawl

async function firecrawlSearch(
  apiKey: string,
  query: string,
  limit: number,
): Promise<Array<{ url: string; title: string | null; description: string | null }>> {
  const res = await fetch(`${FIRECRAWL_BASE}/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      limit,
      sources: [{ type: "web" }],
      tbs: "qdr:y",
    }),
  });

  if (!res.ok) {
    console.error("firecrawl search failed", res.status, await res.text());
    return [];
  }

  const body = await res.json();
  // v2 returns { data: { web: [...] } }; be tolerant of a bare array.
  const rows = Array.isArray(body?.data)
    ? body.data
    : (body?.data?.web ?? body?.data?.news ?? []);
  if (!Array.isArray(rows)) return [];

  return rows
    .map((r: Record<string, unknown>) => ({
      url: typeof r?.url === "string" ? r.url : "",
      title: firstString(r?.title),
      description: firstString(r?.description),
    }))
    .filter((r: { url: string }) => r.url.length > 0);
}

type Scraped = {
  markdown: string;
  title: string | null;
  sourceName: string | null;
  publishedAt: string | null;
  imageUrl: string | null;
};

async function firecrawlScrape(apiKey: string, url: string): Promise<Scraped | null> {
  const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
      timeout: 30000,
    }),
  });

  if (!res.ok) {
    console.error("firecrawl scrape failed", url, res.status);
    return null;
  }

  const body = await res.json();
  const data = body?.data ?? {};
  const md = typeof data?.markdown === "string" ? data.markdown : "";
  if (md.trim().length < 400) return null; // too thin to summarise honestly

  const meta = data?.metadata ?? {};
  const image = firstString(meta?.ogImage) ?? firstString(meta?.["og:image"]);

  return {
    // Held in memory only. Never written to the database.
    markdown: md.slice(0, MAX_MARKDOWN_CHARS),
    title: firstString(meta?.title) ?? firstString(meta?.["og:title"]),
    sourceName: firstString(meta?.ogSiteName) ?? firstString(meta?.["og:site_name"]),
    publishedAt:
      toIso(meta?.publishedTime) ??
      toIso(meta?.["article:published_time"]) ??
      toIso(meta?.modifiedTime),
    imageUrl: image && /^https?:\/\//.test(image) ? image : null,
  };
}

// ---------------------------------------------------------------- OpenAI

type Decision = {
  accepted: boolean;
  rejection_reason: string | null;
  confidence: number;
  category: string;
  summary: string | null;
  why_it_matters: string | null;
  lessons: string[];
  actions: string[];
  future_outlook: string | null;
  ai_relevance: boolean;
  ai_outlook: string | null;
  location_hint: string | null;
  published_date: string | null;
  source_name: string | null;
};

const DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "accepted", "rejection_reason", "confidence", "category", "summary",
    "why_it_matters", "lessons", "actions", "future_outlook", "ai_relevance",
    "ai_outlook", "location_hint", "published_date", "source_name",
  ],
  properties: {
    accepted: { type: "boolean" },
    rejection_reason: { type: ["string", "null"] },
    confidence: { type: "number" },
    category: { type: "string", enum: CATEGORIES },
    summary: { type: ["string", "null"] },
    why_it_matters: { type: ["string", "null"] },
    lessons: { type: "array", items: { type: "string" } },
    actions: { type: "array", items: { type: "string" } },
    future_outlook: { type: ["string", "null"] },
    ai_relevance: { type: "boolean" },
    ai_outlook: { type: ["string", "null"] },
    location_hint: { type: ["string", "null"] },
    published_date: { type: ["string", "null"] },
    source_name: { type: ["string", "null"] },
  },
};

async function enrich(
  apiKey: string,
  args: { url: string; title: string | null; markdown: string; locationName: string },
): Promise<Decision | null> {
  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `TARGET GEOGRAPHY: ${args.locationName}\n` +
            `SOURCE URL: ${args.url}\n` +
            `SOURCE TITLE: ${args.title ?? "(unknown)"}\n\n` +
            `ARTICLE TEXT:\n"""\n${args.markdown}\n"""`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "story_decision", strict: true, schema: DECISION_SCHEMA },
      },
    }),
  });

  if (!res.ok) {
    console.error("openai failed", res.status, await res.text());
    return null;
  }

  const body = await res.json();
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return null;

  try {
    return JSON.parse(content) as Decision;
  } catch {
    console.error("openai returned unparseable content");
    return null;
  }
}

// ---------------------------------------------------------------- geocoding

async function geocode(
  place: string,
  countryCode: string | null,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const params = new URLSearchParams({ q: place, format: "json", limit: "1" });
    if (countryCode) params.set("countrycodes", countryCode.toLowerCase());
    const res = await fetch(`${NOMINATIM}?${params}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const rows = await res.json();
    const hit = Array.isArray(rows) ? rows[0] : null;
    if (!hit) return null;
    const lat = parseFloat(hit.lat);
    const lng = parseFloat(hit.lon);
    if (isNaN(lat) || isNaN(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- pipeline

type Payload = {
  location: string;
  latitude: number;
  longitude: number;
  radius_km?: number;
  country?: string;
  country_code?: string;
  max_candidates?: number;
  queries?: string[];
};

async function runPipeline(
  supabase: ReturnType<typeof createClient>,
  keys: { firecrawl: string; openai: string },
  payload: Payload,
  jobId: string,
  locationId: string,
) {
  const stats = { found: 0, processed: 0, published: 0, rejected: 0 };
  const locationName = payload.location;
  const maxCandidates = Math.min(payload.max_candidates ?? MAX_CANDIDATES, 40);

  try {
    // --- STEP 1: Firecrawl Search -------------------------------------
    await supabase
      .from("ingestion_jobs")
      .update({ status: "searching", started_at: new Date().toISOString() })
      .eq("id", jobId);

    const french = usesFrench(locationName);
    const queries =
      payload.queries?.length
        ? payload.queries.slice(0, 8)
        : THEMES.map((t) => `${locationName} ${french ? t.fr : t.en}`);

    const searchResults = await pool(queries, 3, (q) =>
      firecrawlSearch(keys.firecrawl, q, 8),
    );

    // --- STEP 2: candidate URLs ---------------------------------------
    const seen = new Set<string>();
    const candidates: Array<{ url: string; title: string | null }> = [];
    for (const batch of searchResults) {
      for (const hit of batch) {
        const url = normalizeUrl(hit.url);
        if (!url || seen.has(url) || isBlocked(url)) continue;
        seen.add(url);
        candidates.push({ url, title: hit.title });
      }
    }

    stats.found = candidates.length;
    await supabase
      .from("ingestion_jobs")
      .update({
        status: "processing",
        search_query: queries.join(" | "),
        candidates_found: stats.found,
      })
      .eq("id", jobId);

    if (candidates.length === 0) {
      await supabase
        .from("ingestion_jobs")
        .update({ status: "completed", finished_at: new Date().toISOString() })
        .eq("id", jobId);
      return;
    }

    // --- STEP 3: DEDUPLICATE BEFORE SCRAPING --------------------------
    // Already-known URLs must never cost a Firecrawl scrape or an OpenAI call.
    const { data: existing } = await supabase
      .from("stories")
      .select("source_url")
      .in("source_url", candidates.map((c) => c.url));

    const known = new Set((existing ?? []).map((r: { source_url: string }) => r.source_url));
    const fresh = candidates.filter((c) => !known.has(c.url)).slice(0, maxCandidates);

    if (fresh.length === 0) {
      await supabase
        .from("ingestion_jobs")
        .update({ status: "completed", finished_at: new Date().toISOString() })
        .eq("id", jobId);
      return;
    }

    // Claim each URL as 'processing' before any work. The UNIQUE constraint on
    // source_url makes concurrent runs safe, and a claimed row is invisible to
    // the public until it is explicitly promoted to 'published'.
    const claimed: Array<{ id: string; url: string; title: string | null }> = [];
    for (const c of fresh) {
      const { data, error } = await supabase
        .from("stories")
        .insert({
          title: c.title ?? c.url,
          source_url: c.url,
          location_id: locationId,
          location_name: locationName,
          latitude: payload.latitude,
          longitude: payload.longitude,
          status: "processing",
        })
        .select("id")
        .maybeSingle();

      if (error || !data) continue; // duplicate claimed elsewhere, or insert failed
      claimed.push({ id: data.id as string, url: c.url, title: c.title });
    }

    // --- STEPS 4+5: scrape, then validate/enrich ----------------------
    await pool(claimed, SCRAPE_CONCURRENCY, async (item, index) => {
      try {
        const scraped = await firecrawlScrape(keys.firecrawl, item.url);
        if (!scraped) {
          await reject(supabase, item.id, "scrape produced no usable content");
          stats.rejected++;
          return;
        }

        const decision = await enrich(keys.openai, {
          url: item.url,
          title: scraped.title ?? item.title,
          markdown: scraped.markdown,
          locationName,
        });

        if (!decision) {
          await reject(supabase, item.id, "enrichment failed");
          stats.rejected++;
          return;
        }

        if (!decision.accepted || decision.confidence < MIN_CONFIDENCE) {
          await reject(
            supabase,
            item.id,
            decision.rejection_reason ??
              `confidence ${decision.confidence} below ${MIN_CONFIDENCE}`,
          );
          stats.rejected++;
          return;
        }

        // Refuse to publish a structurally incomplete story.
        if (!decision.summary || !decision.why_it_matters || decision.actions.length === 0) {
          await reject(supabase, item.id, "incomplete enrichment output");
          stats.rejected++;
          return;
        }

        // Coordinates: prefer the place actually named in the article.
        let lat = payload.latitude;
        let lng = payload.longitude;
        let placeName = locationName;
        if (decision.location_hint) {
          const hit = await geocode(decision.location_hint, payload.country_code ?? null);
          if (hit) {
            lat = hit.lat;
            lng = hit.lng;
            placeName = decision.location_hint;
          }
        }
        if (lat === payload.latitude && lng === payload.longitude) {
          const [dLat, dLng] = jitter(item.url, index);
          lat += dLat;
          lng += dLng;
        }

        // Only our own generated content plus source metadata is persisted.
        // The scraped markdown is discarded when this closure returns.
        const { error: updateError } = await supabase
          .from("stories")
          .update({
            title: scraped.title ?? item.title ?? item.url,
            source_name: decision.source_name ?? scraped.sourceName ?? new URL(item.url).hostname,
            published_at: toIso(decision.published_date) ?? scraped.publishedAt,
            location_name: placeName,
            latitude: lat,
            longitude: lng,
            category: CATEGORIES.includes(decision.category as typeof CATEGORIES[number])
              ? decision.category
              : "other",
            summary: decision.summary,
            why_it_matters: decision.why_it_matters,
            lessons: decision.lessons.slice(0, 3),
            actions: decision.actions.slice(0, 3),
            future_outlook: decision.future_outlook,
            ai_relevance: decision.ai_relevance === true && !!decision.ai_outlook,
            ai_outlook: decision.ai_relevance === true ? decision.ai_outlook : null,
            image_url: scraped.imageUrl,
            confidence_score: decision.confidence,
            rejection_reason: null,
            status: "published",
          })
          .eq("id", item.id);

        if (updateError) {
          await reject(supabase, item.id, `publish failed: ${updateError.message}`);
          stats.rejected++;
          return;
        }

        stats.published++;
      } catch (err) {
        // Any failure leaves the row non-public.
        await reject(supabase, item.id, `error: ${String(err).slice(0, 300)}`);
        stats.rejected++;
      } finally {
        stats.processed++;
        await supabase
          .from("ingestion_jobs")
          .update({
            candidates_processed: stats.processed,
            stories_published: stats.published,
            stories_rejected: stats.rejected,
          })
          .eq("id", jobId);
      }
    });

    await supabase
      .from("ingestion_jobs")
      .update({
        status: "completed",
        candidates_processed: stats.processed,
        stories_published: stats.published,
        stories_rejected: stats.rejected,
        finished_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    await supabase
      .from("locations")
      .update({ last_ingested_at: new Date().toISOString() })
      .eq("id", locationId);
  } catch (err) {
    console.error("pipeline failed", err);
    await supabase
      .from("ingestion_jobs")
      .update({
        status: "failed",
        error_message: String(err).slice(0, 1000),
        candidates_processed: stats.processed,
        stories_published: stats.published,
        stories_rejected: stats.rejected,
        finished_at: new Date().toISOString(),
      })
      .eq("id", jobId);
  }
}

async function reject(
  supabase: ReturnType<typeof createClient>,
  storyId: string,
  reason: string,
) {
  await supabase
    .from("stories")
    .update({ status: "rejected", rejection_reason: reason.slice(0, 500) })
    .eq("id", storyId);
}

// ---------------------------------------------------------------- handler

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  // Gate BEFORE touching any paid API. Without this the public could burn
  // Firecrawl and OpenAI credits at will.
  const adminToken = Deno.env.get("INGEST_ADMIN_TOKEN");
  if (!adminToken || req.headers.get("x-admin-token") !== adminToken) {
    return json({ error: "unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");

  if (!supabaseUrl || !serviceKey) {
    return json({ error: "database not configured" }, 500);
  }
  if (!firecrawlKey || !openaiKey) {
    return json({ error: "FIRECRAWL_API_KEY and OPENAI_API_KEY must be set" }, 500);
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  if (
    !payload?.location ||
    typeof payload.latitude !== "number" ||
    typeof payload.longitude !== "number" ||
    Math.abs(payload.latitude) > 90 ||
    Math.abs(payload.longitude) > 180
  ) {
    return json({ error: "location, latitude and longitude are required" }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // Upsert the location.
  const normalized = normalizeName(payload.location);
  const { data: location, error: locError } = await supabase
    .from("locations")
    .upsert(
      {
        name: payload.location,
        normalized_name: normalized,
        country: payload.country ?? null,
        country_code: payload.country_code ?? null,
        latitude: payload.latitude,
        longitude: payload.longitude,
        default_radius_km: Math.round(payload.radius_km ?? 50),
      },
      { onConflict: "normalized_name" },
    )
    .select("id")
    .single();

  if (locError || !location) {
    return json({ error: `could not upsert location: ${locError?.message}` }, 500);
  }

  const { data: job, error: jobError } = await supabase
    .from("ingestion_jobs")
    .insert({ location_id: location.id, status: "queued" })
    .select("id")
    .single();

  if (jobError || !job) {
    return json({ error: `could not create job: ${jobError?.message}` }, 500);
  }

  // Fire and forget. The browsing loop never waits on this.
  const work = runPipeline(
    supabase,
    { firecrawl: firecrawlKey, openai: openaiKey },
    payload,
    job.id as string,
    location.id as string,
  );

  // @ts-ignore EdgeRuntime is provided by the Supabase edge runtime.
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(work);
  } else {
    work.catch((e) => console.error(e));
  }

  return json({ job_id: job.id, location_id: location.id, status: "queued" }, 202);
});
