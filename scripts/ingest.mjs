#!/usr/bin/env node
// Operator interface for LOOP A (ingestion). This is deliberately a CLI script
// and not an in-app admin dashboard — the spec rules those out.
//
//   node scripts/ingest.mjs "Cayenne" 4.9227 -52.3269 --radius 150 --country "French Guiana" --cc gf
//   node scripts/ingest.mjs --preset cayenne
//   node scripts/ingest.mjs --status <job_id>
//
// Reads .env.ingest. Never import anything from here into src/.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");

function loadEnv(file) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) return {};
  const out = {};
  for (const raw of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = { ...loadEnv(".env.ingest") };
const frontEnv = loadEnv(".env.local");

const SUPABASE_URL = env.SUPABASE_URL || frontEnv.VITE_SUPABASE_URL || "";
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || "";
const ADMIN_TOKEN = env.INGEST_ADMIN_TOKEN || "";

// Preferred demo locations. Cayenne first — it must work end to end before
// anything else is ingested.
const PRESETS = {
  cayenne: {
    location: "Cayenne, French Guiana",
    latitude: 4.9227,
    longitude: -52.3269,
    radius_km: 150,
    country: "French Guiana",
    country_code: "gf",
  },
  paris: {
    location: "Paris, France",
    latitude: 48.8566,
    longitude: 2.3522,
    radius_km: 40,
    country: "France",
    country_code: "fr",
  },
  london: {
    location: "London, United Kingdom",
    latitude: 51.5074,
    longitude: -0.1278,
    radius_km: 40,
    country: "United Kingdom",
    country_code: "gb",
  },
  newyork: {
    location: "New York, United States",
    latitude: 40.7128,
    longitude: -74.006,
    radius_km: 40,
    country: "United States",
    country_code: "us",
  },
  reykjavik: {
    location: "Reykjavik, Iceland",
    latitude: 64.1466,
    longitude: -21.9426,
    radius_km: 80,
    country: "Iceland",
    country_code: "is",
  },
};

function die(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

function checkConfig() {
  const missing = [];
  if (!SUPABASE_URL) missing.push("SUPABASE_URL (or VITE_SUPABASE_URL)");
  if (!SERVICE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!ADMIN_TOKEN) missing.push("INGEST_ADMIN_TOKEN");
  if (missing.length) {
    die(`Missing in .env.ingest:\n    - ${missing.join("\n    - ")}`);
  }
}

async function restGet(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) die(`REST ${res.status}: ${await res.text()}`);
  return res.json();
}

async function showJob(jobId) {
  const rows = await restGet(`ingestion_jobs?id=eq.${jobId}&select=*`);
  return rows[0] ?? null;
}

function renderJob(job) {
  const pad = (n) => String(n ?? 0).padStart(3, " ");
  return (
    `  status     ${job.status}\n` +
    `  found      ${pad(job.candidates_found)}\n` +
    `  processed  ${pad(job.candidates_processed)}\n` +
    `  published  ${pad(job.stories_published)}\n` +
    `  rejected   ${pad(job.stories_rejected)}` +
    (job.error_message ? `\n  error      ${job.error_message}` : "")
  );
}

async function pollJob(jobId) {
  const startedAt = Date.now();
  const TIMEOUT_MS = 6 * 60 * 1000;
  let last = "";

  while (Date.now() - startedAt < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, 4000));
    const job = await showJob(jobId);
    if (!job) continue;
    const view = renderJob(job);
    if (view !== last) {
      console.log(`\n[${Math.round((Date.now() - startedAt) / 1000)}s]`);
      console.log(view);
      last = view;
    }
    if (job.status === "completed" || job.status === "failed") return job;
  }
  console.log("\n  Still running after 6 minutes. Check again with --status.");
  return null;
}

async function summarize(locationId) {
  const published = await restGet(
    `stories?location_id=eq.${locationId}&status=eq.published&select=title,category,source_name,location_name&order=created_at.desc`,
  );
  const rejected = await restGet(
    `stories?location_id=eq.${locationId}&status=eq.rejected&select=source_url,rejection_reason&order=created_at.desc&limit=10`,
  );

  console.log(`\n  PUBLISHED (${published.length})`);
  for (const s of published) {
    console.log(`   - [${s.category}] ${s.title.slice(0, 78)}`);
    console.log(`     ${s.source_name ?? "?"} - ${s.location_name ?? "?"}`);
  }

  if (rejected.length) {
    console.log(`\n  REJECTED (showing ${rejected.length}) - why:`);
    for (const s of rejected) {
      console.log(`   - ${(s.rejection_reason ?? "?").slice(0, 90)}`);
      console.log(`     ${s.source_url.slice(0, 90)}`);
    }
  }
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    console.log(`
  Good News AI Map - ingestion (LOOP A)

    node scripts/ingest.mjs --preset <${Object.keys(PRESETS).join("|")}>
    node scripts/ingest.mjs "<name>" <lat> <lng> [--radius km] [--country X] [--cc xx]
    node scripts/ingest.mjs --status <job_id>

  This calls the ingest-location edge function, which runs Firecrawl + OpenAI
  in the background and writes finished stories to Postgres. The website never
  waits for it.
`);
    return;
  }

  checkConfig();

  if (argv[0] === "--status") {
    const job = await showJob(argv[1]);
    if (!job) die("job not found");
    console.log(`\n${renderJob(job)}`);
    if (job.location_id) await summarize(job.location_id);
    return;
  }

  let payload;
  if (argv[0] === "--preset") {
    payload = PRESETS[(argv[1] ?? "").toLowerCase()];
    if (!payload) die(`unknown preset. Known: ${Object.keys(PRESETS).join(", ")}`);
  } else {
    const [name, lat, lng] = argv;
    if (!name || lat === undefined || lng === undefined) {
      die('usage: node scripts/ingest.mjs "<name>" <lat> <lng>');
    }
    payload = {
      location: name,
      latitude: Number(lat),
      longitude: Number(lng),
      radius_km: 50,
    };
    if (Number.isNaN(payload.latitude) || Number.isNaN(payload.longitude)) {
      die("latitude and longitude must be numbers");
    }
    const flag = (f) => {
      const i = argv.indexOf(f);
      return i >= 0 ? argv[i + 1] : undefined;
    };
    if (flag("--radius")) payload.radius_km = Number(flag("--radius"));
    if (flag("--country")) payload.country = flag("--country");
    if (flag("--cc")) payload.country_code = flag("--cc");
  }

  console.log(`\n  Ingesting: ${payload.location} (${payload.latitude}, ${payload.longitude})`);
  console.log("  This runs in the background. Browsing the site is unaffected.");

  const res = await fetch(`${SUPABASE_URL}/functions/v1/ingest-location`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_KEY}`,
      "x-admin-token": ADMIN_TOKEN,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok && res.status !== 202) {
    die(`edge function ${res.status}: ${text}`);
  }

  let out;
  try {
    out = JSON.parse(text);
  } catch {
    die(`unexpected response: ${text}`);
  }

  console.log(`  job_id: ${out.job_id}`);

  const job = await pollJob(out.job_id);
  if (job?.location_id) await summarize(job.location_id);
}

main().catch((e) => die(String(e)));
