#!/usr/bin/env node
// Build for GitHub Pages.
//
//   node scripts/build-pages.mjs [--base /repo-name/]
//
// Two things differ from a normal build:
//
// 1. Asset URLs need the /<repo>/ prefix, passed through VITE_BASE.
// 2. GitHub Pages has no SPA rewrite, so a deep link like /story/<id> would hit
//    a missing file. Copying index.html to 404.html makes Pages serve the app
//    for any unknown path; React Router then reads the real path and renders the
//    right route. The HTTP status is 404, which matters for search engines and
//    not at all for a demo link.

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const argv = process.argv.slice(2);
const baseFlag = argv.indexOf("--base");
const base = baseFlag >= 0 ? argv[baseFlag + 1] : process.env.VITE_BASE || "/";

if (!base.startsWith("/") || !base.endsWith("/")) {
  console.error(`\n  --base must start and end with "/" (got ${JSON.stringify(base)})\n`);
  process.exit(1);
}

console.log(`\n  building with base ${base}`);
execSync("npx vite build", {
  stdio: "inherit",
  env: { ...process.env, VITE_BASE: base },
});

const dist = "dist";
const index = path.join(dist, "index.html");
if (!fs.existsSync(index)) {
  console.error("\n  build produced no dist/index.html\n");
  process.exit(1);
}

fs.copyFileSync(index, path.join(dist, "404.html"));
// Stops Pages running the output through Jekyll, which ignores _-prefixed files.
fs.writeFileSync(path.join(dist, ".nojekyll"), "");

// Guard: the built bundle must never contain a server-side secret.
const leaked = [];
const secretNames = ["OPENAI_API_KEY", "FIRECRAWL_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "INGEST_ADMIN_TOKEN"];
const patterns = [/sk-proj-[A-Za-z0-9_-]{20}/, /\bfc-[a-f0-9]{24}\b/, /sb_secret_[A-Za-z0-9_-]{10}/];

function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { scan(full); continue; }
    if (!/\.(js|css|html|map|json)$/i.test(entry.name)) continue;
    const text = fs.readFileSync(full, "utf8");
    for (const p of patterns) if (p.test(text)) leaked.push(`${full}: ${p}`);
    // Reading a secret NAME from import.meta.env would mean it was inlined.
    for (const n of secretNames) if (text.includes(`${n}`)) leaked.push(`${full}: ${n}`);
  }
}
scan(dist);

if (leaked.length) {
  console.error("\n  REFUSING TO PUBLISH — server-side secrets found in the build:");
  for (const l of leaked) console.error(`   ${l}`);
  console.error("");
  process.exit(1);
}

const files = fs.readdirSync(path.join(dist, "assets")).length;
console.log(`\n  ok — dist/ ready (${files} assets), 404.html written, no secrets in bundle\n`);
