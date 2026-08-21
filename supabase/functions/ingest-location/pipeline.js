// LOOP A — the ingestion pipeline.
//
// Location -> Firecrawl Search -> candidate URLs -> deduplicate ->
// Firecrawl Scrape -> OpenAI validation/enrichment -> Postgres.
//
// Deliberately plain JavaScript using only `fetch` and a Supabase client passed
// in as an argument, so the exact same code runs in two places with no forked
// logic: the Deno edge function (../ingest-location/index.ts) and the local
// Node runner (scripts/ingest-local.mjs).
//
// This is slow (15-40s+) and is NEVER on a user's browsing request path.

const FIRECRAWL_BASE = "https://api.firecrawl.dev/v2";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "GoodNewsAIMap/1.0 (hackathon MVP)";

export const MAX_CANDIDATES = 20;
const SCRAPE_CONCURRENCY = 3;
const MAX_MARKDOWN_CHARS = 8000;
const MIN_CONFIDENCE = 0.6;

export const CATEGORIES = [
  "environment",
  "community",
  "education",
  "health",
  "innovation",
  "other",
];

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

const THEMES = [
  { en: "community initiative",      fr: "initiative associative locale" },
  { en: "environmental progress",    fr: "projet environnemental reussite" },
  { en: "education success",         fr: "reussite educative ecole" },
  { en: "health progress",           fr: "progres sante initiative" },
  { en: "innovation local project",  fr: "innovation projet local" },
  { en: "conservation biodiversity", fr: "conservation biodiversite" },
  { en: "local improvement project", fr: "amelioration cadre de vie projet" },
];

