import { createClient } from "@supabase/supabase-js";

// The publishable/anon key is public by design: it ships in the browser bundle
// and is meaningless without the row-level security policies behind it.
//
// SECURITY: no other key belongs in this file, or anywhere under src/.
// OPENAI_API_KEY, FIRECRAWL_API_KEY and the service role key exist only in
// edge-function secrets and in .env.ingest (which is gitignored and never
// bundled). Nothing in src/ may read them.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && key);

if (!isSupabaseConfigured && import.meta.env.DEV) {
  console.warn(
    "VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are not set. " +
      "Copy them from Lovable Cloud into .env.local.",
  );
}

/**
 * Supabase's newer API keys (`sb_publishable_…` / `sb_secret_…`) are opaque
 * strings, not JWTs. supabase-js still sends them as `Authorization: Bearer …`,
 * which this project's gateway rejects, so the header has to be dropped and the
 * key passed via `apikey` alone. Legacy JWT anon keys are unaffected.
 */
function isOpaqueApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function supabaseFetch(apiKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    }

    if (isOpaqueApiKey(apiKey) && headers.get("Authorization") === `Bearer ${apiKey}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", apiKey);

    return fetch(input, { ...init, headers });
  };
}

const anonKey = key ?? "anon";

export const supabase = createClient(url ?? "http://localhost", anonKey, {
  auth: { persistSession: false },
  global: { fetch: supabaseFetch(anonKey) },
});
