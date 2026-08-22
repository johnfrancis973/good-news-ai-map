#!/usr/bin/env node
// The operator side of the public suggestion queue.
//
// Visitors post to story_suggestions through submit_suggestion(). Nobody can
// read that table with the publishable key — that is the point — so reading it
// needs the service role.
//
//   node scripts/suggestions.mjs                    # everything still 'new'
//   node scripts/suggestions.mjs --status rejected  # another status
//   node scripts/suggestions.mjs --all
//   node scripts/suggestions.mjs --mark <id> harvested
//
// A suggestion is a lead, not a story. Most are now judged automatically by the
// submit-suggestion edge function, which runs the same pipeline everything else
// goes through — so the statuses split in two:
//
//   machine:  verifying, published, rejected
//   operator: new, reviewed, harvested, discarded
//
// The default view is 'new', and 'new' now means NEEDS A PERSON: a place the
// geocoder could not resolve, a submission that arrived after the day's
// verification budget was spent, or a run that failed on our side rather than
// on the article's merits. 'rejected' rows carry the machine's reason and are
// worth reading — the validator is deliberately strict, and overruling it by
// hand is a legitimate move.
//
// Reads .env.ingest. Never import anything from here into src/.

import { createClient } from "@supabase/supabase-js";
import { die, loadIngestConfig } from "./shared.mjs";

const STATUSES = [
  "new",
  "verifying",
  "published",
  "rejected",
  "reviewed",
  "harvested",
  "discarded",
];

// 'verifying', 'published' and 'rejected' are the machine's to set: each one
// comes with a story_id or a reason that a hand-typed status would not have.
// Overruling a machine rejection means moving the row back into the operator
// statuses, not forging a verdict.
const MARKABLE = ["new", "reviewed", "harvested", "discarded"];

const argv = process.argv.slice(2);

if (argv[0] === "--help" || argv[0] === "-h") {
  console.log(`
  node scripts/suggestions.mjs [--status <${STATUSES.join("|")}>] [--all]
  node scripts/suggestions.mjs --mark <id> <${MARKABLE.join("|")}>
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
  if (!id || !MARKABLE.includes(status)) {
    die(`Usage: --mark <id> <${MARKABLE.join("|")}>`);
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
  .select(
    "id,source_url,place,latitude,longitude,submitter,note,status," +
      "story_id,rejection_reason,created_at,verified_at",
  )
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

  // No coordinates is the single most common reason a row is sitting in 'new',
  // so it is worth saying out loud rather than leaving it to be inferred.
  const located =
    typeof r.latitude === "number" && typeof r.longitude === "number"
      ? `${r.latitude.toFixed(3)},${r.longitude.toFixed(3)}`
      : "unresolved";
  console.log(
    `    place: ${r.place} (${located})${r.submitter ? `   from: ${r.submitter}` : ""}`,
  );

  if (r.note) console.log(`    note:  ${r.note}`);
  if (r.story_id) console.log(`    story: ${r.story_id}`);
  if (r.rejection_reason) console.log(`    why:   ${r.rejection_reason}`);
  console.log("");
}

if (rows.length === 0) console.log("  Nothing waiting.\n");
