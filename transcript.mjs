#!/usr/bin/env node
/**
 * Turns a Zoom, Teams or Otter transcript into a Research Lens skeleton.
 *
 * Reads .vtt, .srt or .txt and writes a study file with every timestamped line
 * already in place. What it does NOT do is decide which lines matter or what
 * they are about. That is interpretation, and it stays with the researcher.
 *
 *   research-lens-transcript interview.vtt --participant P01 --study "EV charging"
 *   research-lens-transcript *.vtt --study "EV charging" --out ./studies
 *
 * Options
 *   --participant P01     who this transcript is. Defaults to the filename.
 *   --study "Name"        study name. Files sharing a name merge into one study.
 *   --segment "new user"  which group they belong to.
 *   --source file.mp4     the recording to cite. Defaults to the transcript name.
 *   --speaker "Name"      keep only lines from this speaker, e.g. the participant.
 *   --skip-moderator      separate out the first speaker, usually the interviewer. Their
 *                         turns are kept under moderator_turns for check_moderator.
 *   --moderator "Name"    drop this speaker by name, when they are not first.
 *   --split-speakers      focus groups and workshops: one participant per speaker,
 *                         so participant counts reflect real people.
 *   --keep-names          use speaker names as participant IDs instead of P01, P02.
 *   --min-words 6         drop lines shorter than this. Default 5.
 *   --out DIR             where to write. Defaults to RESEARCH_LENS_DATA, else cwd.
 *
 * Every excerpt comes out tagged theme "untagged" and sentiment "mixed". Open the
 * file, delete the lines that carry no evidence, and set a real theme on the rest,
 * or hand it to Claude with INGEST_PROMPT.md and approve its suggestions.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";

const argv = process.argv.slice(2);
if (!argv.length || argv.includes("-h") || argv.includes("--help")) {
  console.log(readFileSync(new URL(import.meta.url)).toString().split("*/")[0].replace(/^#!.*\n/, ""));
  process.exit(argv.length ? 0 : 1);
}

// Options that take a value, so their value is never mistaken for a filename.
const VALUED = new Set(["participant", "study", "segment", "source", "speaker", "min-words", "out", "moderator"]);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] != null && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const consumed = new Set();
argv.forEach((a, i) => {
  if (a.startsWith("--")) {
    consumed.add(i);
    if (VALUED.has(a.slice(2)) && argv[i + 1] && !argv[i + 1].startsWith("--")) consumed.add(i + 1);
  }
});
const files = argv.filter((_, i) => !consumed.has(i));

