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

// Candidates are now scored by snippet triage before anything is scraped, so a
// smaller budget filled with the best 40 beats a larger one filled by raw
// search rank — and the run finishes sooner under the rate limit below.
export const MAX_CANDIDATES = 40;
const MAX_MARKDOWN_CHARS = 8000;
const MIN_CONFIDENCE = 0.6;

// How far back a story may have been published. Enforced with an `after:`
// operator inside the query string, NOT with `tbs`: tbs only applies to the
// `web` source, so on our news-source passes it was silently doing nothing.
const SEARCH_WINDOW_DAYS = 365;

// Triage batch size. Small enough that one bad batch is cheap to re-run, large
// enough that a full candidate set costs a handful of calls.
const TRIAGE_BATCH = 25;

// Below this many candidates, the themed queries are assumed to have failed to
// describe the place rather than the place to have no news. MAX_CANDIDATES is a
// ceiling on scrapes; this is the floor on recall, and they are not the same
// knob - Munich published nothing out of 18 candidates and never came near the
// cap of 40.
const RECALL_FLOOR = 12;

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
  // Firecrawl returns 403 "we do not support this site" for these, so every
  // candidate from them wastes a rate-limited request and yields nothing.
  "nytimes.com", "wsj.com", "ft.com", "bloomberg.com", "washingtonpost.com",
  "economist.com", "newyorker.com", "reuters.com",
];

// The subset of the blocklist worth spending query characters on as server-side
// `-site:` filters. DOMAIN_BLOCKLIST above still runs on every result — this is
// a slot-saver, not a replacement for it. Without this, a blocked publisher
// still occupies one of the 20 rows the search is allowed to return, so we pay
// for a result we were always going to discard.
//
// NOTE: Firecrawl treats includeDomains and excludeDomains as mutually
// exclusive, so this may only be sent on passes that do NOT restrict to a
// region's own outlets.
const SEARCH_EXCLUDE = [
  // Firecrawl answers 403 "we do not support this site" for these, so every
  // candidate from them is a guaranteed wasted scrape.
  "nytimes.com", "wsj.com", "ft.com", "bloomberg.com", "washingtonpost.com",
  "economist.com", "newyorker.com", "reuters.com",
  // Never a single citable story.
  "facebook.com", "x.com", "reddit.com", "pinterest.com", "youtube.com",
  "linkedin.com", "news.google.com", "wikipedia.org",
];

// URL paths that are never a reported story: CMS standing pages and corporate
// press-release sections. Probing Paris surfaced paris.fr/pages/ aid-scheme
// pages, danone.com/newsroom/communiques-de-presse/ and a ministry /pressrelease/
// all being accepted at confidence 0.9 — the model reads them as news because
// they are written like news. Cheaper and more reliable to drop them by shape.
const NON_ARTICLE_PATHS = [
  "/pages/", "/newsroom/", "/press-release/", "/pressrelease/",
  "/communiques-de-presse/", "/communique-de-presse/", "/a-la-une/",
  "/press-releases/", "/media-centre/", "/media-center/",
];

const TRACKING_PARAMS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "fbclid", "gclid", "mc_cid", "mc_eid", "ref", "source", "amp",
];

