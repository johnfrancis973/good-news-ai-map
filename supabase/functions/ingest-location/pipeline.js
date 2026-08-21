// LOOP A — the ingestion pipeline.
//
// Location -> Firecrawl Search -> candidate URLs -> deduplicate ->
// Firecrawl Scrape -> OpenAI validation/enrichment -> Postgres.
//
// Deliberately plain JavaScript using only `fetch` and a Supabase client passed
// in as an argument, so the same code runs unchanged in the Deno edge function
// (./index.ts), the local Node runner (scripts/ingest-local.mjs) and the offline
// harvester (scripts/harvest.mjs).
//
// This is slow (minutes, not seconds — see RATE LIMITS below) and is NEVER on a
// user's browsing request path.

const FIRECRAWL_BASE = "https://api.firecrawl.dev/v2";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "GoodNewsAIMap/1.0 (hackathon MVP)";

export const MAX_CANDIDATES = 20;
const MAX_MARKDOWN_CHARS = 8000;
const MIN_CONFIDENCE = 0.6;

// RATE LIMITS. Measured against the live account: Firecrawl returns HTTP 429
// at ~10 requests/minute. Exceeding it fails every subsequent call for the rest
// of the window, so requests are serialised through a token bucket rather than
// fired concurrently. A full run is therefore minutes long — which is fine,
// because nothing user-facing waits on it.
const FIRECRAWL_RPM = 8;
const MAX_RETRIES = 4;

export const CATEGORIES = [
  "environment",
  "community",
  "education",
  "health",
  "innovation",
  "other",
];

// Sites that are never a single citable story: social, directories, registries,
// listings, grant portals, yellow pages. Found the hard way by probing Cayenne.
const DOMAIN_BLOCKLIST = [
  "facebook.com", "instagram.com", "x.com", "twitter.com", "tiktok.com",
  "youtube.com", "youtu.be", "pinterest.com", "linkedin.com", "reddit.com",
  "amazon.", "ebay.", "tripadvisor.", "booking.com", "wikipedia.org",
  "google.com", "news.google.com", "bing.com", "yahoo.com",
  "pagesjaunes.fr", "cerfapp.fr", "helloasso.com", "pappers.fr",
  "subventions.fr", "societe.com", "infogreffe.fr", "annuaire",
  "demarche.numerique.gouv.fr", "journal-officiel.gouv.fr", "net-entreprises.fr",
  "linternaute.com", "yelp.", "indeed.", "leboncoin.fr",
];

const TRACKING_PARAMS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "fbclid", "gclid", "mc_cid", "mc_eid", "ref", "source", "amp",
];

// Event-shaped phrasing beats topic-shaped phrasing: searching "environmental
// progress" returns directories and policy pages, searching "inaugurates" and
// "launches" returns reported events.
const THEMES = [
  { en: "opens new community project",     fr: "inaugure nouveau projet local" },
  { en: "launches environmental project",  fr: "lance projet environnemental" },
  { en: "school students win project",     fr: "eleves ecole projet reussite" },
  { en: "new health facility opens",       fr: "nouvelle structure sante ouvre" },
  { en: "local innovation startup wins",   fr: "innovation locale entreprise prix" },
  { en: "conservation species protected",  fr: "protection espece conservation" },
  { en: "association awarded volunteers",  fr: "association recompensee benevoles" },
];

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
- it is a directory, listing, index page, paywall stub, cookie notice or navigation shell
- it is a call for projects, grant announcement or tender rather than a reported outcome
- the content is too thin to summarise confidently
- source credibility or content quality is too weak

GEOGRAPHY IS A HARD FILTER. If the event did not happen in or directly concern
the target geography, reject it, even if the story is excellent. A story about a
different region that merely uses similar words is a rejection.

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
  constructive story from a credible source, in the target geography.

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

// ---------------------------------------------------------------- rate limit

/** Serialising token bucket. Firecrawl 429s hard, so we never burst past it. */
class RateLimiter {
  constructor(perMinute) {
    this.intervalMs = Math.ceil(60000 / perMinute);
    this.next = 0;
  }
  async take() {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + this.intervalMs;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }
}

const firecrawlLimiter = new RateLimiter(FIRECRAWL_RPM);

async function firecrawlFetch(path, body, log) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await firecrawlLimiter.take();

    let res;
    try {
      res = await fetch(`${FIRECRAWL_BASE}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${body.__key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...body, __key: undefined }),
      });
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(60000, 5000 * Math.pow(2, attempt));
      if (attempt === MAX_RETRIES) {
        log(`giving up after ${MAX_RETRIES} retries (HTTP ${res.status}) on ${path}`);
        return null;
      }
      log(`HTTP ${res.status} on ${path}, backing off ${Math.round(waitMs / 1000)}s`);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    if (!res.ok) {
      log(`HTTP ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }

    return res.json();
  }
  return null;
}

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

