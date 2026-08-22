// submit-suggestion — the one write path a browser is allowed to reach.
//
// Shape follows ingest-location/index.ts: answer immediately, do the expensive
// work in the background. The difference is the gate. ingest-location is
// guarded by a shared secret because only an operator should be able to start a
// harvest. This one has to be reachable by anyone with the public key, so the
// guard is different in kind:
//
//   * validation and the 5-per-session-per-day limit live in submit_suggestion(),
//     called here with the ANON key so there is exactly one copy of those rules;
//   * a server-side honeypot, because the client-side one is trivially bypassed;
//   * free checks (blocklist, URL shape, already-published) before anything paid;
//   * claim_verification_slot(), a hard global ceiling on the daily spend.
//
// The browser is answered with 202 before any of the background work starts, so
// the READ FAST half of the project is never waiting on Firecrawl or OpenAI.
// Secrets are read from the environment here and never leave the backend.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { corsHeaders, json } from "../_shared/cors.ts";
import { verifySuggestion } from "./verify.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");

  if (!supabaseUrl || !anonKey) {
    return json({ error: "database not configured" }, 500);
  }

  // deno-lint-ignore no-explicit-any
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  // Server-side honeypot. The one in the form is a hint to bots; this is the
  // one that counts. A filled trap gets the same answer a person gets, so a bot
  // learns nothing from the response.
  if (typeof payload?.trap === "string" && payload.trap.trim() !== "") {
    return json({ ok: true }, 202);
  }

  // Validation, rate limiting and the insert all happen inside the RPC, under
  // the anon key, so this endpoint cannot be a way around any of them.
  const asVisitor = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
  });

  const latitude = typeof payload?.latitude === "number" ? payload.latitude : null;
  const longitude = typeof payload?.longitude === "number" ? payload.longitude : null;

  const { data, error } = await asVisitor.rpc("submit_suggestion", {
    p_url: payload?.url ?? "",
    p_place: payload?.place ?? "",
    p_submitter: payload?.submitter || null,
    p_note: payload?.note || null,
    p_session_id: payload?.session_id ?? null,
    p_latitude: latitude,
    p_longitude: longitude,
  });

  // The message is passed through verbatim: the form reads it to tell a
  // validation refusal ("invalid url", "daily suggestion limit reached") from a
  // network failure, and those two need different advice.
  if (error) {
    return json({ error: error.message }, 400);
  }

  const id = (data as { id?: string } | null)?.id ?? null;

  // The log the operator sees. The row is the durable record; this is what
  // makes a submission visible in the function logs as it happens.
  console.log(
    `[submit-suggestion] logged ${id} url=${String(payload?.url).slice(0, 200)} ` +
      `place=${String(payload?.place).slice(0, 80)} ` +
      `coords=${latitude !== null && longitude !== null} ` +
      `session=${String(payload?.session_id ?? "").slice(0, 12)}`,
  );

  // Everything below is optional extra: if it cannot run, the suggestion is
  // still safely in the queue and a human will see it.
  const canVerify = Boolean(id && serviceKey && firecrawlKey && openaiKey);

  if (canVerify) {
    const asService = createClient(supabaseUrl, serviceKey!, {
      auth: { persistSession: false },
    });

    const work = verifySuggestion(
      asService,
      { firecrawl: firecrawlKey!, openai: openaiKey! },
      {
        id: id!,
        source_url: String(payload.url),
        place: String(payload.place),
        latitude,
        longitude,
      },
    );

    // @ts-ignore EdgeRuntime is provided by the Supabase edge runtime.
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(work);
    } else {
      work.catch((e: unknown) => console.error(e));
    }
  } else if (id) {
    console.log(`[submit-suggestion] ${id} queued without checking: keys not configured`);
  }

  // Deliberately no verdict, and no way to poll for one. The queue is sealed;
  // what comes back is an acknowledgement, not a receipt.
  return json({ ok: true }, 202);
});