// Event-shaped phrasing beats topic-shaped phrasing: searching "environmental
// progress" returns directories and policy pages, searching "inaugurates" and
// "launches" returns reported events.
//
// These were 13 flat keyword strings, one query each. Two problems with that:
// an unquoted place name matches loosely (a Paris run surfaced Vernon and
// California), and 13 queries x 3 passes is 39 rate-limited requests before a
// single article is scraped. Grouped into Boolean queries instead - one per
// category, place name quoted, verbs and subjects as OR-groups - the same
// vocabulary costs 5 requests per pass and pins the geography in the query.
//
// Keep to TWO OR-groups. A third multiplies the match space and Google starts
// returning pages that satisfy the groups in unrelated parts of the document.
const THEME_GROUPS = [
  {
    category: "environment",
    en: {
      verbs: ["opens", "launches", "restored", "protected", "completed"],
      subjects: ["park", '"cycle path"', "conservation", "species", "wetland", '"clean-up"'],
    },
    fr: {
      verbs: ["inaugure", "lance", "restaure", "protege", "acheve"],
      subjects: ["parc", '"piste cyclable"', "conservation", "espece", '"zone humide"', "nettoyage"],
    },
  },
  {
    category: "community",
    en: {
      verbs: ["opens", "reopens", "renovated", "awarded", "restore"],
      subjects: ['"community centre"', "volunteers", "charity", "residents", "neighbourhood", "refurbishment"],
    },
    fr: {
      verbs: ["inaugure", "rouvre", "renove", "recompense", "restaurent"],
      subjects: ['"centre social"', "benevoles", "association", "habitants", "quartier", "travaux"],
    },
  },
  {
    category: "education",
    en: {
      verbs: ["win", "awarded", "opens", "completed"],
      subjects: ["school", "pupils", "students", "college", "library", "apprenticeship"],
    },
    fr: {
      verbs: ["remportent", "recompenses", "inaugure", "acheve"],
      subjects: ["ecole", "eleves", "etudiants", "college", "bibliotheque", "apprentissage"],
    },
  },
  {
    category: "health",
    en: {
      verbs: ["opens", "launches", "completed", "treated"],
      subjects: ["clinic", "hospital", '"health centre"', "patients", "screening", "maternity"],
    },
    fr: {
      verbs: ["ouvre", "lance", "acheve", "soigne"],
      subjects: ["clinique", "hopital", '"centre de sante"', "patients", "depistage", "maternite"],
    },
  },
  {
    category: "innovation",
    en: {
      verbs: ["wins", "launches", "awarded", "developed"],
      subjects: ["startup", "research", "university", "prize", "breakthrough", "laboratory"],
    },
    fr: {
      verbs: ["remporte", "lance", "recompense", "developpe"],
      subjects: ["startup", "recherche", "universite", "prix", "decouverte", "laboratoire"],
    },
  },
];

/**
 * `"Cayenne" (Guyane OR "French Guiana") (inaugure OR lance) (parc OR ...)
 *  after:2025-08-22`
 *
 * The optional region group is a disambiguator, not a third theme axis: a short
 * list of names for the surrounding region, used because `country` does not
 * reliably narrow anything.
 *
 * ONLY FOR THE OPEN PASSES. Measured on Cayenne: applying it everywhere cut
 * candidates from 166 to 56 and cost 20 real stories - a road bridge opening, a
 * health charity expanding territory-wide, a children's centre - 14 of them
 * from the region's OWN outlets, because an article naming the town often does
 * not repeat the region. The homonym problem it solves ("Cayenne" the Porsche,
 * the pepper, a hamlet in Pezenas) only exists where the search is not already
 * restricted to local publishers, so that is the only place it is applied.
 */
function buildQuery(names, group, lang, after, regionTerms) {
  const { verbs, subjects } = group[lang];
  return (
    `${placeGroup(names)}${regionGroup(regionTerms)} ` +
    `(${verbs.join(" OR ")}) (${subjects.join(" OR ")}) after:${after}`
  );
}

/**
 * The place axis. A preset may carry several names for the same place and all
 * of them belong in one OR-group, because a publisher prints one spelling and
 * not the others.
 *
 * Munich is why this exists. Its preset is labelled "München (Munich), Germany"
 * so the operator sees both spellings, and the old code quoted whatever sat
 * before the first comma - producing the literal phrase `"München (Munich)"`,
 * which no German outlet has ever printed. 18 candidates, 0 published.
 */
function placeGroup(names) {
  const quoted = names.map((n) => `"${n}"`);
  return quoted.length === 1 ? quoted[0] : `(${quoted.join(" OR ")})`;
}

function regionGroup(regionTerms) {
  if (!regionTerms?.length) return "";
  return ` (${regionTerms.map((t) => (t.includes(" ") ? `"${t}"` : t)).join(" OR ")})`;
}

/**
 * The place and the window, and nothing else. Only used when the themed passes
 * come back below RECALL_FLOOR - see searchCandidates().
 */
function bareQuery(names, after, regionTerms) {
  return `${placeGroup(names)}${regionGroup(regionTerms)} after:${after}`;
}

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
- it is an organisation's own account of its own activity: a corporate newsroom
  or press release, or a company, ministry or national body describing a
  programme it runs rather than reporting a specific occasion. A local authority
  reporting a specific event that happened in its own area is NOT caught by this
  rule and should be judged on the event itself
- it is opinion or commentary with no underlying reported event: a column
  written about a real, completed local improvement is not a rejection
- it is irrelevant to the target geography given below
- it is a directory, listing, index page, paywall stub, cookie notice or navigation shell
- it is an open call for projects, an invitation to apply, a tender, or a page
  describing an aid, grant or subsidy scheme that is simply available - nothing
  has happened yet, however useful the scheme is. Funding actually AWARDED, on a
  specific occasion, to a NAMED project is a reported event and is not a rejection
