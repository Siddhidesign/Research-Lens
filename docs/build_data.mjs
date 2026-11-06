/**
 * Regenerates docs/sessions.js from data/sessions.json.
 * The JSON file stays the single source of truth; this just makes it importable
 * by the browser demo without a fetch, so the page works on GitHub Pages and
 * from a local static server alike.
 *
 * Run: node docs/build_data.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const json = readFileSync(join(here, "..", "data", "sessions.json"), "utf-8");
JSON.parse(json); // fail loudly if the source JSON is malformed
writeFileSync(
  join(here, "sessions.js"),
  "// GENERATED from data/sessions.json by docs/build_data.mjs. Do not edit by hand.\n" +
    "export const REPO = " + json.trim() + ";\n"
);
console.log("wrote docs/sessions.js");
