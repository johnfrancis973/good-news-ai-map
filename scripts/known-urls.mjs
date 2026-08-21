#!/usr/bin/env node
// Collect every source_url already processed, so a re-run spends its budget on
// new candidates instead of re-scraping and re-rejecting the same articles.
//
//   node scripts/known-urls.mjs                    # from harvest/*.json
//   node scripts/harvest.mjs --preset paris --known harvest/known-urls.json
//
// Rejected URLs count as known: re-processing them costs a Firecrawl scrape and
// an OpenAI call to reach the same verdict.

import fs from "node:fs";
import path from "node:path";

const dir = "harvest";
const out = path.join(dir, "known-urls.json");

if (!fs.existsSync(dir)) {
  console.error(`\n  no ${dir}/ directory yet\n`);
  process.exit(1);
}

const urls = new Set();
let files = 0;

for (const name of fs.readdirSync(dir)) {
  if (!name.endsWith(".json") || name === "known-urls.json") continue;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
  } catch {
    console.error(`  skipping unparseable ${name}`);
    continue;
  }
  files++;
  for (const r of data.published ?? []) if (r.source_url) urls.add(r.source_url);
  for (const r of data.rejected ?? []) if (r.url) urls.add(r.url);
}

fs.writeFileSync(out, JSON.stringify([...urls], null, 2));
console.log(`\n  ${urls.size} known URLs from ${files} harvest file(s) -> ${out}\n`);