- it is a standing service, programme or policy page on an official site rather
  than a report of something that happened on a specific occasion
- it is a consultation, impact assessment, strategy document or plan that has
  not yet produced a result
- it is celebrity, royal, sports-transfer or personality news with no
  constructive outcome for the local community
- it is a memorial, vigil, obituary or tribute following a death, however
  moving the community response was
- it is a protest, rally, petition or campaign opposing something, even when
  the cause is sympathetic: opposition is not yet an improvement
- it is private commercial property news - a development loan secured, a luxury
  building completed, a site acquired - with no clear public benefit
- it is a global ranking, index or listicle that merely mentions the target
  place among many others
- it is primarily promotional coverage of a commercial attraction or product
- the content is too thin to summarise confidently
- source credibility or content quality is too weak

A REPORTED EVENT HAS A WHEN. If you cannot point to something that happened -
an opening, a completion, a result, an award, a launch that already occurred -
then this is not a story for this map, however worthy the underlying programme.
An ongoing programme reporting a milestone ALREADY REACHED - so many homes
insulated, a hundredth patient treated, a target met - counts as an event. Works
that are under way, due, planned or "en cours" have not happened yet: reject them.

BEFORE ANYTHING ELSE, classify the article with event_status. Be strict and
literal. The word "launches" is not evidence that anything finished.

- "completed": something FINISHED and can be pointed at. A building opened, a
  service began operating, a prize was handed over, a team returned with a
  result, a milestone was reached, repairs were done. Someone can go and see it.
- "announced": a decision, commitment, pledge, budget, signature, partnership,
  fundraising campaign or contract award for something that does NOT yet exist.
  "A commitment to build 104 homes" is announced, not completed. Opening a
  crowdfunding or participatory financing round for a facility that is not built
  is announced - the money being raised is not the facility existing.
- "planned": a project, works or scheme described as future, due, upcoming,
  under way or "en cours". Breaking ground, starting a worksite, "premier
  chantier lance" or laying a first stone is the START of works, so it is
  planned - the thing being built still does not exist.
- "consultation": a survey, poll, citizen consultation, call for views, call for
  projects, invitation to apply, tender, or an available grant or aid scheme.
  Asking people what they want is never a result.
- "guide": a listing, what's-on, travel guide, how-to, explainer or preview of a
  recurring event, whether or not the event itself is real.
- "none": no specific event at all.

THE TEST FOR "completed": could an ordinary person go there now and find the
thing, or did it verifiably already occur? If what exists so far is money,
paperwork, a signature, a decision or a building site, it is not completed.

ONLY "completed" belongs on this map. If an article is genuinely both - a
finished thing plus a future promise - classify on the FINISHED part. If you are
torn between "completed" and anything else, it is not "completed".

Set event_summary to the single thing that already happened, in one short clause,
in the article's own terms. If event_status is not "completed", set it to null.

