#!/usr/bin/env node
// Offline harvester for LOOP A.
//
// Runs the same search -> dedupe -> scrape -> validate/enrich steps as the edge
// function, importing them from the shared pipeline module, but writes finished
// stories to a JSON file instead of Postgres. Used when the service role key is
// not available: the rows are loaded into the database separately.
//
//   node scripts/harvest.mjs --preset cayenne --out harvest/cayenne.json
//   node scripts/harvest.mjs --preset cayenne --known harvest/known-urls.json
//
// Reads .env.ingest. Never import anything from here into src/.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  buildStoryRow,
  enrichArticle,
  scrapeArticle,
  searchCandidates,
  verdictFor,
  MAX_CANDIDATES,
} from "../supabase/functions/ingest-location/pipeline.js";
import { PRESETS, die, loadIngestConfig, parseArgs, printHelp, wantsHelp } from "./shared.mjs";

const argv = process.argv.slice(2);
if (wantsHelp(argv)) {
  printHelp(PRESETS);
  console.log("  --out <file>    where to write harvested stories (default harvest/<slug>.json)");
  console.log("  --known <file>  JSON array of source_urls already in the database\n");
  process.exit(0);
}

const cfg = loadIngestConfig({ requireAdminToken: false, requireDatabase: false });
if (!cfg.firecrawlKey || !cfg.openaiKey) {
  die("FIRECRAWL_API_KEY and OPENAI_API_KEY must be set in .env.ingest");
}

const payload = parseArgs(argv, PRESETS);
const flag = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

const slug = payload.location.split(",")[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
const outPath = flag("--out") ?? `harvest/${slug}.json`;
const knownPath = flag("--known");

let known = new Set();
if (knownPath && fs.existsSync(knownPath)) {
  try {
    known = new Set(JSON.parse(fs.readFileSync(knownPath, "utf8")));
    console.log(`  ${known.size} known URLs loaded from ${knownPath}`);
  } catch {
    die(`could not parse ${knownPath}`);
  }
}

const started = Date.now();
const log = (m) =>
  console.log(`  [${String(Math.round((Date.now() - started) / 1000)).padStart(4)}s] ${m}`);

console.log(`\n  Harvesting: ${payload.location} (${payload.latitude}, ${payload.longitude})`);
console.log(`  Firecrawl is rate limited, so this runs serially and takes minutes.\n`);

const { candidates, queriesRun } = await searchCandidates(cfg.firecrawlKey, payload, log);
log(`${candidates.length} unique article-shaped candidates`);

const unseen = candidates.filter((c) => !known.has(c.url));
const cap = Math.min(payload.max_candidates ?? MAX_CANDIDATES, 40);
const fresh = unseen.slice(0, cap);
log(
  `${candidates.length - unseen.length} already known, ` +
    `${unseen.length - fresh.length} over the ${cap} cap, ${fresh.length} to process`,
);

const published = [];
const rejected = [];

for (let i = 0; i < fresh.length; i++) {
  const item = fresh[i];
  try {
    const scraped = await scrapeArticle(cfg.firecrawlKey, item.url, log);
    if (!scraped) {
      rejected.push({ url: item.url, reason: "scrape produced no usable content" });
      log(`rejected (no content): ${item.url.slice(0, 70)}`);
      continue;
    }

    const decision = await enrichArticle(
      cfg.openaiKey,
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
      rejected.push({ url: item.url, reason: verdict.reason });
      log(`rejected: ${String(verdict.reason).slice(0, 88)}`);
      continue;
    }

    const row = await buildStoryRow(decision, scraped, item, payload, i, log);
    if (!row) {
      rejected.push({ url: item.url, reason: "location could not be verified in the target region" });
      log(`rejected (location): ${String(decision.location_hint).slice(0, 60)}`);
      continue;
    }
    // location_hint is kept for debugging only; it is never a database column.
    published.push({ ...row, _location_hint: decision.location_hint ?? null });
    log(`PUBLISHED [${row.category}] ${String(row.title).slice(0, 62)}`);
  } catch (err) {
    rejected.push({ url: item.url, reason: `error: ${String(err).slice(0, 200)}` });
    log(`error on ${item.url.slice(0, 60)}: ${String(err).slice(0, 90)}`);
  }
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(
  outPath,
  JSON.stringify(
    {
      location: {
        name: payload.location,
        latitude: payload.latitude,
        longitude: payload.longitude,
        radius_km: payload.radius_km ?? 50,
        country: payload.country ?? null,
        country_code: payload.country_code ?? null,
      },
      queries: queriesRun,
      candidates_found: candidates.length,
      candidates_processed: fresh.length,
      published,
      rejected,
    },
    null,
    2,
  ),
);

console.log(
  `\n  done in ${Math.round((Date.now() - started) / 1000)}s — ` +
    `found ${candidates.length}, processed ${fresh.length}, ` +
    `published ${published.length}, rejected ${rejected.length}`,
);
console.log(`  written to ${outPath}\n`);

if (rejected.length) {
  console.log("  REJECTION REASONS");
  const byReason = new Map();
  for (const r of rejected) {
    const k = String(r.reason).slice(0, 70);
    byReason.set(k, (byReason.get(k) ?? 0) + 1);
  }
  for (const [reason, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(n).padStart(2)}  ${reason}`);
  }
}
