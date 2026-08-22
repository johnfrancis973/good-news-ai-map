#!/usr/bin/env node
// Acceptance checks against the live database, run exactly as a browser would:
// the publishable key over HTTPS, nothing else.
//
//   node scripts/verify.mjs
//
// Covers the read path, the security guarantees, and the one write the public
// is allowed. Exits non-zero if anything fails, so it can gate a demo.

import fs from "node:fs";
import process from "node:process";

function readEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = readEnv(".env.local");
const URL_ = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!URL_ || !KEY) {
  console.error("\n  .env.local is missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY\n");
  process.exit(1);
}

// Newer Supabase keys (sb_publishable_...) are opaque strings, not JWTs, and
// must not be sent as a bearer token. Matches src/lib/supabase.ts.
const H = { apikey: KEY, "Content-Type": "application/json" };

let failures = 0;
function check(label, ok, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
}

async function rest(path, init = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { headers: H, ...init });
  let body = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

async function rpc(name, args) {
  const res = await fetch(`${URL_}/rest/v1/rpc/${name}`, {
    method: "POST", headers: H, body: JSON.stringify(args),
  });
  let body = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

console.log("\n  READ PATH");

const stories = await rest("stories?select=id,title,status,category,source_url&limit=200");
check("published stories are readable", stories.status === 200 && Array.isArray(stories.body),
  `${stories.status}, ${Array.isArray(stories.body) ? stories.body.length : "?"} rows`);

// Calling process.exit() here would trip a libuv assertion on Windows while
// undici's sockets are still closing, so set the code and skip the rest instead.
const apiBlocked = stories.status === 404;
if (apiBlocked) {
  console.log("\n  PostgREST cannot see the tables (PGRST205).");
  console.log("  Ask Lovable to refresh the database schema, then re-run. See HANDOVER.md.\n");
  process.exitCode = 1;
}

const rows = apiBlocked || !Array.isArray(stories.body) ? [] : stories.body;

if (!apiBlocked) {
check("only published rows are returned", rows.length > 0 && rows.every((s) => s.status === "published"));
check("every story has a real source URL", rows.every((s) => /^https?:\/\//.test(s.source_url || "")));

const locations = await rest("locations?select=id,name,latitude,longitude,default_radius_km");
check("locations are readable", locations.status === 200 && Array.isArray(locations.body),
  `${Array.isArray(locations.body) ? locations.body.length : "?"} rows`);

const near = await rpc("get_nearby_stories", {
  p_lat: 4.9227, p_lng: -52.3269, p_radius_km: 300, p_category: null, p_limit: 200,
});
check("get_nearby_stories works", near.status === 200 && Array.isArray(near.body),
  `${Array.isArray(near.body) ? near.body.length : "?"} near Cayenne`);
if (Array.isArray(near.body) && near.body[0]) {
  check("RPC returns distance_km", "distance_km" in near.body[0]);
}

const tight = await rpc("get_nearby_stories", {
  p_lat: 4.9227, p_lng: -52.3269, p_radius_km: 25, p_category: null, p_limit: 200,
});
check("radius filter narrows results",
  Array.isArray(tight.body) && Array.isArray(near.body) && tight.body.length <= near.body.length,
  `${tight.body?.length} within 25km vs ${near.body?.length} within 300km`);

const first = rows[0];
if (first) {
  const detail = await rest(`stories?id=eq.${first.id}&select=*`);
  const s = detail.body?.[0];
  check("story detail loads", detail.status === 200 && !!s);
  if (s) {
    check("lessons is an array", Array.isArray(s.lessons), `${s.lessons?.length ?? "?"}`);
    check("actions is an array", Array.isArray(s.actions), `${s.actions?.length ?? "?"}`);
    check("has summary and why_it_matters", !!s.summary && !!s.why_it_matters);
    check("no scraped article text stored",
      !("markdown" in s) && !("content" in s) && !("html" in s) && !("body" in s));
  }
}

console.log("\n  SECURITY (all of these must be refused)");

const ins = await rest("stories", {
  method: "POST",
  body: JSON.stringify({ title: "x", source_url: "https://example.invalid/verify", latitude: 0, longitude: 0 }),
});
check("anon cannot create a story", ins.status >= 400, String(ins.status));

const upd = await rest("stories?status=eq.published", {
  method: "PATCH", body: JSON.stringify({ title: "defaced" }),
});
check("anon cannot edit a story", upd.status >= 400, String(upd.status));

const del = await rest("stories?status=eq.published", { method: "DELETE" });
check("anon cannot delete a story", del.status >= 400, String(del.status));

const jobs = await rest("ingestion_jobs?select=id");
check("anon cannot read ingestion_jobs", jobs.status >= 400, String(jobs.status));

const ratingRows = await rest("ratings?select=id");
check("anon cannot read raw ratings", ratingRows.status >= 400, String(ratingRows.status));

const suggRows = await rest("story_suggestions?select=id");
check("anon cannot read story_suggestions", suggRows.status >= 400, String(suggRows.status));

const suggIns = await rest("story_suggestions", {
  method: "POST",
  body: JSON.stringify({ source_url: "https://example.com/x", place: "Nowhere" }),
});
check("anon cannot insert into story_suggestions directly", suggIns.status >= 400, String(suggIns.status));

console.log("\n  RATING (the one write the public is allowed)");

if (first) {
  const sess = "verify-" + Math.random().toString(36).slice(2, 10);
  const up = await rpc("rate_story", { p_story_id: first.id, p_session_id: sess, p_rating: 1 });
  check("useful vote is accepted", up.status === 200, JSON.stringify(up.body));

  const flip = await rpc("rate_story", { p_story_id: first.id, p_session_id: sess, p_rating: -1 });
  const same = JSON.stringify(up.body) !== JSON.stringify(flip.body) || up.status !== 200;
  check("re-voting replaces rather than adds", flip.status === 200 && same, JSON.stringify(flip.body));

  const bad = await rpc("rate_story", { p_story_id: first.id, p_session_id: sess, p_rating: 7 });
  check("invalid rating is refused", bad.status >= 400, String(bad.status));
}

console.log("\n  SUGGESTIONS (the other write the public is allowed)");

// These leave rows in story_suggestions, exactly as the rating checks leave
// rows in ratings. They are marked with a verify- session id.
const suggSess = "verify-" + Math.random().toString(36).slice(2, 10);
const suggest = (url, place = "Cayenne, French Guiana") =>
  rpc("submit_suggestion", {
    p_url: url,
    p_place: place,
    p_submitter: null,
    p_note: "acceptance check",
    p_session_id: suggSess,
  });

const good = await suggest("https://example.com/a-good-thing-happened");
check("a valid suggestion is accepted", good.status === 200, JSON.stringify(good.body));

// The reply carries an id now, because the edge function needs one to record
// what the automatic check decided. That is the ONLY thing added: the id is a
// random uuid for a row the caller just created, and the table it points at
// still has no read path. What must not appear is any stored content.
const reply = good.body ?? {};
const replyKeys = Object.keys(reply).sort().join(",");
check("a suggestion returns an acknowledgement, not a row",
  replyKeys === "id,ok" && reply.ok === true, JSON.stringify(reply));
check("a suggestion returns nothing readable",
  !JSON.stringify(reply).includes("example.com"), JSON.stringify(reply));

// The queue stays sealed with the publishable key, id in hand or not.
const peek = await rest(`story_suggestions?id=eq.${reply.id}&select=source_url`);
check("a suggestion cannot be read back with its own id",
  peek.status >= 400 || JSON.stringify(peek.body ?? []) === "[]", String(peek.status));

// Deciding to spend money is service-role only. If the publishable key can
// reach this, the daily budget is not a budget.
const slot = await rpc("claim_verification_slot", { p_id: reply.id });
check("the public cannot claim a verification slot", slot.status >= 400, String(slot.status));

const notUrl = await suggest("not a url");
check("a non-URL suggestion is refused", notUrl.status >= 400, String(notUrl.status));

const noPlace = await suggest("https://example.com/b", "");
check("a suggestion without a place is refused", noPlace.status >= 400, String(noPlace.status));

// One accepted above, four more to reach the limit, then the sixth must fail.
for (let i = 0; i < 4; i++) await suggest(`https://example.com/fill-${i}`);
const over = await suggest("https://example.com/over-the-limit");
check("suggestions are rate limited per session", over.status >= 400, String(over.status));

} // end !apiBlocked

if (!apiBlocked) {
  console.log(
    failures === 0
      ? "\n  all checks passed\n"
      : `\n  ${failures} check(s) FAILED\n`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}
