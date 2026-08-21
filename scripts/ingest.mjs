#!/usr/bin/env node
// Remote trigger for LOOP A (ingestion): calls the deployed ingest-location
// edge function, then polls the job row until it finishes.
//
// If the edge function is not deployed, use scripts/ingest-local.mjs instead —
// it runs the identical pipeline from this machine.
//
//   node scripts/ingest.mjs --preset cayenne
//   node scripts/ingest.mjs "Cayenne" 4.9227 -52.3269 --radius 150 --cc gf
//   node scripts/ingest.mjs --status <job_id>
//
// Reads .env.ingest. Never import anything from here into src/.

import process from "node:process";
import {
  PRESETS,
  die,
  loadIngestConfig,
  parseArgs,
  renderJob,
  showJob,
  summarize,
  wantsHelp,
  printHelp,
} from "./shared.mjs";

const argv = process.argv.slice(2);

if (wantsHelp(argv)) {
  printHelp(PRESETS);
  process.exit(0);
}

const cfg = loadIngestConfig();

if (argv[0] === "--status") {
  const job = await showJob(cfg, argv[1]);
  if (!job) die("job not found");
  console.log(`\n${renderJob(job)}`);
  if (job.location_id) await summarize(cfg, job.location_id);
  process.exit(0);
}

const payload = parseArgs(argv, PRESETS);

console.log(`\n  Ingesting: ${payload.location} (${payload.latitude}, ${payload.longitude})`);
console.log("  This runs in the background. Browsing the site is unaffected.");

const res = await fetch(`${cfg.supabaseUrl}/functions/v1/ingest-location`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.serviceKey}`,
    "x-admin-token": cfg.adminToken,
  },
  body: JSON.stringify(payload),
});

const text = await res.text();
if (!res.ok && res.status !== 202) {
  die(
    `edge function ${res.status}: ${text}\n\n` +
      "  If the function is not deployed, run the pipeline locally instead:\n" +
      "    node scripts/ingest-local.mjs --preset cayenne",
  );
}

let out;
try {
  out = JSON.parse(text);
} catch {
  die(`unexpected response: ${text}`);
}

console.log(`  job_id: ${out.job_id}`);

const startedAt = Date.now();
const TIMEOUT_MS = 6 * 60 * 1000;
let last = "";
let finished = null;

while (Date.now() - startedAt < TIMEOUT_MS) {
  await new Promise((r) => setTimeout(r, 4000));
  const job = await showJob(cfg, out.job_id);
  if (!job) continue;
  const view = renderJob(job);
  if (view !== last) {
    console.log(`\n[${Math.round((Date.now() - startedAt) / 1000)}s]`);
    console.log(view);
    last = view;
  }
  if (job.status === "completed" || job.status === "failed") {
    finished = job;
    break;
  }
}

if (!finished) {
  console.log("\n  Still running after 6 minutes. Check again with --status.");
} else if (finished.location_id) {
  await summarize(cfg, finished.location_id);
}
