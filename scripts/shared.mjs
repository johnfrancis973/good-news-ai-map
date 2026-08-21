// Shared plumbing for the ingestion scripts: env loading, CLI parsing, and the
// post-run summary. Server-side only — nothing here belongs under src/.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");

/** Preferred demo locations. Cayenne must work end to end before the rest. */
export const PRESETS = {
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

export function die(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

function parseEnvFile(file) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) return {};
  const out = {};
  for (const raw of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    out[line.slice(0, eq).trim()] = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return out;
}

export function loadIngestConfig({ requireAdminToken = true } = {}) {
  const env = parseEnvFile(".env.ingest");
  const front = parseEnvFile(".env.local");

  const cfg = {
    supabaseUrl: env.SUPABASE_URL || front.VITE_SUPABASE_URL || "",
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || "",
    adminToken: env.INGEST_ADMIN_TOKEN || "",
    firecrawlKey: env.FIRECRAWL_API_KEY || "",
    openaiKey: env.OPENAI_API_KEY || "",
  };

  const missing = [];
  if (!cfg.supabaseUrl) missing.push("SUPABASE_URL (or VITE_SUPABASE_URL in .env.local)");
  if (!cfg.serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (requireAdminToken && !cfg.adminToken) missing.push("INGEST_ADMIN_TOKEN");
  if (missing.length) {
    die(`Missing in .env.ingest:\n    - ${missing.join("\n    - ")}`);
  }

  return cfg;
}

export function wantsHelp(argv) {
  return argv.length === 0 || argv[0] === "--help" || argv[0] === "-h";
}

export function printHelp(presets) {
  console.log(`
  Good News AI Map - ingestion (LOOP A)

    --preset <${Object.keys(presets).join("|")}>
    "<name>" <lat> <lng> [--radius km] [--country X] [--cc xx]

  Runs Firecrawl + OpenAI in the background and writes finished stories to
  Postgres. The website never waits for it.
`);
}

export function parseArgs(argv, presets) {
  if (wantsHelp(argv)) {
    printHelp(presets);
    process.exit(0);
  }

  if (argv[0] === "--preset") {
    const preset = presets[(argv[1] ?? "").toLowerCase()];
    if (!preset) die(`unknown preset. Known: ${Object.keys(presets).join(", ")}`);
    return { ...preset };
  }

  const [name, lat, lng] = argv;
  if (!name || lat === undefined || lng === undefined) {
    die('usage: "<name>" <lat> <lng> [--radius km] [--country X] [--cc xx]');
  }

  const payload = {
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

  return payload;
}

async function restGet(cfg, pathAndQuery) {
  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/${pathAndQuery}`, {
    headers: {
      apikey: cfg.serviceKey,
      Authorization: `Bearer ${cfg.serviceKey}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) die(`REST ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function showJob(cfg, jobId) {
  const rows = await restGet(cfg, `ingestion_jobs?id=eq.${jobId}&select=*`);
  return rows[0] ?? null;
}

export function renderJob(job) {
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

export async function summarize(cfg, locationId) {
  const published = await restGet(
    cfg,
    `stories?location_id=eq.${locationId}&status=eq.published` +
      `&select=title,category,source_name,location_name&order=created_at.desc`,
  );
  const rejected = await restGet(
    cfg,
    `stories?location_id=eq.${locationId}&status=eq.rejected` +
      `&select=source_url,rejection_reason&order=created_at.desc&limit=10`,
  );

  console.log(`\n  PUBLISHED (${published.length})`);
  for (const s of published) {
    console.log(`   - [${s.category}] ${String(s.title).slice(0, 78)}`);
    console.log(`     ${s.source_name ?? "?"} - ${s.location_name ?? "?"}`);
  }

  if (rejected.length) {
    console.log(`\n  REJECTED (showing ${rejected.length}) - why:`);
    for (const s of rejected) {
      console.log(`   - ${String(s.rejection_reason ?? "?").slice(0, 90)}`);
      console.log(`     ${String(s.source_url).slice(0, 90)}`);
    }
  }
}