export function normalizeUrl(raw) {
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

/** Article-shaped URLs have a dated path or a multi-word slug. */
function looksLikeArticle(url) {
  try {
    const p = new URL(url).pathname;
    if (/\.(pdf|jpg|png|zip|doc|docx)$/i.test(p)) return false;
    if (/\/\d{4}\/\d{2}\//.test(p)) return true;
    const slug = p.split("/").filter(Boolean).pop() ?? "";
    return slug.split("-").length >= 4;
  } catch {
    return false;
  }
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

export function toIso(value) {
  const s = firstString(value);
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  if (year < 1990 || year > new Date().getUTCFullYear() + 1) return null;
  return d.toISOString();
}

/** Deterministic offset so stories sharing a fallback centre stay clickable. */
export function jitter(seed, index) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const angle = ((Math.abs(h) % 360) + index * 47) * (Math.PI / 180);
  const radius = 0.012 + ((Math.abs(h >> 8) % 40) / 1000);
  return [Math.sin(angle) * radius, Math.cos(angle) * radius];
}

// ---------------------------------------------------------------- search

/**
 * Two passes, cheapest-signal first:
 *   1. news source restricted to the region's own outlets — highest precision
 *   2. news source across the open web — recall, geography enforced by the model
 * The web source type is only a last resort: probing showed it returns
 * directories and grant portals rather than reported events.
 */
export async function searchCandidates(firecrawlKey, payload, log) {
  const locationName = payload.location;
  const french = usesFrench(locationName);
  const outlets = payload.outlets ?? [];
  const shortName = locationName.split(",")[0].trim();

  const themes = payload.queries?.length
    ? payload.queries.slice(0, 8)
    : THEMES.map((t) => `${shortName} ${french ? t.fr : t.en}`);

  const passes = [];
  if (outlets.length > 0) {
    passes.push({ label: "news+outlets", opts: { sources: [{ type: "news" }], includeDomains: outlets } });
  }
  passes.push({ label: "news", opts: { sources: [{ type: "news" }] } });

  const seen = new Map();
  const queriesRun = [];

  for (const pass of passes) {
    for (const query of themes) {
      queriesRun.push(`[${pass.label}] ${query}`);
      const body = {
        __key: firecrawlKey,
        query,
        limit: 10,
        tbs: "qdr:y",
        ...pass.opts,
      };
      const json = await firecrawlFetch("/search", body, log);
      if (!json) continue;

      const rows = Array.isArray(json?.data)
        ? json.data
        : (json?.data?.news ?? json?.data?.web ?? []);
      if (!Array.isArray(rows)) continue;

      let kept = 0;
      for (const r of rows) {
        const url = normalizeUrl(typeof r?.url === "string" ? r.url : "");
        if (!url || seen.has(url) || isBlocked(url)) continue;
        if (!looksLikeArticle(url)) continue;
        seen.set(url, { url, title: firstString(r?.title), pass: pass.label });
        kept++;
      }
      log(`${pass.label}: ${rows.length} results, ${kept} new  <- ${query}`);
    }

    // Enough precision from the outlet pass alone? Skip the broad pass.
    if (seen.size >= (payload.max_candidates ?? MAX_CANDIDATES)) break;
  }

  return { candidates: [...seen.values()], queriesRun };
}

// ---------------------------------------------------------------- scrape

export async function scrapeArticle(firecrawlKey, url, log) {
  const json = await firecrawlFetch(
    "/scrape",
    {
      __key: firecrawlKey,
      url,
      formats: ["markdown"],
      onlyMainContent: true,
      timeout: 30000,
    },
    log,
  );
  if (!json) return null;

  const data = json?.data ?? {};
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

// ---------------------------------------------------------------- enrich

export async function enrichArticle(openaiKey, args, log) {
  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
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

/** Rejects on the model's verdict, low confidence, or structural incompleteness. */
export function verdictFor(decision) {
  if (!decision) return { ok: false, reason: "enrichment failed" };
  if (!decision.accepted) {
    return { ok: false, reason: decision.rejection_reason ?? "rejected by validator" };
  }
  if (!(decision.confidence >= MIN_CONFIDENCE)) {
    return { ok: false, reason: `confidence ${decision.confidence} below ${MIN_CONFIDENCE}` };
  }
  if (!decision.summary || !decision.why_it_matters || !decision.actions?.length) {
    return { ok: false, reason: "incomplete enrichment output" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------- geocoding

// Nominatim asks for at most 1 request/second.
const nominatimLimiter = new RateLimiter(55);

function haversineKm(aLat, aLng, bLat, bLng) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Resolve a place named in an article to coordinates, constrained to a box
 * around the target region.
 *
 * Do NOT filter by country code here. Nominatim files French Guiana under "fr",
 * not "gf", so countrycodes=gf returned zero rows for Cayenne, Kourou, Macouria
 * and every other town in the territory - which silently pinned every story to
 * a jittered point around the region centre. A bounded viewbox plus a distance
 * check constrains the result without depending on country coding at all.
 */
export async function geocode(place, bounds, log) {
  const { lat, lng, radiusKm } = bounds;
  const boxKm = Math.max(radiusKm ?? 50, 25) * 1.5;
  const dLat = boxKm / 111;
  const dLng = boxKm / (111 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));

  try {
    await nominatimLimiter.take();
    const params = new URLSearchParams({
      q: place,
      format: "json",
      limit: "1",
      bounded: "1",
      viewbox: [lng - dLng, lat + dLat, lng + dLng, lat - dLat].join(","),
    });
    const res = await fetch(`${NOMINATIM}?${params}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const rows = await res.json();
    const hit = Array.isArray(rows) ? rows[0] : null;
    if (!hit) return null;

    const hLat = parseFloat(hit.lat);
    const hLng = parseFloat(hit.lon);
    if (isNaN(hLat) || isNaN(hLng)) return null;

    // Reject a match that landed implausibly far from the target region.
    const away = haversineKm(lat, lng, hLat, hLng);
    if (away > boxKm * 1.5) {
      log?.(`geocode rejected "${place}": ${Math.round(away)}km from centre`);
      return null;
    }
    return { lat: hLat, lng: hLng };
  } catch {
    return null;
  }
}

/** Builds the persisted column set. The scraped markdown is NOT part of it. */
export async function buildStoryRow(decision, scraped, item, payload, index, log) {
  let lat = payload.latitude;
  let lng = payload.longitude;
  let placeName = payload.location;

  let located = false;
  if (decision.location_hint) {
    const hit = await geocode(decision.location_hint, {
      lat: payload.latitude,
      lng: payload.longitude,
      radiusKm: payload.radius_km ?? 50,
    }, log);
    if (hit) {
      lat = hit.lat;
      lng = hit.lng;
      placeName = decision.location_hint;
      located = true;
    }
  }
  if (!located) {
    // Could not resolve the article place. Keep the marker honest: it sits near
    // the region centre and the label stays the region, not a town we guessed.
    const [dLat, dLng] = jitter(item.url, index);
    lat += dLat;
    lng += dLng;
    log?.(`no geocode for "${decision.location_hint ?? "(none)"}" - using region centre`);
  }

  return {
    title: scraped.title ?? item.title ?? item.url,
    source_url: item.url,
    source_name: decision.source_name ?? scraped.sourceName ?? new URL(item.url).hostname,
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
    status: "published",
  };
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

  if (jobError || !job) throw new Error(`could not create job: ${jobError?.message}`);

  return { jobId: job.id, locationId: location.id };
}

async function reject(supabase, storyId, reason) {
  await supabase
    .from("stories")
    .update({ status: "rejected", rejection_reason: String(reason).slice(0, 500) })
    .eq("id", storyId);
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

// ---------------------------------------------------------------- pipeline

export async function runPipeline(supabase, keys, payload, jobId, locationId, logger) {
  const log = logger ?? ((m) => console.log(m));
  const stats = { found: 0, processed: 0, published: 0, rejected: 0 };
  const maxCandidates = Math.min(payload.max_candidates ?? MAX_CANDIDATES, 40);

  try {
    // --- STEP 1+2: search and collect candidates ----------------------
    await supabase
      .from("ingestion_jobs")
      .update({ status: "searching", started_at: new Date().toISOString() })
      .eq("id", jobId);

    const { candidates, queriesRun } = await searchCandidates(keys.firecrawl, payload, log);
    stats.found = candidates.length;
    log(`${stats.found} unique article-shaped candidates`);

    await supabase
      .from("ingestion_jobs")
      .update({
        status: "processing",
        search_query: queriesRun.join(" | ").slice(0, 4000),
        candidates_found: stats.found,
      })
      .eq("id", jobId);

    if (candidates.length === 0) {
      await finish(supabase, jobId, "completed", stats);
      return stats;
    }

    // --- STEP 3: DEDUPLICATE BEFORE SCRAPING --------------------------
    // A URL we already hold must never cost a scrape or a model call.
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
          location_name: payload.location,
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
    // Serial, because Firecrawl rate-limits aggressively.
    for (let index = 0; index < claimed.length; index++) {
      const item = claimed[index];
      try {
        const scraped = await scrapeArticle(keys.firecrawl, item.url, log);
        if (!scraped) {
          await reject(supabase, item.id, "scrape produced no usable content");
          stats.rejected++;
          continue;
        }

        const decision = await enrichArticle(
          keys.openai,
          {
            url: item.url,
            title: scraped.title ?? item.title,
            markdown: scraped.markdown,
            locationName: payload.location,
          },
          log,
        );

        const verdict = verdictFor(decision);
        if (!verdict.ok) {
          await reject(supabase, item.id, verdict.reason);
          stats.rejected++;
          log(`rejected: ${verdict.reason.slice(0, 90)}`);
          continue;
        }

        const row = await buildStoryRow(decision, scraped, item, payload, index, log);
        delete row.source_url; // already set when the row was claimed

        const { error: updateError } = await supabase
          .from("stories")
          .update({ ...row, rejection_reason: null })
          .eq("id", item.id);

        if (updateError) {
          await reject(supabase, item.id, `publish failed: ${updateError.message}`);
          stats.rejected++;
          continue;
        }

        stats.published++;
        log(`published: ${String(row.title).slice(0, 70)}`);
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
    }

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
