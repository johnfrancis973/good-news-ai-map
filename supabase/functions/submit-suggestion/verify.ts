// The background half of a public submission.
//
// This runs AFTER the browser has been answered, never on its request path.
// Its job is to put the submitted link through the same gates a harvested link
// goes through — literally the same function, processCandidate() — so the
// suggestion queue can never become a softer route onto the map.
//
// The order of the checks below is the whole design: every free check runs
// before anything billable. A blocked domain, a non-article URL and a story we
// already hold all resolve at zero cost.

// @ts-ignore plain-JS module shared with the Node runner and the harvester
import {
  createJob,
  finish,
  isBlocked,
  looksLikeArticle,
  normalizeUrl,
  processCandidate,
} from "../ingest-location/pipeline.js";

/** Radius used to bound the article's own place lookup, in km. */
const SUBMISSION_RADIUS_KM = 50;

export interface Suggestion {
  id: string;
  source_url: string;
  place: string;
  latitude: number | null;
  longitude: number | null;
}

type Keys = { firecrawl: string; openai: string };

// deno-lint-ignore no-explicit-any
type Supabase = any;

async function settle(
  supabase: Supabase,
  id: string,
  patch: Record<string, unknown>,
) {
  await supabase
    .from("story_suggestions")
    .update({ ...patch, verified_at: new Date().toISOString() })
    .eq("id", id);
}

async function refuse(supabase: Supabase, id: string, reason: string) {
  console.log(`[submit-suggestion] ${id} rejected: ${reason}`);
  await settle(supabase, id, {
    status: "rejected",
    rejection_reason: reason.slice(0, 500),
  });
}

/**
 * Leaves the suggestion in the operator queue untouched. Used when we cannot
 * judge the link rather than when we have judged it badly — an unresolvable
 * place, or a spent budget. The submitter is told the same thing either way.
 */
async function handToHuman(id: string, why: string) {
  console.log(`[submit-suggestion] ${id} left for a human: ${why}`);
}

export async function verifySuggestion(
  supabase: Supabase,
  keys: Keys,
  suggestion: Suggestion,
): Promise<void> {
  const { id } = suggestion;
  const log = (m: string) => console.log(`[submit-suggestion] ${id} ${m}`);

  // ---- free checks, in cost order -----------------------------------

  const url = normalizeUrl(suggestion.source_url);
  if (!url) return await refuse(supabase, id, "not a usable http(s) link");

  if (isBlocked(url)) {
    return await refuse(
      supabase,
      id,
      "this domain is not a source we can verify against",
    );
  }

  if (!looksLikeArticle(url)) {
    return await refuse(
      supabase,
      id,
      "this looks like a section, index or press-release page rather than one article",
    );
  }

  // Do we already hold this URL, in any state? Checked without a status filter
  // on purpose: a row that is 'rejected' or mid-'processing' would fail the
  // unique constraint on the claim below, and finding that out there means
  // having already spent a slot on it. This query is free.
  const { data: already } = await supabase
    .from("stories")
    .select("id,status,rejection_reason")
    .eq("source_url", url)
    .maybeSingle();

  if (already?.status === "published") {
    // Not a rejection — the submitter was right, we just got there first.
    log("already published; linking");
    return await settle(supabase, id, { status: "published", story_id: already.id });
  }

  if (already?.status === "rejected") {
    // Judged before, by these same gates. Repeat the reason rather than paying
    // to reach it again; an operator can still overrule it from the queue.
    return await refuse(
      supabase,
      id,
      already.rejection_reason ?? "this article was checked before and did not pass",
    );
  }

  if (already) {
    return await refuse(supabase, id, "this article is already being processed");
  }

  // Without coordinates there is no viewbox to geocode the article's own place
  // against, and geography is a hard filter in the validator. Judging it would
  // mean guessing, so hand it over instead.
  if (
    typeof suggestion.latitude !== "number" ||
    typeof suggestion.longitude !== "number"
  ) {
    return await handToHuman(id, "no coordinates for the submitted place");
  }

  // ---- the budget gate: everything past here costs money -------------

  const { data: allowed, error: slotError } = await supabase.rpc(
    "claim_verification_slot",
    { p_id: id },
  );

  if (slotError) {
    console.error(`[submit-suggestion] ${id} slot claim failed: ${slotError.message}`);
    return;
  }
  if (allowed !== true) {
    return await handToHuman(id, "daily verification budget spent");
  }

  const payload = {
    location: suggestion.place,
    latitude: suggestion.latitude,
    longitude: suggestion.longitude,
    radius_km: SUBMISSION_RADIUS_KM,
  };

  let jobId: string;
  let locationId: string;
  try {
    const created = await createJob(supabase, payload);
    jobId = created.jobId;
    locationId = created.locationId;
  } catch (err) {
    // The slot is already spent, but nothing was billed. Put the row back so a
    // human sees it rather than leaving it stuck in 'verifying'.
    console.error(`[submit-suggestion] ${id} could not open a job: ${err}`);
    await supabase
      .from("story_suggestions")
      .update({ status: "new", verify_started_at: null })
      .eq("id", id);
    return;
  }

  const stats = { found: 1, processed: 0, published: 0, rejected: 0 };
  let claimedStoryId: string | null = null;

  try {
    // Claim the story row before any paid work, exactly as runPipeline does.
    // The UNIQUE constraint on source_url is what makes this safe against a
    // concurrent harvest of the same article.
    const { data: claim, error: claimError } = await supabase
      .from("stories")
      .insert({
        title: url,
        source_url: url,
        location_id: locationId,
        location_name: suggestion.place,
        latitude: suggestion.latitude,
        longitude: suggestion.longitude,
        status: "processing",
      })
      .select("id")
      .maybeSingle();

    if (claimError || !claim) {
      // Someone else holds this URL. It is either being processed right now or
      // was rejected before; either way it is not ours to judge again.
      log("already claimed elsewhere");
      await settle(supabase, id, {
        status: "rejected",
        rejection_reason: "this article is already being processed",
      });
      await finish(supabase, jobId, "completed", stats);
      return;
    }

    claimedStoryId = claim.id;
    const item = { id: claim.id, url, title: null };
    const outcome = await processCandidate(supabase, keys, item, payload, 0, log);
    stats.processed = 1;

    if (outcome.published) {
      stats.published = 1;
      await settle(supabase, id, {
        status: "published",
        story_id: claim.id,
        rejection_reason: null,
      });
    } else {
      stats.rejected = 1;
      await refuse(supabase, id, outcome.reason);
    }

    await finish(supabase, jobId, "completed", stats);

    await supabase
      .from("locations")
      .update({ last_ingested_at: new Date().toISOString() })
      .eq("id", locationId);
  } catch (err) {
    // A thrown FirecrawlAccountError means the ACCOUNT failed, not the article.
    // Release the claim: a 'processing' or 'rejected' row for this URL would
    // blacklist a perfectly good link from ever being ingested again, by this
    // path or by a later harvest.
    console.error(`[submit-suggestion] ${id} verification failed: ${err}`);
    if (claimedStoryId) {
      await supabase
        .from("stories")
        .delete()
        .eq("id", claimedStoryId)
        .eq("status", "processing");
    }
    await supabase
      .from("story_suggestions")
      .update({ status: "new", verify_started_at: null })
      .eq("id", id);
    await finish(supabase, jobId, "failed", stats, String(err).slice(0, 1000));
  }
}