THE TEST IS WHETHER SOMETHING GOT BETTER FOR ORDINARY PEOPLE THERE. Ask who is
better off and how. If the honest answer is "investors", "a developer" or "no
one yet", reject it.

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
    "event_status", "event_summary",
  ],
  properties: {
    accepted: { type: "boolean" },
    event_status: {
      type: "string",
      enum: ["completed", "announced", "planned", "consultation", "guide", "none"],
    },
    event_summary: { type: ["string", "null"] },
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

/**
 * Raised when the ACCOUNT cannot serve requests at all - out of credits, or a
 * bad key. Distinct from a page that simply failed, because the correct
 * response is to stop the run, not to move on to the next candidate.
 */
export class FirecrawlAccountError extends Error {
  constructor(message) {
    super(message);
    this.name = "FirecrawlAccountError";
  }
}

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

    // 402 out of credits, 401 bad key. Every subsequent request will fail the
    // same way, so returning null here would march through the whole candidate
    // list at 8 rpm, reject each one as "scrape produced no usable content",
    // and leave a trail of perfectly good URLs marked as failures. Stop instead.
    if (res.status === 402 || res.status === 401) {
      throw new FirecrawlAccountError(
        `HTTP ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`,
      );
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

export function isBlocked(url) {
  const lower = url.toLowerCase();
  return DOMAIN_BLOCKLIST.some((d) => lower.includes(d));
}

/**
 * Page <title> tags usually carry a publisher suffix - "Headline - silive.com",
 * "Headline | amNewYork". That is boilerplate, not part of the headline, so it
 * is trimmed. Only trailing separators are touched, and only when what follows
 * is short enough to be a site name rather than part of the sentence.
 */
export function cleanTitle(raw, sourceName) {
  const SEP = "[-|–—]";
  const trailing = new RegExp(`^(.{20,})\\s+${SEP}\\s+([^-|–—]{2,40})$`);

  let t = String(raw ?? "").trim().replace(/\s+/g, " ");
  for (let i = 0; i < 2; i++) {
    const m = t.match(trailing);
    if (!m) break;
    const tail = m[2].trim();
    const looksLikeSite =
      /\.(com|org|net|fr|uk|gov|nyc)$/i.test(tail) ||
      (sourceName && tail.toLowerCase() === String(sourceName).toLowerCase()) ||
      /(news|times|post|daily|gazette|herald|magazine|office|city hall)$/i.test(tail);
    if (!looksLikeSite) break;
    t = m[1].trim();
  }
  return t;
}

/** Article-shaped URLs have a dated path or a multi-word slug. */
export function looksLikeArticle(url) {
  try {
    const p = new URL(url).pathname;
    if (/\.(pdf|jpg|png|zip|doc|docx)$/i.test(p)) return false;
    const lower = p.toLowerCase();
    if (NON_ARTICLE_PATHS.some((seg) => lower.includes(seg))) return false;
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

/**
 * The text Firecrawl already hands back with every search result. With
 * `highlights: true` it is a query-relevant excerpt; otherwise it falls back to
 * the page description. Either way it arrives free with the search response,
 * which is what makes triage cheap: judging on this costs no extra request.
 */
function snippetOf(r) {
  const h = r?.highlights;
  const text =
    (Array.isArray(h) ? h.filter((x) => typeof x === "string").join(" ... ") : firstString(h)) ||
    firstString(r?.snippet) ||
    firstString(r?.description) ||
    "";
  return text.replace(/\s+/g, " ").trim().slice(0, 400) || null;
}

export function toIso(value) {
  const s = firstString(value);
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  if (year < 1990) return null;
  // A publication date in the future is always a parse error, never a fact. A
  // Cayenne story headlined "27 avril 2026" came back dated 2026-08-27 because
  // the page carried a later date elsewhere; the old year+1 bound let it
  // through and the map showed a story published five days from now. Two days
  // of slack covers timezone skew on a genuinely fresh article.
  if (d.getTime() > Date.now() + 2 * 864e5) return null;
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
  // A preset may name the place several ways (`search_names`); the label before
  // the first comma is only the fallback.
  const searchNames = payload.search_names?.length
    ? payload.search_names
    : [locationName.split(",")[0].trim()];

  // Freshness lives in the query, not in tbs. tbs is kept because it costs
  // nothing and starts working the day a `web` pass is added.
  const after = new Date(Date.now() - SEARCH_WINDOW_DAYS * 864e5)
    .toISOString()
    .slice(0, 10);

  // Geography, applied at the search engine instead of only in the validator
  // prompt. Every off-region candidate filtered here is a scrape and a model
  // call we never have to spend.
  const geo = {
    location: locationName,
    country: String(payload.country_code ?? "us").toLowerCase(),
  };

  const regionTerms = payload.region_terms ?? [];
  const override = payload.queries?.length ? payload.queries.slice(0, 16) : null;

  // THEME_GROUPS carries an English and a French vocabulary and nothing else.
  // A preset may still declare its own language (`lang: "de"`), and when it does
  // and we have no words for it, the themed queries fall back to English - which
  // German, Dutch and Icelandic outlets do not print. Munich is the worked
  // example: 18 candidates, every one of them found by an English query, none
  // of them publishable. So record that the vocabulary missed and force the bare
  // pass below, where the place name is the whole query and language does not
  // enter into it. Triage and the validator both read the article in whatever
  // language it was written.
  const wanted = payload.lang ?? (french ? "fr" : "en");
  const lang = THEME_GROUPS[0][wanted] ? wanted : "en";
  const noVocabulary = lang !== wanted;
  if (noVocabulary) {
    log(`no ${wanted} theme vocabulary - themed passes run in English, bare pass forced`);
  }
  // Outlet pass: no disambiguator. The allowlist already guarantees geography,
  // so every region term here only costs recall.
  const themes = override ?? THEME_GROUPS.map((g) => buildQuery(searchNames, g, lang, after, []));
  // Open passes: disambiguated, because nothing else constrains them.
  const openThemes =
    override ?? THEME_GROUPS.map((g) => buildQuery(searchNames, g, lang, after, regionTerms));

  const news = { sources: [{ type: "news" }] };
  const passes = [];
  if (outlets.length > 0) {
    // includeDomains and excludeDomains are mutually exclusive, so this pass
    // relies on isBlocked() alone - which is fine, the outlet list is already
    // an allowlist of exactly the publishers we want.
    passes.push({ label: "news+outlets", themes, opts: { ...news, includeDomains: outlets } });
  }
  passes.push({
    label: "news",
    themes: openThemes,
    opts: { ...news, excludeDomains: SEARCH_EXCLUDE },
  });

  // A French-speaking place is still covered by English-language outlets, and the
  // French-only query set makes that coverage invisible. Search it too.
  if (french && !override) {
    passes.push({
      label: "news+en",
      themes: THEME_GROUPS.map((g) => buildQuery(searchNames, g, "en", after, regionTerms)),
      // (also an open pass, so also disambiguated)
      opts: { ...news, excludeDomains: SEARCH_EXCLUDE },
    });
  }

  const seen = new Map();
  const queriesRun = [];

  const runPass = async (pass, passIndex) => {
    for (const query of pass.themes) {
      queriesRun.push(`[${pass.label}] ${query}`);
      const body = {
        __key: firecrawlKey,
        query,
        limit: 20,
        tbs: "qdr:y",
        highlights: true,
        ...geo,
        ...pass.opts,
      };
      const json = await firecrawlFetch("/search", body, log);
      if (!json) continue;

      const rows = Array.isArray(json?.data)
        ? json.data
        : (json?.data?.news ?? json?.data?.web ?? []);
      if (!Array.isArray(rows)) continue;

      let kept = 0;
      for (let rank = 0; rank < rows.length; rank++) {
        const r = rows[rank];
        const url = normalizeUrl(typeof r?.url === "string" ? r.url : "");
        if (!url || seen.has(url) || isBlocked(url)) continue;
        if (!looksLikeArticle(url)) continue;
        seen.set(url, {
          url,
          title: firstString(r?.title),
          // Carried so triage can judge this candidate without a scrape.
          snippet: snippetOf(r),
          pass: pass.label,
          rank,
          passIndex,
        });
        kept++;
      }
      log(`${pass.label}: ${rows.length} results, ${kept} new  <- ${query}`);
    }
  };

  for (let passIndex = 0; passIndex < passes.length; passIndex++) {
    await runPass(passes[passIndex], passIndex);
  }

  // RECALL FLOOR. Every themed query demands a verb group AND a subject group in
  // the same headline. A city satisfies that; Minnertsga, 500 people and no
  // newsroom of its own, returned 4 URLs across 10 queries and one of them was a
  // house listing. When the themed passes come back this thin, ask for the place
  // and the window alone and let snippet triage do the filtering - triage is one
  // OpenAI call per 25 candidates, not a rate-limited scrape, so the extra noise
  // is nearly free. Skipped when the caller supplied its own queries.
  if ((seen.size < RECALL_FLOOR || noVocabulary) && !override) {
    log(`${seen.size} candidates from the themed passes - retrying on the place name alone`);
    const fallback = [];
    if (outlets.length > 0) {
      fallback.push({
        label: "bare+outlets",
        themes: [bareQuery(searchNames, after, [])],
        opts: { ...news, includeDomains: outlets },
      });
    }
    fallback.push({
      label: "bare",
      themes: [bareQuery(searchNames, after, regionTerms)],
      opts: { ...news, excludeDomains: SEARCH_EXCLUDE },
    });
    for (let i = 0; i < fallback.length; i++) {
      // passIndex continues past the themed passes, so a themed hit still wins
      // any rank tie against a bare-query hit in the sort below.
      await runPass(fallback[i], passes.length + i);
    }
  }

  // RANK-MAJOR, NOT PASS-MAJOR. The caller truncates this list to fill its
  // candidate budget, so whatever sits at the front is what actually gets
  // scraped. Insertion order is pass-major: the outlet pass alone can fill the
  // whole budget, which spends it on that pass's rank-20 dregs — general crime
  // and crisis reporting — while every other pass's top hit goes unprocessed.
  // Interleave by rank instead, so the best hit from all queries is processed
  // before any query's second-best.
  const candidates = [...seen.values()].sort(
    (a, b) => a.rank - b.rank || a.passIndex - b.passIndex,
  );

  return { candidates, queriesRun };
}

// ---------------------------------------------------------------- triage

// Deliberately a SHALLOWER filter than SYSTEM_PROMPT. It sees a headline and a
// one-line excerpt, so it can only be trusted to spot what is obvious at that
// range. Everything it keeps still faces the full validator on the real text.
const TRIAGE_PROMPT = `You are pre-screening search results for a constructive ("good news") local news map.

For each numbered result you get only a headline and a short excerpt. That is not enough to judge a story properly, and you are NOT being asked to. You are only removing results that are ALREADY CLEARLY unsuitable at a glance.

DROP a result (keep=false) only when the headline or excerpt makes it obvious that it is one of:
- about a different place than the target geography below
- primarily bad news: a crime, death, disaster, accident, scandal, closure, layoff, strike or dispute
- a memorial, vigil, obituary or tribute
- a protest, rally, petition or campaign against something
- an open call for projects, an invitation to apply, a tender, or an aid/grant/subsidy scheme merely being made available
- a ranking, index, listicle or "best of" roundup
- sports results, transfers, celebrity or royal news
- weather, traffic, market or share-price reporting
- an advertisement, sponsored post or product promotion
- a homepage, section index, tag page or live blog rather than one article

KEEP everything else, including anything you are unsure about. A kept result that turns out to be unusable costs very little. A dropped result that was a real story is lost permanently and cannot be recovered. When the headline is vague, ambiguous, or you simply cannot tell: keep it.

Also give each result a score from 0 to 1: how likely it looks, at this range, to be a specific positive local development that already happened. Reported events that have already occurred - an opening, a completion, an award, a result - score higher than things described as planned, due or under way. Set score even for results you drop.

Answer for every result you are given, using the index numbers supplied.`;

const TRIAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdicts"],
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "keep", "score", "reason"],
        properties: {
          index: { type: "integer" },
          keep: { type: "boolean" },
          score: { type: "number" },
          reason: { type: ["string", "null"] },
        },
      },
    },
  },
};

