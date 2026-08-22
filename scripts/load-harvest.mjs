#!/usr/bin/env node
// Turn a harvest file into ONE idempotent SQL statement that loads it.
//
//   node scripts/load-harvest.mjs harvest/mumbai.json          # print the SQL
//   node scripts/load-harvest.mjs harvest/mumbai.json --stdout # same, no banner
//
// Loading used to be hand-written SQL pasted into Lovable's MCP console, which
// is fine once and error-prone every time after. This emits the statement
// instead: the location is upserted on normalized_name, stories are inserted
// with ON CONFLICT (source_url) DO NOTHING, so re-running it is a no-op rather
// than a duplicate.
//
// Values are passed through a single jsonb literal and jsonb_to_recordset, so
// there is no per-field quoting to get wrong - only the one literal is escaped.

import fs from "node:fs";
import process from "node:process";
import { normalizeName } from "../supabase/functions/ingest-location/pipeline.js";

const [file] = process.argv.slice(2);
if (!file) {
  console.error("\n  usage: node scripts/load-harvest.mjs <harvest/file.json>\n");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(file, "utf8"));
const loc = data.location;
const published = data.published ?? [];

if (!loc?.name) {
  console.error(`\n  ${file} has no location block\n`);
  process.exit(1);
}
if (published.length === 0) {
  console.error(`\n  ${file} has no published stories - nothing to load\n`);
  process.exit(1);
}

// Underscored keys are harvest-only debugging aids (_event_status, _location_hint
// and friends). They are not columns and must not reach the insert.
const COLUMNS = [
  ["title", "text"],
  ["source_url", "text"],
  ["source_name", "text"],
  ["published_at", "timestamptz"],
  ["location_name", "text"],
  ["latitude", "double precision"],
  ["longitude", "double precision"],
  ["category", "text"],
  ["summary", "text"],
  ["why_it_matters", "text"],
  ["lessons", "jsonb"],
  ["actions", "jsonb"],
  ["future_outlook", "text"],
  ["ai_relevance", "boolean"],
  ["ai_outlook", "text"],
  ["image_url", "text"],
  ["confidence_score", "numeric"],
];

const rows = published.map((s) => {
  const out = {};
  for (const [col] of COLUMNS) out[col] = s[col] ?? null;
  return out;
});

/** Postgres string literal: the only escaping this whole file needs. */
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

const recordset = COLUMNS.map(([c, t]) => `${c} ${t}`).join(", ");
const selectList = COLUMNS.map(([c]) => `s.${c}`).join(", ");
const insertList = COLUMNS.map(([c]) => c).join(", ");

const sql = `-- ${file}: ${published.length} stories into ${loc.name}
with loc as (
  insert into locations (
    name, normalized_name, country, country_code,
    latitude, longitude, default_radius_km, last_ingested_at
  )
  values (
    ${lit(loc.name)}, ${lit(normalizeName(loc.name))},
    ${loc.country ? lit(loc.country) : "null"}, ${loc.country_code ? lit(loc.country_code) : "null"},
    ${loc.latitude}, ${loc.longitude}, ${Math.round(loc.radius_km ?? 50)}, now()
  )
  on conflict (normalized_name) do update
    set last_ingested_at = now()
  returning id
),
src as (
  select * from jsonb_to_recordset(${lit(JSON.stringify(rows))}::jsonb)
    as x(${recordset})
)
insert into stories (${insertList}, location_id, status)
select ${selectList}, (select id from loc), 'published'
from src s
on conflict (source_url) do nothing
returning id, title;`;

console.log(sql);
