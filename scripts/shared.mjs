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
    // French Guiana is ~300km across and its news is territory-wide, so the
    // browse radius covers the territory rather than just the commune.
    radius_km: 300,
    country: "French Guiana",
    country_code: "gf",
    // "Cayenne" is also a Porsche and a pepper. A quoted place name alone
    // returned car reviews, a restoration shop in Thane and pressure-washer
    // adverts; requiring a regional term alongside it fixes that. Only add
    // this where a homonym is actually observed in a harvest - it costs recall
    // when an article names the town without naming the region.
    region_terms: ["Guyane", "French Guiana"],
    outlets: [
      "la1ere.franceinfo.fr",
      "la1ere.francetvinfo.fr",
      "franceguyane.fr",
      "guyaweb.com",
      "outremers360.com",
      "radiopeyi.com",
      "univ-guyane.fr",
      "ctguyane.fr",
      "guyane.gouv.fr",
    ],
  },
  paris: {
    location: "Paris, France",
    latitude: 48.8566,
    longitude: 2.3522,
    radius_km: 40,
    country: "France",
    country_code: "fr",
    outlets: [
      "leparisien.fr",
      "francebleu.fr",
      "actu.fr",
      "20minutes.fr",
      "lemonde.fr",
      "franceinfo.fr",
      "paris.fr",
    ],
  },
  london: {
    location: "London, United Kingdom",
    latitude: 51.5074,
    longitude: -0.1278,
    radius_km: 40,
    country: "United Kingdom",
    country_code: "gb",
    outlets: [
      "standard.co.uk",
      "bbc.co.uk",
      "mylondon.news",
      "london.gov.uk",
      "theguardian.com",
      "timeout.com",
    ],
  },
  newyork: {
    location: "New York, United States",
    latitude: 40.7128,
    longitude: -74.006,
    radius_km: 40,
    country: "United States",
    country_code: "us",
    outlets: [
      "gothamist.com",
      "amny.com",
      "ny1.com",
      "brooklyneagle.com",
      "nyc.gov",
      "silive.com",
      "qns.com",
      "bkreader.com",
      "thecity.nyc",
    ],
  },
  mumbai: {
    location: "Mumbai, India",
    latitude: 19.076,
    longitude: 72.8777,
    // The city proper is ~60km north to south; 50km reaches Thane and Navi
    // Mumbai, which local outlets cover as the same metropolitan story.
    radius_km: 50,
    country: "India",
    country_code: "in",
    outlets: [
      "mumbailive.com",
      "mid-day.com",
      "freepressjournal.in",
      "hindustantimes.com",
      "indianexpress.com",
      "timesofindia.indiatimes.com",
      "thehindu.com",
      "scroll.in",
      "mcgm.gov.in",
    ],
  },
  dubai: {
    location: "Dubai, United Arab Emirates",
    latitude: 25.2048,
    longitude: 55.2708,
    // 50 km spans the built-up strip from Jebel Ali to Deira and reaches the
    // Sharjah border, which local outlets cover as one place.
    radius_km: 50,
    country: "United Arab Emirates",
    country_code: "ae",
    // Emirati coverage skews hard to launches, records and openings of
    // commercial attractions, which the validator rejects as promotional. The
    // state agency and civic outlets are the ones most likely to carry a
    // reported development rather than an announcement.
    outlets: [
      "khaleejtimes.com",
      "gulfnews.com",
      "thenationalnews.com",
      "gulftoday.ae",
      "arabianbusiness.com",
      "emirates247.com",
      "mediaoffice.ae",
      "dubai.ae",
      "wam.ae",
      "dubaimediaoffice.gov.ae",
    ],
  },
  reykjavik: {
    location: "Reykjavik, Iceland",
    latitude: 64.1466,
    longitude: -21.9426,
    radius_km: 80,
    country: "Iceland",
    country_code: "is",
    search_names: ["Reykjavík", "Reykjavik"],
    lang: "is",
    outlets: [
      "icelandmonitor.mbl.is",
      "ruv.is",
      "icelandreview.com",
      "grapevine.is",
      "visir.is",
    ],
  },
  minnertsga: {
    location: "Minnertsga, Fryslân, Netherlands",
    latitude: 53.2514,
    longitude: 5.595,
    // The village is ~500 people and no newsroom is based there. 40 km is what
    // it takes to reach the towns Frisian regional media actually report from:
    // Franeker 9, Harlingen 14, Leeuwarden 23, Bolsward 28. Expect most pins to
    // say Leeuwarden rather than Minnertsga - that is the region working, not a
    // geocoding fault.
    radius_km: 40,
    country: "Netherlands",
    country_code: "nl",
    // The village itself is almost never in a headline. These are the towns
    // Frisian regional media file from, all within the 40 km radius above:
    // Franeker 9 km, Harlingen 14, Leeuwarden 23. Stories pinning to Leeuwarden
    // is the region working as designed, not a geocoding fault.
    search_names: ["Minnertsga", "Franeker", "Harlingen", "Leeuwarden"],
    lang: "nl",
    region_terms: ["Fryslân", "Friesland", "Waadhoeke"],
    outlets: [
      "lc.nl",
      "omropfryslan.nl",
      "frieschdagblad.nl",
      "waadhoeke.nl",
      "nu.nl",
      "rtvnof.nl",
    ],
  },
  munich: {
    // Both spellings have to reach the search or most German-language hits are
    // lost; the umlaut form is what local outlets actually print.
    location: "München (Munich), Germany",
    latitude: 48.1371,
    longitude: 11.5754,
    // 50 miles. Wide enough to take in Augsburg, Ingolstadt, Rosenheim and
    // Landshut, which is where Bavarian regional newsrooms actually file from -
    // the 40 km version reached almost nothing but the city itself.
    radius_km: 80,
    country: "Germany",
    country_code: "de",
    search_names: ["München", "Munich"],
    lang: "de",
    // Both spellings now live in search_names, so the region group is free to
    // do its actual job: separating Bavaria from everywhere else.
    region_terms: ["Bayern", "Bavaria"],
    // sueddeutsche.de is deliberately absent: hard paywall, and Firecrawl 403s
    // that class of site the same way it does nytimes.com.
    outlets: [
      "merkur.de",
      "abendzeitung-muenchen.de",
      "tz.de",
      "br.de",
      "muenchen.de",
      "muenchner-wochenanzeiger.de",
    ],
  },
  losangeles: {
    location: "Los Angeles, United States",
    latitude: 34.0537,
    longitude: -118.2428,
    // The basin is far wider than the city: 50 km reaches Santa Monica,
    // Pasadena and Long Beach, which local media cover as one place.
    radius_km: 50,
    country: "United States",
    country_code: "us",
    // latimes.com omitted - paywalled, same 403 class as nytimes.com.
    outlets: [
      "laist.com",
      "dailynews.com",
      "abc7.com",
      "spectrumnews1.com",
      "lamayor.org",
      "theeastsiderla.com",
      "lasentinel.net",
    ],
  },
  chicago: {
    location: "Chicago, United States",
    latitude: 41.8756,
    longitude: -87.6244,
    radius_km: 40,
    country: "United States",
    country_code: "us",
    // chicagotribune.com omitted for the same paywall reason.
    outlets: [
      "blockclubchicago.org",
      "chicago.suntimes.com",
      "wbez.org",
      "wgntv.com",
      "abc7chicago.com",
      "chicago.gov",
      "thetriibe.com",
    ],
  },

  amsterdam: {
    location: "Amsterdam, Netherlands",
    latitude: 52.3731,
    longitude: 4.8925,
    // 50 km takes in Haarlem, Zaanstad, Almere, Utrecht and Leiden - the whole
    // Randstad north, which Dutch national outlets cover as one area.
    radius_km: 50,
    country: "Netherlands",
    country_code: "nl",
    search_names: ["Amsterdam"],
    lang: "nl",
    // parool.nl and at5.nl are the city desks; nltimes.nl and dutchnews.nl
    // report the same stories in English, which is what the English theme
    // vocabulary can actually match while there is no Dutch one.
    outlets: [
      "at5.nl",
      "parool.nl",
      "amsterdam.nl",
      "nltimes.nl",
      "dutchnews.nl",
      "nos.nl",
      "nu.nl",
    ],
  },

  // ---------------------------------------------------------------- countries
  // These two are whole countries, not cities. The app's only geography is a
  // radius from a point, so a country is a very large circle around its centre
  // - which unavoidably overlaps its neighbours and the city presets inside it.
  // A Germany search will surface Dutch stories near the border, and both will
  // surface the Munich and Minnertsga rows. That is the radius model working as
  // built, not a bug to chase.
  netherlands: {
    location: "Netherlands",
    // Roughly the geographic centre; 200 km from here reaches Groningen,
    // Maastricht and the Zeeland coast, so the whole country is inside it.
    latitude: 52.1326,
    longitude: 5.2913,
    radius_km: 200,
    country: "Netherlands",
    country_code: "nl",
    search_names: ["Netherlands", "Nederland"],
    lang: "nl",
    // nrc.nl and volkskrant.nl are omitted: hard paywalls, the same 403 class
    // as nytimes.com. nltimes.nl and dutchnews.nl report Dutch news in English,
    // which is what makes this preset workable at all while the theme
    // vocabulary has no Dutch.
    outlets: [
      "nos.nl",
      "nu.nl",
      "ad.nl",
      "rtlnieuws.nl",
      "nltimes.nl",
      "dutchnews.nl",
      "rijksoverheid.nl",
    ],
  },
  germany: {
    location: "Germany",
    // 450 km from the centre reaches Flensburg, Munich and Aachen alike.
    latitude: 51.1657,
    longitude: 10.4515,
    radius_km: 450,
    country: "Germany",
    country_code: "de",
    search_names: ["Germany", "Deutschland"],
    lang: "de",
    // spiegel.de, zeit.de and faz.net omitted for the paywall reason above.
    // dw.com and thelocal.de carry German news in English.
    outlets: [
      "tagesschau.de",
      "zdf.de",
      "ndr.de",
      "wdr.de",
      "br.de",
      "dw.com",
      "thelocal.de",
      "bundesregierung.de",
    ],
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

export function loadIngestConfig({ requireAdminToken = true, requireDatabase = true } = {}) {
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
  if (requireDatabase && !cfg.supabaseUrl) missing.push("SUPABASE_URL (or VITE_SUPABASE_URL in .env.local)");
  if (requireDatabase && !cfg.serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
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