/** One structured-output call. Returns the parsed object, or null on failure. */
async function openaiJson(openaiKey, { system, user, schemaName, schema, temperature }, log) {
  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: schemaName, strict: true, schema },
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

/**
 * Score candidates on their search snippet BEFORE anything is scraped.
 *
 * Why this exists: Firecrawl is the rate-limited leg at ~8 requests/minute, and
 * every candidate the old code processed cost one scrape from that budget plus
 * a full validation call - only to be rejected for something the headline
 * already gave away ("primarily negative", "not in the target geography",
 * "a call for projects"). Snippets arrive free with the search response and
 * OpenAI is not rate limited here, so a handful of cheap batched calls buys
 * back scrape slots that would otherwise have been thrown away.
 *
 * Fails OPEN. If a batch errors the whole batch is kept at a neutral score:
 * the real validator is downstream, and losing candidates to an API blip is
 * worse than scraping a few extra.
 */
export async function triageCandidates(openaiKey, candidates, payload, log) {
  if (!candidates.length) return { keep: [], dropped: [] };

  const keep = [];
  const dropped = [];

  for (let start = 0; start < candidates.length; start += TRIAGE_BATCH) {
    const batch = candidates.slice(start, start + TRIAGE_BATCH);
    const listing = batch
      .map((c, i) => {
        const parts = [`[${i}] ${c.title ?? "(no title)"}`];
        parts.push(`    source: ${new URL(c.url).hostname}`);
        if (c.snippet) parts.push(`    excerpt: ${c.snippet}`);
        return parts.join("\n");
      })
      .join("\n\n");

    const json = await openaiJson(
      openaiKey,
      {
        system: TRIAGE_PROMPT,
        user: `TARGET GEOGRAPHY: ${payload.location}\n\nRESULTS:\n${listing}`,
        schemaName: "triage_verdicts",
        schema: TRIAGE_SCHEMA,
        temperature: 0,
      },
      log,
    );

    const verdicts = new Map();
    for (const v of json?.verdicts ?? []) {
      if (Number.isInteger(v?.index) && v.index >= 0 && v.index < batch.length) {
        verdicts.set(v.index, v);
      }
    }

    if (!json) log(`triage batch ${start}-${start + batch.length} failed, keeping all`);

    for (let i = 0; i < batch.length; i++) {
      const v = verdicts.get(i);
      // No verdict for this index means the model skipped it. Keep it.
      if (!v || v.keep !== false) {
        keep.push({ ...batch[i], score: typeof v?.score === "number" ? v.score : 0.5 });
      } else {
        dropped.push({
          url: batch[i].url,
          title: batch[i].title,
          score: typeof v.score === "number" ? v.score : 0,
          reason: v.reason ?? "dropped in snippet triage",
        });
      }
    }
  }

  // Best-looking first. Rank interleave stays as the tiebreak so that within an
  // equal score the front of the list is still the best hit from every query
  // rather than one query's dregs.
  keep.sort((a, b) => b.score - a.score || a.rank - b.rank || a.passIndex - b.passIndex);

  log(`triage: ${keep.length} kept, ${dropped.length} dropped before any scrape`);
  return { keep, dropped };
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
  return openaiJson(
    openaiKey,
    {
      system: SYSTEM_PROMPT,
      user:
        `TARGET GEOGRAPHY: ${args.locationName}\n` +
        `SOURCE URL: ${args.url}\n` +
        `SOURCE TITLE: ${args.title ?? "(unknown)"}\n\n` +
        `ARTICLE TEXT:\n"""\n${args.markdown}\n"""`,
      schemaName: "story_decision",
      schema: DECISION_SCHEMA,
      temperature: 0.2,
    },
    log,
  );
}