/** "00:01:23.456" or "01:23" -> seconds */
function toSeconds(stamp) {
  const parts = stamp.trim().replace(",", ".").split(":").map(parseFloat);
  if (parts.some(isNaN)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}
/** seconds -> "MM:SS", or "H:MM:SS" past an hour, matching how people scrub a video */
function toStamp(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
           : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const TIME_LINE = /(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}/;
/** "Jane Doe: I could not tell..." — a speaker label at the start of a cue */
const SPEAKER = /^([A-Z][\w'’.\- ]{1,40}?)\s*:\s+(.*)$/;

/**
 * SubViewer, which is what Google Meet and YouTube hand you.
 *   0:00:03.000,0:00:06.000
 *   Jane: I could not tell where that came from
 */
function parseSbv(text) {
  const out = [];
  const lines = text.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].trim().match(/^((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?),/);
    if (!m) continue;
    const body = [];
    for (let j = i + 1; j < lines.length && lines[j].trim(); j++) body.push(lines[j].trim());
    if (body.length) out.push({ start: toSeconds(m[1]), text: body.join(" ") });
  }
  return out;
}

/** Whisper's .tsv: start<TAB>end<TAB>text, in milliseconds. */
function parseTsv(text) {
  const out = [];
  for (const line of text.replace(/\r/g, "").split("\n")) {
    const cols = line.split("\t");
    if (cols.length < 3) continue;
    const ms = parseFloat(cols[0]);
    if (isNaN(ms)) continue;                       // header row
    const body = cols.slice(2).join(" ").trim();
    if (body) out.push({ start: ms / 1000, text: body });
  }
  return out;
}

/** Whisper and several APIs emit JSON with a segments array. */
function parseJson(text) {
  let d;
  try { d = JSON.parse(text); } catch { return []; }
  const arr = Array.isArray(d) ? d : d.segments || d.results || d.transcript || [];
  if (!Array.isArray(arr)) return [];
  return arr
    .map((s) => {
      const start = s.start ?? s.startTime ?? s.offset ?? s.begin ?? null;
      const body = (s.text ?? s.transcript ?? s.content ?? "").toString().trim();
      const sec = typeof start === "string" ? toSeconds(start) : start;
      return body ? { start: typeof sec === "number" ? sec : 0, text: body } : null;
    })
    .filter(Boolean);
}

/**
 * .docx, which is what Teams and Otter export. A docx is a zip; rather than add
 * a dependency we read the local file headers and inflate word/document.xml.
 */
function docxText(buf) {
  const SIG = 0x04034b50;
  let text = "";
  for (let i = 0; i + 30 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== SIG) continue;
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString("utf8");
    if (name !== "word/document.xml") continue;
    const start = i + 30 + nameLen + extraLen;
    const raw = buf.subarray(start, start + compSize);
    const xml = method === 0 ? raw.toString("utf8") : inflateRawSync(raw).toString("utf8");
    text = xml
      .replace(/<\/w:p>/g, "\n")
      .replace(/<w:tab[^>]*\/>/g, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    break;
  }
  if (!text) throw new Error("no word/document.xml found; is this really a .docx?");
  return text;
}

/** Parse WebVTT and SRT alike: they differ in header and separator, not shape. */
function parseCues(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  const cues = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (TIME_LINE.test(line)) {
      if (cur) cues.push(cur);
      cur = { start: toSeconds(line.split("-->")[0]), text: [] };
      continue;
    }
    if (!cur) continue;
    if (!line) { cues.push(cur); cur = null; continue; }
    if (/^\d+$/.test(line)) continue;              // SRT cue number
    if (/^(WEBVTT|NOTE|STYLE)/.test(line)) continue;
    cur.text.push(line);
  }
  if (cur) cues.push(cur);
  return cues.map((c) => ({ start: c.start, text: c.text.join(" ").trim() })).filter((c) => c.text);
}

/** Plain text fallback: "00:01:23 Speaker: words" or "[00:01] words" per line. */
function parsePlain(text) {
  const out = [];
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^\[?((?:\d{1,2}:)?\d{1,2}:\d{2})\]?\s+(.*)$/);
    if (m) out.push({ start: toSeconds(m[1]), text: m[2].trim() });
    else if (out.length) out[out.length - 1].text += " " + line;   // wrapped line
  }
  return out.filter((c) => c.text);
}

/** Merge consecutive cues from the same speaker so a sentence is not split in three. */
function coalesce(cues) {
  const out = [];
  for (const c of cues) {
    const m = c.text.match(SPEAKER);
    const speaker = m ? m[1] : null;
    const body = m ? m[2] : c.text;
    const prev = out[out.length - 1];
    const sameSpeaker = prev && prev.speaker === speaker && speaker !== null;
    const continues = prev && !speaker && !/[.?!]$/.test(prev.text);
    if (sameSpeaker || continues) {
      prev.text = `${prev.text} ${body}`.replace(/\s+/g, " ").trim();
    } else {
      out.push({ start: c.start, speaker, text: body });
    }
  }
  return out;
}

const STUDY = opt("study", "Untitled study");
const SEGMENT = opt("segment", "unspecified");
const ONLY_SPEAKER = opt("speaker");
const MIN_WORDS = parseInt(opt("min-words", "5"), 10);
const SPLIT_SPEAKERS = flag("split-speakers");
const KEEP_NAMES = flag("keep-names");
const OUT_DIR = resolve(opt("out", process.env.RESEARCH_LENS_DATA || process.cwd()));
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

