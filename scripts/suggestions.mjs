#!/usr/bin/env node
// The operator side of the public suggestion queue.
//
// Visitors post to story_suggestions through submit_suggestion(). Nobody can
// read that table with the publishable key — that is the point — so reading it
// needs the service role.
//
//   node scripts/suggestions.mjs                    # everything still 'new'
//   node scripts/suggestions.mjs --status reviewed  # another status
//   node scripts/suggestions.mjs --all
//   node scripts/suggestions.mjs --mark <id> harvested
//
// A suggestion is a lead, not a story. Harvesting it still runs the normal
// pipeline: harvest.mjs, then the same validation everything else goes through.
//
// Reads .env.ingest. Never import anything from here into src/.

import { createClient } from "@supabase/supabase-js";
import { die, loadIngestConfig } from "./shared.mjs";

const STATUSES = ["new", "reviewed", "harvested", "discarded"];

const argv = process.argv.slice(2);

if (argv[0] === "--help" || argv[0] === "-h") {
  console.log(`
  node scripts/suggestions.mjs [--status <${STATUSES.join("|")}>] [--all]
  node scripts/suggestions.mjs --mark <id> <${STATUSES.join("|")}>
`);
  process.exit(0);
}

const cfg = loadIngestConfig({ requireAdminToken: false });
const supabase = createClient(cfg.supabaseUrl, cfg.serviceKey, {
  auth: { persistSession: false },
});

const markAt = argv.indexOf("--mark");
if (markAt !== -1) {
  const id = argv[markAt + 1];
  const status = argv[markAt + 2];
  if (!id || !STATUSES.includes(status)) {
    die(`Usage: --mark <id> <${STATUSES.join("|")}>`);
  }

  const { error } = await supabase
    .from("story_suggestions")
    .update({ status })
    .eq("id", id);
  if (error) die(error.message);

  console.log(`\n  ${id} -> ${status}\n`);
  process.exit(0);
}

const statusAt = argv.indexOf("--status");
const status = statusAt !== -1 ? argv[statusAt + 1] : "new";
const all = argv.includes("--all");

if (!all && !STATUSES.includes(status)) {
  die(`--status must be one of ${STATUSES.join(", ")}`);
}

let query = supabase
  .from("story_suggestions")
  .select("id,source_url,place,submitter,note,status,created_at")
  .order("created_at", { ascending: false })
  .limit(200);

if (!all) query = query.eq("status", status);

const { data, error } = await query;
if (error) die(error.message);

const rows = data ?? [];
console.log(`\n  ${rows.length} suggestion(s)${all ? "" : ` with status '${status}'`}\n`);

for (const r of rows) {
  console.log(`  ${r.id}  ${r.created_at.slice(0, 10)}  [${r.status}]`);
  console.log(`    ${r.source_url}`);
  console.log(`    place: ${r.place}${r.submitter ? `   from: ${r.submitter}` : ""}`);
  if (r.note) console.log(`    note:  ${r.note}`);
  console.log("");
}

if (rows.length === 0) console.log("  Nothing waiting.\n");