// Everything that is not a finished, pointable-at event. Kept as a deterministic
// gate rather than prose in the prompt because prose did not hold: a Cayenne
// harvest published a citizen consultation, a hostel's carnival travel guide, a
// crowdfunding launch and a pledge to build housing, all at confidence 0.9. The
// model is reliable at LABELLING these; it was unreliable at deciding they
// disqualify. So it labels, and this function decides.
const NON_EVENT_REASONS = {
  announced: "announced or pledged, but nothing has happened yet",
  planned: "planned or under way, not yet completed",
  consultation: "a consultation, survey, call for projects or available scheme",
  guide: "a guide, listing or preview rather than a reported event",
  none: "no specific event",
};

/** Rejects on the model's verdict, low confidence, or structural incompleteness. */
export function verdictFor(decision) {
  if (!decision) return { ok: false, reason: "enrichment failed" };
  if (!decision.accepted) {
    return { ok: false, reason: decision.rejection_reason ?? "rejected by validator" };
  }
  if (decision.event_status !== "completed") {
    const why = NON_EVENT_REASONS[decision.event_status] ?? "not a completed event";
    return { ok: false, reason: `${why} (event_status=${decision.event_status})` };
  }
  if (!decision.event_summary) {
    return { ok: false, reason: "marked completed but names nothing that happened" };
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

/**
 * Belt and braces on freshness. `after:` in the query is a request, not a
 * guarantee - a Cayenne run published a 2023 article through it - so the date
 * we actually resolved from the page is checked against the same window before
 * anything is persisted.
 *
 * An article with NO date is not stale, just undated, and is left alone:
 * plenty of legitimate local outlets publish without machine-readable dates,
 * and rejecting them would cost far more than the occasional old story.
 */
export function staleReason(row) {
  if (!row?.published_at) return null;
  const ms = Date.parse(row.published_at);
  if (!Number.isFinite(ms)) return null;
  const ageDays = Math.round((Date.now() - ms) / 864e5);
  if (ageDays <= SEARCH_WINDOW_DAYS) return null;
  return `published ${ageDays} days ago, outside the ${SEARCH_WINDOW_DAYS}-day window`;
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
    if (decision.location_hint) {
      // The article names a place, but it could not be resolved inside the
      // target region. That is a geography failure, not a reason to guess:
      // pinning it to the region centre would put a story about somewhere else
      // on this map under a label it does not have. Reject instead.
      log?.(`unresolvable place "${decision.location_hint}" - rejecting`);
      return null;
    }
    // No place named at all: a region-level marker is honest, and the label
    // stays the region rather than a town we invented.
    const [dLat, dLng] = jitter(item.url, index);
    lat += dLat;
    lng += dLng;
    log?.("article names no place - using region centre");
  }

  const rawTitle = scraped.title ?? item.title ?? item.url;
  const sourceName =
    decision.source_name ?? scraped.sourceName ?? new URL(item.url).hostname;

  return {
    title: cleanTitle(rawTitle, sourceName),
    source_url: item.url,
    source_name: sourceName,
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

/**
 * Scrape, validate, geocode and publish ONE already-claimed story row.
 *
 * Split out of runPipeline so a single submitted link can go through exactly
 * the same gates a harvested one does. There is deliberately no second, softer
 * path: if this function is not the only way a row reaches 'published', the
 * suggestion queue becomes a way around verdictFor().
 *
 * `item` is { id, url, title } where id is a row already claimed as
 * 'processing'. Returns { published: true, title } or { published: false,
 * reason }, and leaves the row 'rejected' with that reason in either failure
 * case.
 *
 * FirecrawlAccountError is rethrown untouched: the ACCOUNT failed, not the
 * article, and only the caller knows which other claims it has to release.
 */
export async function processCandidate(supabase, keys, item, payload, index, log) {
  const say = log ?? (() => {});

  const refuse = async (reason) => {
    await reject(supabase, item.id, reason);
    return { published: false, reason };
  };

  try {
    const scraped = await scrapeArticle(keys.firecrawl, item.url, say);
    if (!scraped) return await refuse("scrape produced no usable content");

    const decision = await enrichArticle(
      keys.openai,
      {
        url: item.url,
        title: scraped.title ?? item.title,
        markdown: scraped.markdown,
        locationName: payload.location,
      },
      say,
    );

    const verdict = verdictFor(decision);
    if (!verdict.ok) {
      say(`rejected: ${verdict.reason.slice(0, 90)}`);
      return await refuse(verdict.reason);
    }

    const row = await buildStoryRow(decision, scraped, item, payload, index, say);
    if (!row) {
      return await refuse("location could not be verified in the target region");
    }

    const stale = staleReason(row);
    if (stale) {
      say(`rejected: ${stale}`);
      return await refuse(stale);
    }

    delete row.source_url; // already set when the row was claimed

    const { error: updateError } = await supabase
      .from("stories")
      .update({ ...row, rejection_reason: null })
      .eq("id", item.id);

    if (updateError) {
      return await refuse(`publish failed: ${updateError.message}`);
    }

    say(`published: ${String(row.title).slice(0, 70)}`);
    return { published: true, title: row.title };
  } catch (err) {
    if (err instanceof FirecrawlAccountError) throw err;
    // Any other failure leaves the row non-public.
    return await refuse(`error: ${String(err).slice(0, 300)}`);
  }
}

export async function finish(supabase, jobId, status, stats, errorMessage) {
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
  const maxCandidates = Math.min(payload.max_candidates ?? MAX_CANDIDATES, 100);

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
    // A URL we already hold must never cost a scrape or a model call. This runs
    // before triage, not after: the database query is free and triage is not.
    const { data: existing } = await supabase
      .from("stories")
      .select("source_url")
      .in("source_url", candidates.map((c) => c.url));

    const known = new Set((existing ?? []).map((r) => r.source_url));
    const unseen = candidates.filter((c) => !known.has(c.url));
    log(`${known.size} already known, ${unseen.length} unseen`);

    if (unseen.length === 0) {
      await finish(supabase, jobId, "completed", stats);
      return stats;
    }

    // --- STEP 3b: TRIAGE ON SNIPPETS BEFORE SCRAPING ------------------
    // Scrapes are the scarce resource, so spend them on the candidates that
    // still look plausible from their headline and excerpt.
    const { keep, dropped } = await triageCandidates(keys.openai, unseen, payload, log);
    const fresh = keep.slice(0, maxCandidates);
    log(
      `${dropped.length} dropped in triage, ` +
        `${keep.length - fresh.length} over the ${maxCandidates} cap, ` +
        `${fresh.length} to process`,
    );

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
        const outcome = await processCandidate(supabase, keys, item, payload, index, log);
        if (outcome.published) stats.published++;
        else stats.rejected++;
      } catch (err) {
        if (err instanceof FirecrawlAccountError) {
          // The ACCOUNT failed, not the article. Release every row this run
          // claimed but never finished: a 'rejected' row counts as known to the
          // dedupe query above, so leaving them would blacklist a set of
          // perfectly good URLs from ever being ingested again.
          const unfinished = claimed.slice(index).map((c) => c.id);
          await supabase
            .from("stories")
            .delete()
            .in("id", unfinished)
            .eq("status", "processing");
          log(`aborting: ${err.message}`);
          log(`released ${unfinished.length} unfinished claims for a later run`);
          throw err;
        }
        // Any other failure leaves the row non-public.
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