let written = 0;
for (const file of files) {
  if (!existsSync(file)) { console.error(`skipped, not found: ${file}`); continue; }
  const ext = extname(file).toLowerCase();
  let raw;
  try {
    raw = ext === ".docx" ? docxText(readFileSync(file)) : readFileSync(file, "utf-8");
  } catch (e) {
    console.error(`could not read ${basename(file)}: ${e.message}`);
    continue;
  }

  // Try the parser the extension implies, then fall back by sniffing, because
  // exports are routinely saved under the wrong extension.
  const byExt = { ".vtt": parseCues, ".srt": parseCues, ".sbv": parseSbv,
                  ".tsv": parseTsv, ".json": parseJson };
  const order = [byExt[ext], parseCues, parseSbv, parseTsv, parseJson, parsePlain].filter(Boolean);
  let cues = [];
  for (const fn of order) {
    try { cues = fn(raw); } catch { cues = []; }
    if (cues.length) break;
  }
  if (!cues.length) {
    console.error(
      `no timestamped lines found in ${basename(file)}.\n` +
      `  Supported: .vtt and .srt (Zoom, Teams, YouTube), .sbv (Google Meet),\n` +
      `  .tsv and .json (Whisper), .docx (Teams, Otter), and .txt with timestamps.\n` +
      `  A transcript with no timestamps cannot be used: the citations depend on them.`
    );
    continue;
  }

  let turns = coalesce(cues);
  let moderatorTurns = [];
  const speakers = [...new Set(turns.map((t) => t.speaker).filter(Boolean))];

  if (ONLY_SPEAKER) {
    const q = ONLY_SPEAKER.toLowerCase();
    turns = turns.filter((t) => (t.speaker || "").toLowerCase().includes(q));
  } else if ((flag("skip-moderator") || opt("moderator")) && speakers.length > 1) {
    const named = opt("moderator");
    const moderator = named
      ? speakers.find((sp) => sp.toLowerCase().includes(named.toLowerCase())) ?? named
      : turns.find((t) => t.speaker)?.speaker;
    // Kept, not discarded. How the researcher asked is evidence too, and it is
    // what check_moderator reads to look for priming and leading questions.
    moderatorTurns = turns.filter((t) => t.speaker === moderator);
    turns = turns.filter((t) => t.speaker !== moderator);
    console.log(`  moderator: ${moderator} (${moderatorTurns.length} turns kept for check_moderator)`);
  }

  const kept = turns.filter((t) => t.text.split(/\s+/).length >= MIN_WORDS);
  const stem = basename(file, ext);
  const source = opt("source", stem);
  const excerptOf = (t) => ({
    t: toStamp(t.start || 0),
    theme: "untagged",
    sentiment: "mixed",
    quote: t.text,
  });

  let sessions;
  if (SPLIT_SPEAKERS) {
    // A focus group or workshop is several participants in one transcript.
    // Each speaker becomes their own session, so participant counts stay true.
    const order = [...new Set(kept.map((t) => t.speaker).filter(Boolean))];
    if (!order.length) {
      console.error(
        `  --split-speakers needs speaker labels, and ${basename(file)} has none.\n` +
        `  Most exports write "Name: words". Without them a transcript cannot be split by person.`
      );
      continue;
    }
    sessions = order.map((sp, i) => ({
      id: KEEP_NAMES ? sp : `P${String(i + 1).padStart(2, "0")}`,
      segment: SEGMENT,
      source,
      ...(KEEP_NAMES ? {} : { speaker_note: "anonymised at import" }),
      excerpts: kept.filter((t) => t.speaker === sp).map(excerptOf),
    }));
    console.log(
      `  split into ${sessions.length} participants: ` +
      order.map((sp, i) => (KEEP_NAMES ? sp : `${sp} -> P${String(i + 1).padStart(2, "0")}`)).join(", ")
    );
  } else {
    // One transcript, one participant. --participant names them.
    const participant =
      (files.length === 1 && opt("participant")) || stem.replace(/[^\w-]+/g, "-").slice(0, 20);
    sessions = [{
      id: participant,
      segment: SEGMENT,
      source,
      excerpts: kept.map((t) => ({ ...excerptOf(t), ...(t.speaker ? { speaker: t.speaker } : {}) })),
    }];
  }

  if (moderatorTurns.length) {
    const mt = moderatorTurns.map((t) => ({ t: toStamp(t.start || 0), text: t.text }));
    sessions.forEach((x) => { x.moderator_turns = mt; });
  }

  const study = { study: { name: STUDY }, sessions };

  const target = join(OUT_DIR, `${stem.replace(/[^\w-]+/g, "-").toLowerCase()}.json`);
  writeFileSync(target, JSON.stringify(study, null, 1) + "\n");
  written++;
  console.log(`${basename(file)} -> ${target}`);
  console.log(`  ${cues.length} cues, ${turns.length} turns, ${kept.length} kept (under ${MIN_WORDS} words dropped)`);
  if (speakers.length) console.log(`  speakers found: ${speakers.join(", ")}`);
}

if (written) {
  console.log(`
Next: every excerpt is theme "untagged" and sentiment "mixed", because deciding
what a quote is about is your call, not the parser's.

  1. Delete the lines that carry no evidence, the greetings and the task narration.
  2. Set a real theme and sentiment on what is left.

Or hand the folder and INGEST_PROMPT.md to any AI assistant. It proposes themes
and waits for you to approve them before tagging anything.`);
}
