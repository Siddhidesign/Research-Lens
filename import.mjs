#!/usr/bin/env node
/**
 * Turns a spreadsheet of research quotes into data/sessions.json.
 *
 * You keep your study in a CSV, one row per quote, which is a format any
 * spreadsheet app exports. This converts it into the shape the server reads,
 * and refuses to write a broken file.
 *
 *   npm run import my-study.csv
 *   npm run import my-study.csv "Study name" "IRB-12345"
 *
 * Columns (header row required, order does not matter, case ignored):
 *   participant  P01            who said it
 *   round        1              which research round
 *   segment      new user       which user group they belong to
 *   task         find a refund  what you asked them to do
 *   completed    yes / no       did they finish it
 *   sus          68             their SUS score, blank if you did not run one
 *   timestamp    04:12          where in the recording
 *   theme        trust          what the quote is about
 *   sentiment    negative       positive, negative or mixed
 *   quote        "..."          what they actually said
 *
 * Rows for the same participant are grouped automatically, so repeat the
 * participant, round, segment, task, completed and sus values on every row
 * for that person. The spreadsheet does that for you if you fill down.
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [, , csvArg, studyName, irb] = process.argv;

if (!csvArg) {
  console.error(`
Usage: research-lens-import <file.csv> ["Study name"] ["IRB number"]

No CSV yet? There is a template at template.csv. Open it in Excel or Google
Sheets, fill in your own rows, save as CSV, then run this again.
`);
  process.exit(1);
}

const csvPath = resolve(process.cwd(), csvArg);
if (!existsSync(csvPath)) {
  console.error(`Cannot find ${csvPath}`);
  process.exit(1);
}

/** Minimal CSV parser: handles quoted fields, embedded commas, "" escapes, CRLF. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ""));
}

const rows = parseCsv(readFileSync(csvPath, "utf-8"));
if (rows.length < 2) {
  console.error("That file has a header but no data rows.");
  process.exit(1);
}

const header = rows[0].map(h => h.trim().toLowerCase());
const REQUIRED = ["participant", "round", "segment", "theme", "sentiment", "quote"];
const missing = REQUIRED.filter(c => !header.includes(c));
if (missing.length) {
  console.error(`Your spreadsheet is missing these columns: ${missing.join(", ")}`);
  console.error(`Found: ${header.join(", ")}`);
  process.exit(1);
}
const col = (name) => header.indexOf(name);
const get = (r, name) => { const i = col(name); return i < 0 ? "" : (r[i] ?? "").trim(); };

const VALID_SENTIMENT = new Set(["positive", "negative", "mixed"]);
const problems = [];
const sessions = new Map();

rows.slice(1).forEach((r, n) => {
  const line = n + 2; // 1-indexed, plus header
  const id = get(r, "participant");
  const quote = get(r, "quote");
  const theme = get(r, "theme").toLowerCase();
  let sentiment = get(r, "sentiment").toLowerCase();
  const round = Number(get(r, "round"));

  if (!id) { problems.push(`Row ${line}: no participant`); return; }
  if (!quote) { problems.push(`Row ${line}: no quote`); return; }
  if (!theme) { problems.push(`Row ${line}: no theme`); return; }
  if (!Number.isFinite(round)) { problems.push(`Row ${line}: round "${get(r,"round")}" is not a number`); return; }
  if (!VALID_SENTIMENT.has(sentiment)) {
    problems.push(`Row ${line}: sentiment "${sentiment}" must be positive, negative or mixed`);
    return;
  }

  const key = `${id}|${round}`;
  if (!sessions.has(key)) {
    const susRaw = get(r, "sus");
    const sus = susRaw === "" ? 0 : Number(susRaw);
    if (susRaw !== "" && !Number.isFinite(sus)) problems.push(`Row ${line}: sus "${susRaw}" is not a number`);
    sessions.set(key, {
      id,
      round,
      segment: get(r, "segment") || "unspecified",
      task: get(r, "task") || "unspecified",
      completed: /^(yes|y|true|1|completed)$/i.test(get(r, "completed")),
      sus: Number.isFinite(sus) ? sus : 0,
      excerpts: [],
    });
  }
  sessions.get(key).excerpts.push({
    t: get(r, "timestamp") || "00:00",
    theme,
    sentiment,
    quote,
  });
});

if (problems.length) {
  console.error(`\nFound ${problems.length} problem(s). Nothing was changed.\n`);
  problems.slice(0, 20).forEach(p => console.error("  " + p));
  if (problems.length > 20) console.error(`  ...and ${problems.length - 20} more`);
  console.error("\nFix those rows in the spreadsheet, save as CSV, and run this again.\n");
  process.exit(1);
}

const list = [...sessions.values()].sort((a, b) => a.round - b.round || a.id.localeCompare(b.id));
const participants = new Set(list.map(s => s.id)).size;
const repo = {
  study: {
    name: studyName || "Untitled study",
    irb: irb || "",
    rounds: new Set(list.map(s => s.round)).size,
    participants,
    note: "Imported from " + csvArg,
  },
  sessions: list,
};

// Where to write. RESEARCH_LENS_DATA is the repository the server reads; without
// it, write next to the CSV rather than inside an installed package, which the
// user may not even be able to find.
const dataDir = process.env.RESEARCH_LENS_DATA
  ? resolve(process.env.RESEARCH_LENS_DATA)
  : process.cwd();
if (!existsSync(dataDir)) {
  console.error(`RESEARCH_LENS_DATA points at ${dataDir}, which does not exist. Create it first.`);
  process.exit(1);
}
const slug = (repo.study.name || "study")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "study";
const target = join(dataDir, slug + ".json");
if (existsSync(target)) copyFileSync(target, target + ".backup");
writeFileSync(target, JSON.stringify(repo, null, 2) + "\n");

const themes = {};
list.forEach(s => s.excerpts.forEach(e => (themes[e.theme] ??= new Set()).add(s.id)));

console.log(`
Imported into ${target}

  ${participants} participants
  ${list.length} sessions
  ${list.reduce((a, s) => a + s.excerpts.length, 0)} quotes
  ${repo.study.rounds} round(s)

Themes, by how many participants raised each:
${Object.entries(themes).sort((a,b)=>b[1].size-a[1].size).map(([t,s]) => `  ${t}: ${s.size}`).join("\n")}

Ask Claude Desktop a question now. No restart needed.
${process.env.RESEARCH_LENS_DATA ? "" : "\nNote: RESEARCH_LENS_DATA is not set, so this was written to the current folder.\nPoint that variable at a studies folder and move the file there for the server to see it."}
`);
