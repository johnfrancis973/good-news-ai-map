// ingest-location — HTTP entry point for LOOP A (the WRITE path).
//
// All the actual work lives in ./pipeline.js, which is shared verbatim with the
// local runner (scripts/ingest-local.mjs) so the two can never drift apart.
//
// Returns 202 + job_id immediately and finishes in the background. It is never
// on a user's browsing request path.
//
// Secrets (OPENAI_API_KEY, FIRECRAWL_API_KEY, SUPABASE_SERVICE_ROLE_KEY) are
// read from the environment here and never leave the backend.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { corsHeaders, json } from "../_shared/cors.ts";
// @ts-ignore plain-JS module shared with the Node runner
import { createJob, runPipeline } from "./pipeline.js";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  // Gate BEFORE touching any paid API. Without this, the public could burn
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

  let payload: any;
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

  let jobId: string;
  let locationId: string;
  try {
    const created = await createJob(supabase, payload);
    jobId = created.jobId;
    locationId = created.locationId;
  } catch (err) {
    return json({ error: String(err) }, 500);
  }

  // Fire and forget. The browsing loop never waits on this.
  const work = runPipeline(
    supabase,
    { firecrawl: firecrawlKey, openai: openaiKey },
    payload,
    jobId,
    locationId,
  );

  // @ts-ignore EdgeRuntime is provided by the Supabase edge runtime.
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(work);
  } else {
    work.catch((e: unknown) => console.error(e));
  }

  return json({ job_id: jobId, location_id: locationId, status: "queued" }, 202);
});