// Regions where French-language sources dominate.
const FRENCH_HINTS = [
  "guyane", "cayenne", "kourou", "france", "paris", "martinique",
  "guadeloupe", "reunion", "mayotte", "lyon", "marseille", "bordeaux",
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

// ---------------------------------------------------------------- helpers

// Combining diacritical marks, built from char codes so this file stays pure
// ASCII and survives any re-encoding.
const COMBINING_MARKS = new RegExp(
  "[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]",
  "g",
);

export function normalizeName(s) {
  return s
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeUrl(raw) {
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

function isBlocked(url) {
  const lower = url.toLowerCase();
  return DOMAIN_BLOCKLIST.some((d) => lower.includes(d));
}

function usesFrench(location) {
  const n = normalizeName(location);
  return FRENCH_HINTS.some((h) => n.includes(h));
}

function firstString(v) {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (Array.isArray(v)) {
    const s = v.find((x) => typeof x === "string" && x.trim());
    return typeof s === "string" ? s.trim() : null;
  }
  return null;
}

function toIso(value) {
  const s = firstString(value);
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  if (year < 1990 || year > new Date().getUTCFullYear() + 1) return null;
  return d.toISOString();
}

// Deterministic small offset so several stories sharing a fallback centre do
// not stack into one unclickable marker.
function jitter(seed, index) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const angle = ((Math.abs(h) % 360) + index * 47) * (Math.PI / 180);
  const radius = 0.012 + ((Math.abs(h >> 8) % 40) / 1000);
  return [Math.sin(angle) * radius, Math.cos(angle) * radius];
}

async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------- Firecrawl

async function firecrawlSearch(apiKey, query, limit, log) {
  const res = await fetch(`${FIRECRAWL_BASE}/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit, sources: [{ type: "web" }], tbs: "qdr:y" }),
  });

  if (!res.ok) {
    log(`search failed (${res.status}) for "${query}": ${(await res.text()).slice(0, 200)}`);
    return [];
  }

  const body = await res.json();
  // v2 returns { data: { web: [...] } }; tolerate a bare array too.
  const rows = Array.isArray(body?.data)
    ? body.data
    : (body?.data?.web ?? body?.data?.news ?? []);
  if (!Array.isArray(rows)) return [];

  return rows
    .map((r) => ({
      url: typeof r?.url === "string" ? r.url : "",
      title: firstString(r?.title),
    }))
    .filter((r) => r.url.length > 0);
}

async function firecrawlScrape(apiKey, url, log) {
  const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
      timeout: 30000,
    }),
  });

  if (!res.ok) {
    log(`scrape failed (${res.status}): ${url}`);
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

async function enrich(apiKey, args, log) {
  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
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
    log(`openai failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    return null;
  }

  const body = await res.json();
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return null;

  try {
    return JSON.parse(content);
  } catch {
    log("openai returned unparseable content");
    return null;
  }
}

// ---------------------------------------------------------------- geocoding

async function geocode(place, countryCode) {
  try {
    const params = new URLSearchParams({ q: place, format: "json", limit: "1" });
    if (countryCode) params.set("countrycodes", String(countryCode).toLowerCase());
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

// ---------------------------------------------------------------- setup

/** Upserts the location and opens an ingestion job. Cheap, no external APIs. */
export async function createJob(supabase, payload) {
  const { data: location, error: locError } = await supabase
    .from("locations")
    .upsert(
      {
        name: payload.location,
        normalized_name: normalizeName(payload.location),
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
    throw new Error(`could not upsert location: ${locError?.message}`);
  }

  const { data: job, error: jobError } = await supabase
    .from("ingestion_jobs")
    .insert({ location_id: location.id, status: "queued" })
    .select("id")
    .single();

  if (jobError || !job) {
    throw new Error(`could not create job: ${jobError?.message}`);
  }

  return { jobId: job.id, locationId: location.id };
}

async function reject(supabase, storyId, reason) {
  await supabase
    .from("stories")
    .update({ status: "rejected", rejection_reason: String(reason).slice(0, 500) })
    .eq("id", storyId);
}

// ---------------------------------------------------------------- pipeline

export async function runPipeline(supabase, keys, payload, jobId, locationId, logger) {
  const log = logger ?? ((m) => console.log(m));
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
    const queries = payload.queries?.length
      ? payload.queries.slice(0, 8)
      : THEMES.map((t) => `${locationName} ${french ? t.fr : t.en}`);

    log(`searching ${queries.length} queries (${french ? "fr" : "en"})`);
    const searchResults = await pool(queries, 3, (q) =>
      firecrawlSearch(keys.firecrawl, q, 8, log),
    );

    // --- STEP 2: candidate URLs ---------------------------------------
    const seen = new Set();
    const candidates = [];
    for (const batch of searchResults) {
      for (const hit of batch ?? []) {
        const url = normalizeUrl(hit.url);
        if (!url || seen.has(url) || isBlocked(url)) continue;
        seen.add(url);
        candidates.push({ url, title: hit.title });
      }
    }

    stats.found = candidates.length;
    log(`${stats.found} unique candidate URLs`);

    await supabase
      .from("ingestion_jobs")
      .update({
        status: "processing",
        search_query: queries.join(" | "),
        candidates_found: stats.found,
      })
      .eq("id", jobId);

    if (candidates.length === 0) {
      await finish(supabase, jobId, "completed", stats);
      return stats;
    }

    // --- STEP 3: DEDUPLICATE BEFORE SCRAPING --------------------------
    // A URL we already hold must never cost a Firecrawl scrape or a model call.
    const { data: existing } = await supabase
      .from("stories")
      .select("source_url")
      .in("source_url", candidates.map((c) => c.url));

    const known = new Set((existing ?? []).map((r) => r.source_url));
    const fresh = candidates.filter((c) => !known.has(c.url)).slice(0, maxCandidates);
    log(`${known.size} already known, ${fresh.length} to process`);

    if (fresh.length === 0) {
      await finish(supabase, jobId, "completed", stats);
      return stats;
    }

    // Claim each URL as 'processing' before any work. The UNIQUE constraint on
    // source_url makes concurrent runs safe, and a claimed row stays invisible
    // to the public until it is explicitly promoted to 'published'.
    const claimed = [];
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

      if (error || !data) continue; // claimed elsewhere, or insert refused
      claimed.push({ id: data.id, url: c.url, title: c.title });
    }

    // --- STEPS 4+5: scrape, then validate/enrich ----------------------
    await pool(claimed, SCRAPE_CONCURRENCY, async (item, index) => {
      try {
        const scraped = await firecrawlScrape(keys.firecrawl, item.url, log);
        if (!scraped) {
          await reject(supabase, item.id, "scrape produced no usable content");
          stats.rejected++;
          return;
        }

        const decision = await enrich(
          keys.openai,
          {
            url: item.url,
            title: scraped.title ?? item.title,
            markdown: scraped.markdown,
            locationName,
          },
          log,
        );

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
        if (!decision.summary || !decision.why_it_matters || !decision.actions?.length) {
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
            source_name:
              decision.source_name ?? scraped.sourceName ?? new URL(item.url).hostname,
            published_at: toIso(decision.published_date) ?? scraped.publishedAt,
            location_name: placeName,
            latitude: lat,
            longitude: lng,
            category: CATEGORIES.includes(decision.category) ? decision.category : "other",
            summary: decision.summary,
            why_it_matters: decision.why_it_matters,
            lessons: (decision.lessons ?? []).slice(0, 3),
            actions: decision.actions.slice(0, 3),
            future_outlook: decision.future_outlook,
            ai_relevance: decision.ai_relevance === true && Boolean(decision.ai_outlook),
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
        log(`published: ${(scraped.title ?? item.url).slice(0, 70)}`);
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

    await finish(supabase, jobId, "completed", stats);
    await supabase
      .from("locations")
      .update({ last_ingested_at: new Date().toISOString() })
      .eq("id", locationId);

    return stats;
  } catch (err) {
    log(`pipeline failed: ${err}`);
    await finish(supabase, jobId, "failed", stats, String(err).slice(0, 1000));
    return stats;
  }
}

async function finish(supabase, jobId, status, stats, errorMessage) {
  await supabase
    .from("ingestion_jobs")
    .update({
      status,
      candidates_found: stats.found,
      candidates_processed: stats.processed,
      stories_published: stats.published,
      stories_rejected: stats.rejected,
      error_message: errorMessage ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}
