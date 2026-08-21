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

export const supabase = createClient(url ?? "http://localhost", key ?? "anon", {
  auth: { persistSession: false },
});
