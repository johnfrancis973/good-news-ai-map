#!/usr/bin/env node
// Local runner for LOOP A (ingestion).
//
// Runs the EXACT pipeline the edge function runs — it imports the same
// pipeline.js — but from this machine, using the service role key. Useful when
// the edge function is not deployed, and for watching a run live while tuning
// the search queries.
//
//   node scripts/ingest-local.mjs --preset cayenne
//   node scripts/ingest-local.mjs "Cayenne" 4.9227 -52.3269 --radius 150 --cc gf
//
// Reads .env.ingest. Never import anything from here into src/.

import { createClient } from "@supabase/supabase-js";
import { createJob, runPipeline } from "../supabase/functions/ingest-location/pipeline.js";
import {
  PRESETS,
  die,
  loadIngestConfig,
  parseArgs,
  printHelp,
  summarize,
  wantsHelp,
} from "./shared.mjs";

const argv = process.argv.slice(2);

if (wantsHelp(argv)) {
  printHelp(PRESETS);
  process.exit(0);
}

const cfg = loadIngestConfig({ requireAdminToken: false });
const payload = parseArgs(argv, PRESETS);

const supabase = createClient(cfg.supabaseUrl, cfg.serviceKey, {
  auth: { persistSession: false },
});

if (!cfg.firecrawlKey || !cfg.openaiKey) {
  die("FIRECRAWL_API_KEY and OPENAI_API_KEY must be set in .env.ingest");
}

console.log(`\n  Ingesting: ${payload.location} (${payload.latitude}, ${payload.longitude})`);
console.log("  Running the pipeline locally. Browsing the site is unaffected.\n");

const started = Date.now();
const { jobId, locationId } = await createJob(supabase, payload);
console.log(`  job_id: ${jobId}\n`);

const stats = await runPipeline(
  supabase,
  { firecrawl: cfg.firecrawlKey, openai: cfg.openaiKey },
  payload,
  jobId,
  locationId,
  (msg) => console.log(`  [${String(Math.round((Date.now() - started) / 1000)).padStart(3)}s] ${msg}`),
);

console.log(
  `\n  done in ${Math.round((Date.now() - started) / 1000)}s — ` +
    `found ${stats.found}, processed ${stats.processed}, ` +
    `published ${stats.published}, rejected ${stats.rejected}`,
);

await summarize(cfg, locationId);
