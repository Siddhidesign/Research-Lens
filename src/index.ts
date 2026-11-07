#!/usr/bin/env node
/**
 * Research Lens
 *
 * An MCP server that gives an AI assistant direct, structured access to a UX
 * research repository, so synthesis happens against the actual evidence instead
 * of pasted snippets.
 *
 * Design intent: every tool returns the participant IDs and timestamps behind an
 * answer, so a claim can always be traced back to who said it. The server
 * deliberately does NOT interpret. It retrieves and counts; the researcher still
 * decides what it means.
 *
 * Studies live as JSON files in one folder, set by RESEARCH_LENS_DATA. With no
 * folder set, a bundled sample study loads so the tools can be tried immediately.
 *
 * Tools
 *   list_studies         what is in the repository, and the shape of each study
 *   search_transcripts   full-text search across session excerpts
 *   quotes_by_theme      every quote on a theme, with participant and timestamp
 *   pattern_frequency    how many participants raised a theme, split by segment
 *   compare_rounds       whether a theme improved between research rounds
 *   draft_findings       an evidence-backed findings skeleton, citations attached
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

type Severity = "blocker" | "major" | "minor";

type Excerpt = {
  t: string;
  theme: string;
  sentiment: "positive" | "negative" | "mixed";
  quote: string;
  /** Optional. How badly this blocks the user, as the researcher tagged it. */
  severity?: Severity;
  /** Optional. Groups quotes from different participants into one named issue. */
  issue?: string;
};

/**
 * What a participant agreed to. Modelled on how a connected-vehicle or banking
 * API gates data on the explicit authorization of the person it describes,
 * and on how IRB consent and GDPR actually work.
 *
 *   full       quotes may be used and shared verbatim. The default.
 *   internal   counted and quoted inside the research team only. Quotes are
 *              withheld from any output that leaves it.
 *   counts     counted, never quoted. They agreed to be studied, not published.
 *   withdrawn  gone. Not counted, not quoted, not in a denominator.
 */
type Consent = "full" | "internal" | "counts" | "withdrawn";

type Session = {
  id: string;
  /** Optional. Generative and discovery research has no rounds; defaults to 1. */
  round?: number;
  segment: string;
  task: string;
  completed: boolean;
  sus: number;
  excerpts: Excerpt[];
  /** Optional. Market, store, dealership, branch. */
  region?: string;
  /** Optional. Defaults to "full" when absent, matching pre-consent studies. */
  consent?: Consent;
  /** Optional. Free text, e.g. "withdrew by email 2026-10-02". Never inferred. */
  consent_note?: string;
  /**
   * Optional. Which recording or transcript this session came from, e.g.
   * "sarah-usability-r2.mp4". Falls back to the filename the session was
   * loaded from, so a citation always names something you can go and open.
   */
  source?: string;
  /** Set at load time. The .json file this session was read from. */
  _file?: string;
  /**
   * Optional. The researcher's own turns, kept rather than discarded, so
   * check_moderator can look at how the questions were asked.
   */
  moderator_turns?: { t: string; text: string }[];
};

type Study = {
  study: Record<string, unknown> & {
    name?: string;
    /** Optional enterprise context. All of this is reported, never inferred. */
    product?: string;
    business_unit?: string;
    release?: string;
    date?: string;
  };
  sessions: Session[];
};

const SEVERITY_ORDER: Severity[] = ["blocker", "major", "minor"];

type LoadedStudy = Study & { key: string; files: string[]; duplicates: string[] };

/** Where studies live. A folder of .json files, or a single .json file. */
const DATA_PATH = process.env.RESEARCH_LENS_DATA?.trim();
const SAMPLE_DIR = join(__dirname, "..", "data");

class DataError extends Error {}

function studyFiles(): string[] {
  const target = DATA_PATH ? resolve(DATA_PATH) : SAMPLE_DIR;
  if (!existsSync(target)) {
    throw new DataError(
      `RESEARCH_LENS_DATA points at "${target}", which does not exist.\n` +
        `Set it to a folder containing one .json file per study, or unset it to use the bundled sample.`
    );
  }
  if (statSync(target).isFile()) return [target];
  const files = readdirSync(target)
    .filter((f) => extname(f).toLowerCase() === ".json" && !f.startsWith("."))
    .map((f) => join(target, f))
    .sort();
  if (!files.length) {
    throw new DataError(
      `No .json studies found in "${target}".\n` +
        `Each study is one JSON file with { "study": {...}, "sessions": [...] }.\n` +
        `See https://github.com/Siddhidesign/research-lens for the format.`
    );
  }
  return files;
}

/**
 * A short handle for a study. The study's own name wins, since "money-anchor"
 * reads better than whatever the file happens to be called; the filename is the
 * fallback. Collisions get a numeric suffix so two studies never share a handle.
 */
function keyFor(parsed: Study, file: string): string {
  const slug = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return slug(String(parsed.study?.name ?? "")) || slug(basename(file, ".json")) || "study";
}

/**
 * Read every study fresh on each call, so edits take effect with no restart.
 *
 * Files that declare the same study name are MERGED into one study. A study
 * split across one file per interview is still one study, and its participants
 * belong in one denominator. Splitting the file should never silently split
 * the evidence.
 */
function loadAll(): LoadedStudy[] {
  const byKey = new Map<string, LoadedStudy>();
  for (const file of studyFiles()) {
    let parsed: Study;
    try {
      parsed = JSON.parse(readFileSync(file, "utf-8")) as Study;
    } catch (e) {
      throw new DataError(`"${basename(file)}" is not valid JSON: ${(e as Error).message}`);
    }
    if (!Array.isArray(parsed?.sessions)) {
      throw new DataError(`"${basename(file)}" has no "sessions" array.`);
    }
    const key = keyFor(parsed, file);
    const existing = byKey.get(key);
    const stamp = (ss: Session[]) =>
      ss.map((x) => ({ ...x, round: x.round ?? 1, _file: basename(file) }));
    if (!existing) {
      byKey.set(key, { ...parsed, sessions: stamp(parsed.sessions), key, files: [basename(file)], duplicates: [] });
      continue;
    }
    // Merge, but never count the same participant-round twice.
    const seen = new Set(existing.sessions.map((s) => `${s.id}|${s.round}`));
    for (const sess of parsed.sessions) {
      const sig = `${sess.id}|${sess.round}`;
      if (seen.has(sig)) {
        existing.duplicates.push(`${sess.id} round ${sess.round} (${basename(file)})`);
        continue;
      }
      seen.add(sig);
      existing.sessions.push({ ...sess, round: sess.round ?? 1, _file: basename(file) });
    }
    existing.files.push(basename(file));
    // Keep whichever study block carries the most context.
    existing.study = { ...parsed.study, ...existing.study };
  }
  return [...byKey.values()];
}

/**
 * Pick the studies a call applies to. With no name given, every study is used,
 * so a single-study repository needs no argument at all.
 */
function pick(all: LoadedStudy[], name?: string): LoadedStudy[] {
  if (!name) return all;
  const q = name.trim().toLowerCase();
  const hits = all.filter(
    (s) => s.key.toLowerCase() === q || String(s.study?.name ?? "").toLowerCase() === q
  );
  if (hits.length) return hits;
  const loose = all.filter(
    (s) =>
      s.key.toLowerCase().includes(q) ||
      String(s.study?.name ?? "").toLowerCase().includes(q)
  );
  if (loose.length) return loose;
  throw new DataError(
    `No study matches "${name}". Available: ${all.map((s) => s.key).join(", ")}.`
  );
}

/** Flatten every excerpt with its session and study context attached. */
function allExcerpts(studies: LoadedStudy[]) {
  return studies.flatMap((st) =>
    active(st.sessions).flatMap((s) =>
      s.excerpts.map((e) => ({
        ...e,
        participant: s.id,
        round: s.round,
        segment: s.segment,
        task: s.task,
        study: st.key,
        consent: consentOf(s),
        // An explicit source always shows. The filename only helps when a study
        // was assembled from several files, so it stays hidden otherwise.
        source: s.source ?? (st.files.length > 1 ? s._file ?? "" : ""),
      }))
    )
  );
}

const sessionsOf = (studies: LoadedStudy[]) => studies.flatMap((s) => active(s.sessions));

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

/**
 * Who is asking. An MCP client is a pipe to wherever the answer ends up, so the
 * operator declares the audience once, the way an API caller declares its scope.
 * Defaults to the research team, the most permissive setting, because an
 * existing study with no consent field should keep working unchanged.
 */
const AUDIENCE: "team" | "external" =
  norm(process.env.RESEARCH_LENS_AUDIENCE) === "external" ? "external" : "team";

const consentOf = (s: { consent?: Consent }): Consent => s.consent ?? "full";

/** Withdrawn participants are removed from everything, including denominators. */
const active = <T extends { consent?: Consent }>(xs: T[]) =>
  xs.filter((x) => consentOf(x) !== "withdrawn");

/** May this participant's words be reproduced, for this audience? */
function mayQuote(consent: Consent): boolean {
  if (consent === "withdrawn" || consent === "counts") return false;
  if (consent === "internal") return AUDIENCE === "team";
  return true;
}

/**
 * Renders a quote, or says plainly that it is being withheld and why. Never
 * silently omits: a reader must be able to tell the difference between
 * "nobody said this" and "someone said this and did not consent to it leaving".
 */
function quoteOrWithheld(h: { quote: string; consent: Consent }): string {
  if (mayQuote(h.consent)) return `"${h.quote}"`;
  return h.consent === "counts"
    ? `[quote withheld: participant consented to be counted, not quoted]`
    : `[quote withheld: consented to research-team use only, and this output is external]`;
}

/**
 * Themes are matched case-insensitively. An assistant will naturally write
 * "Trust" for a theme filed as "trust", and returning "no quotes" for a
 * capital letter would read as an absence of evidence, which is the most
 * dangerous wrong answer this server could give.
 */
const themeMatches = (rowTheme: string, wanted: unknown) => norm(rowTheme) === norm(wanted);

/** When a theme finds nothing, say what does exist rather than just "none". */
function themeSuggestion(rows: { theme: string }[], wanted: unknown): string {
  const all = [...new Set(rows.map((r) => r.theme))];
  if (!all.length) return "";
  const q = norm(wanted);
  const near = all.filter((t) => norm(t).includes(q) || q.includes(norm(t)));
  return near.length
    ? ` Did you mean: ${near.join(", ")}?`
    : ` Themes in scope: ${all.join(", ")}.`;
}

/** Optional segment filter, case-insensitive, shared by the retrieval tools. */
function applySegment<T extends { segment: string }>(rows: T[], segment: unknown) {
  if (!segment) return { rows, label: "" };
  const q = norm(segment);
  const hit = rows.filter((r) => norm(r.segment) === q);
  if (hit.length) return { rows: hit, label: `, segment "${segment}"` };
  const loose = rows.filter((r) => norm(r.segment).includes(q));
  return { rows: loose, label: `, segment "${segment}"` };
}

/** Prefix a citation with the study only when more than one is in scope. */
const cite = (
  h: { participant: string; round?: number; t: string; study: string; source?: string },
  multi: boolean,
  showRound = true
) =>
  `${multi ? h.study + " | " : ""}${h.participant}` +
  (showRound && h.round != null ? ` | R${h.round}` : "") +
  ` | ${h.t}` +
  (h.source ? ` | ${h.source}` : "");

const server = new Server(
  { name: "research-lens", version: "2.3.0" },
  { capabilities: { tools: {} } }
);

const STUDY_ARG = {
  study: {
    type: "string",
    description:
      "Optional. Restrict to one study by name. Omit to search every study in the repository.",
  },
};

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_studies",
      description:
        "What is in the research repository: each study's name, how many participants, rounds, segments and themes. Call this first to see what can be asked about.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "search_transcripts",
      description:
        "Full-text search across all session excerpts. Returns matching quotes with participant ID, timestamp, round and segment so every result is traceable.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Words or phrase to find." },
          segment: { type: "string", description: "Optional. Restrict to one user segment." },
          ...STUDY_ARG,
        },
        required: ["query"],
      },
    },
    {
      name: "quotes_by_theme",
      description:
        "Every quote tagged with a given theme, grouped by sentiment. Use to assemble verbatim evidence for a finding.",
      inputSchema: {
        type: "object",
        properties: {
          theme: { type: "string", description: "e.g. trust, onboarding, navigation. Case-insensitive." },
          round: { type: "number", description: "Optional: restrict to one research round." },
          segment: { type: "string", description: "Optional. Restrict to one user segment." },
          ...STUDY_ARG,
        },
        required: ["theme"],
      },
    },
    {
      name: "pattern_frequency",
      description:
        "How many distinct participants raised each theme, split by segment. Answers 'is this a pattern or one loud participant'.",
      inputSchema: { type: "object", properties: { ...STUDY_ARG } },
    },
    {
      name: "compare_rounds",
      description:
        "For one theme, compare sentiment and task completion between round 1 and round 2. Use to show whether a design change worked.",
      inputSchema: {
        type: "object",
        properties: { theme: { type: "string" }, ...STUDY_ARG },
        required: ["theme"],
      },
    },
    {
      name: "draft_findings",
      description:
        "An evidence-backed findings skeleton for a theme: the pattern, who said it, supporting quotes with citations, and what is NOT yet supported by the data.",
      inputSchema: {
        type: "object",
        properties: { theme: { type: "string" }, ...STUDY_ARG },
        required: ["theme"],
      },
    },
    {
      name: "release_readiness",
      description:
        "Issues found in research, grouped by the severity the researcher tagged, with how many participants hit each and the quotes behind them. Answers 'what is still open before we ship'. Ends with what the evidence does not cover.",
      inputSchema: { type: "object", properties: { ...STUDY_ARG } },
    },
    {
      name: "track_metric",
      description:
        "One measure across studies in date order: task completion or mean SUS, optionally split by segment. Answers 'did it improve since last release'. Reports each study separately and never averages across them.",
      inputSchema: {
        type: "object",
        properties: {
          metric: { type: "string", description: "completion or sus. Defaults to both." },
          segment: { type: "string", description: "Optional. Restrict to one user segment." },
        },
      },
    },
    {
      name: "prior_research",
      description:
        "Which past studies already touched a topic, when, and with how many participants. Call this before commissioning new research so a question that has already been answered is not paid for twice.",
      inputSchema: {
        type: "object",
        properties: { topic: { type: "string", description: "A theme, issue or phrase." } },
        required: ["topic"],
      },
    },
    {
      name: "evidence_trail",
      description:
        "Every piece of evidence behind one named issue, across all studies, with participant, study, release and date. Use when someone asks months later why a change was made, or when a decision has to be defensible to an auditor or regulator.",
      inputSchema: {
        type: "object",
        properties: { issue: { type: "string", description: "Issue name, or a theme." } },
        required: ["issue"],
      },
    },
    {
      name: "check_moderator",
      description:
        "Looks at the researcher's own questions rather than the participants' answers. Reports vocabulary the moderator used before any participant did and who then echoed it, leading and closed question phrasings, and how speaking time was distributed. Use before trusting a theme, to check you found it rather than planted it.",
      inputSchema: { type: "object", properties: { ...STUDY_ARG } },
    },
    {
      name: "consent_status",
      description:
        "What each participant agreed to, and what is therefore withheld. Shows the current audience setting, who has withdrawn, and whose quotes cannot be reproduced. Call this before putting quotes in anything that leaves the research team.",
      inputSchema: { type: "object", properties: { ...STUDY_ARG } },
    },
    {
      name: "coverage_gaps",
      description:
        "Who has NOT been researched: segments and regions with thin or no evidence, and themes resting on very few participants. Answers 'whose experience are we guessing about'. The most important tool for anyone about to generalise a finding.",
      inputSchema: { type: "object", properties: { ...STUDY_ARG } },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = (req.params.arguments ?? {}) as Record<string, any>;
  const out = (text: string) => ({ content: [{ type: "text" as const, text }] });

  let all: LoadedStudy[];
  let studies: LoadedStudy[];
  try {
    all = loadAll();
    studies = pick(all, args.study);
  } catch (e) {
    if (e instanceof DataError) return out(e.message);
    throw e;
  }

  const rows = allExcerpts(studies);
  const sessions = sessionsOf(studies);
  const multi = studies.length > 1;
  // Rounds are only worth printing when a study actually ran more than one.
  const showRound = new Set(sessions.map((x) => x.round ?? 1)).size > 1;
  const scope = args.study ? ` in "${args.study}"` : multi ? ` across ${studies.length} studies` : "";

  if (name === "list_studies") {
    const lines = all.map((st) => {
      const people = new Set(st.sessions.map((s) => s.id));
      const rounds = [...new Set(st.sessions.map((s) => s.round ?? 1))].sort();
      const segments = [...new Set(st.sessions.map((s) => s.segment))];
      const themes = [...new Set(st.sessions.flatMap((s) => s.excerpts.map((e) => e.theme)))];
      const quotes = st.sessions.reduce((a, s) => a + s.excerpts.length, 0);
      return (
        `${st.key}\n` +
        `  name:         ${st.study?.name ?? "(unnamed)"}\n` +
        (st.files.length > 1 ? `  merged from:  ${st.files.length} files (${st.files.join(", ")})\n` : "") +
        (st.duplicates.length
          ? `  SKIPPED as duplicates: ${st.duplicates.join("; ")}\n`
          : "") +
        `  participants: ${people.size}   sessions: ${st.sessions.length}   quotes: ${quotes}\n` +
        `  rounds:       ${rounds.join(", ") || "none"}\n` +
        `  segments:     ${segments.join(", ") || "none"}\n` +
        `  themes:       ${themes.join(", ") || "none"}`
      );
    });
    return out(
      `${all.length} study/studies in ${DATA_PATH ? resolve(DATA_PATH) : "the bundled sample"}\n\n` +
        lines.join("\n\n") +
        (DATA_PATH
          ? ""
          : `\n\nThis is the bundled sample. Point RESEARCH_LENS_DATA at your own folder of studies to use your data.`)
    );
  }

  if (name === "search_transcripts") {
    const q = String(args.query ?? "").toLowerCase();
    const seg = applySegment(rows, args.segment);
    const hits = seg.rows.filter(
      (r) => r.quote.toLowerCase().includes(q) || r.theme.toLowerCase().includes(q)
    );
    if (!hits.length) return out(`No excerpts match "${args.query}"${scope}${seg.label}.`);
    return out(
      `${hits.length} excerpt(s) matching "${args.query}"${scope}${seg.label}:\n\n` +
        hits
          .map(
            (h) =>
              `[${cite(h, multi, showRound)} | ${h.segment}] ${h.theme} / ${h.sentiment}\n  ${quoteOrWithheld(h)}`
          )
          .join("\n\n")
    );
  }

  if (name === "quotes_by_theme") {
    const seg = applySegment(rows, args.segment);
    let hits = seg.rows.filter((r) => themeMatches(r.theme, args.theme));
    if (typeof args.round === "number") hits = hits.filter((r) => (r.round ?? 1) === args.round);
    if (!hits.length) {
      // Distinguish "that theme does not exist" from "it exists, just not in
      // that segment". Conflating them reads as an absence of evidence.
      const themeExists = rows.some((r) => themeMatches(r.theme, args.theme));
      if (themeExists && args.segment) {
        const segs = [
          ...new Set(rows.filter((r) => themeMatches(r.theme, args.theme)).map((r) => r.segment)),
        ];
        return out(
          `"${args.theme}" was raised${scope}, but not by any participant in segment "${args.segment}".\n` +
            `Segments that did raise it: ${segs.join(", ")}.\n` +
            `That the segment did not raise it is not evidence they do not care. They may not have been asked.`
        );
      }
      return out(
        `No quotes tagged "${args.theme}"${scope}${seg.label}.` + themeSuggestion(rows, args.theme)
      );
    }
    const groups: Record<string, typeof hits> = { positive: [], negative: [], mixed: [] };
    hits.forEach((h) => groups[h.sentiment]?.push(h));
    const body = Object.entries(groups)
      .filter(([, v]) => v.length)
      .map(
        ([k, v]) =>
          `${k.toUpperCase()} (${v.length})\n` +
          v.map((h) => `  [${cite(h, multi, showRound)}] ${quoteOrWithheld(h)}`).join("\n")
      )
      .join("\n\n");
    return out(`Theme "${args.theme}"${scope}${seg.label} — ${hits.length} excerpt(s)\n\n${body}`);
  }

  if (name === "pattern_frequency") {
    // Counts are never pooled across studies. Different studies have different
    // participants, recruitment and questions, so "5 of 8 across two studies"
    // would be a number that looks like evidence and is not one.
    const perStudy = (st: LoadedStudy) => {
      const rws = allExcerpts([st]);
      // active(), not st.sessions: a withdrawn participant must not sit in a
      // denominator. Leaving them in silently understates every percentage.
      const live = active(st.sessions);
      const total = new Set(live.map((s) => s.id)).size;
      if (!total) return `${st.key}: no sessions.`;
      const byTheme: Record<string, Set<string>> = {};
      const bySegment: Record<string, Record<string, Set<string>>> = {};
      rws.forEach((r) => {
        (byTheme[r.theme] ??= new Set()).add(r.participant);
        ((bySegment[r.theme] ??= {})[r.segment] ??= new Set()).add(r.participant);
      });
      const lines = Object.entries(byTheme)
        .sort((a, b) => b[1].size - a[1].size)
        .map(([theme, set]) => {
          const seg = Object.entries(bySegment[theme])
            .map(([s, ids]) => `${s} ${ids.size}`)
            .join(", ");
          return `  ${theme}: ${set.size}/${total} participants (${seg})`;
        });
      return `${st.key} — ${live.length} sessions\n${lines.join("\n")}`;
    };
    if (!sessions.length) return out(`No sessions${scope}.`);
    const note =
      `\n\nCounts are distinct participants, not quotes. One person saying a thing three times is still one.`;
    if (studies.length === 1) {
      return out(`Pattern frequency${scope}\n\n` + perStudy(studies[0]).split("\n").slice(1).join("\n").replace(/^ {2}/gm, "") + note);
    }
    return out(
      `Pattern frequency, ${studies.length} studies reported separately\n\n` +
        studies.map(perStudy).join("\n\n") +
        note +
        `\nCounts are not pooled across studies: different participants, different recruitment, different questions. Ask about one study to compare like with like.`
    );
  }

  if (name === "compare_rounds") {
    // Rounds only mean something inside one study, so refuse rather than
    // average across studies that were never designed to be compared.
    if (studies.length > 1) {
      return out(
        `Rounds can only be compared within one study. Name one of: ${all.map((s) => s.key).join(", ")}.`
      );
    }
    const theme = String(args.theme);
    // round is optional in the data; loadAll defaults it, but narrow for the type
    const rounds = [...new Set(sessions.map((s) => s.round ?? 1))].sort((a, b) => a - b);
    if (rounds.length < 2) {
      return out(
        rounds.length === 0
          ? `No sessions${scope}, so there is nothing to compare.`
          : `This study has a single round${scope}, so there is nothing to compare. ` +
            `compare_rounds is for studies run before and after a design change.`
      );
    }
    const summarise = (round: number) => {
      const hits = rows.filter((r) => r.theme === theme && (r.round ?? 1) === round);
      const ss = sessions.filter((s) => (s.round ?? 1) === round);
      const scored = ss.filter((s) => typeof s.sus === "number" && s.sus > 0);
      return {
        pos: hits.filter((h) => h.sentiment === "positive").length,
        neg: hits.filter((h) => h.sentiment === "negative").length,
        done: ss.filter((s) => s.completed).length,
        n: ss.length,
        sus: scored.length ? Math.round(scored.reduce((a, s) => a + s.sus, 0) / scored.length) : null,
      };
    };
    const perRound = rounds.map(summarise);
    const first = perRound[0];
    const last = perRound[perRound.length - 1];
    const susLine = (r: { sus: number | null }) => (r.sus === null ? "not recorded" : String(r.sus));
    const susDelta =
      first.sus !== null && last.sus !== null
        ? `SUS ${last.sus - first.sus >= 0 ? "+" : ""}${last.sus - first.sus}`
        : "SUS not comparable";
    // Every round is listed. With three or more, reporting only the first and
    // last would silently hide a regression in the middle.
    const header =
      rounds.length === 2
        ? `round ${rounds[0]} vs round ${rounds[1]}`
        : `rounds ${rounds.join(", ")}`;
    const body = rounds
      .map((rd, i) => {
        const r = perRound[i];
        return `Round ${rd}: ${r.pos} positive / ${r.neg} negative | completed ${r.done}/${r.n} | mean SUS ${susLine(r)}`;
      })
      .join("\n");
    const totalSessions = perRound.reduce((a, r) => a + r.n, 0);
    return out(
      `Theme "${theme}"${scope}, ${header}\n\n` +
        body +
        `\n\nDirection: sentiment ${last.pos - first.pos >= 0 ? "improved" : "declined"}, ${susDelta}.\n` +
        `Caution: ${totalSessions} sessions is a small n. Treat as directional, not significant.` +
        (rounds.length > 2
          ? `\nDirection compares round ${rounds[0]} with round ${rounds[rounds.length - 1]} only. Read the middle rounds above before concluding it improved throughout.`
          : "")
    );
  }

  if (name === "draft_findings") {
    // A finding belongs to a study. Drafting one over pooled studies would put a
    // denominator on the page that no single piece of research supports.
    if (studies.length > 1) {
      return out(
        `A finding is drafted from one study at a time, so the participant count means something. Name one of: ${all.map((s) => s.key).join(", ")}.`
      );
    }
    const theme = String(args.theme);
    const hits = rows.filter((r) => themeMatches(r.theme, theme));
    if (!hits.length)
      return out(
        `No evidence tagged "${theme}"${scope}, so no finding can be drafted.` +
          themeSuggestion(rows, theme)
      );
    const people = new Set(hits.map((h) => h.participant));
    const total = new Set(sessions.map((s) => s.id)).size;
    const neg = hits.filter((h) => h.sentiment === "negative");
    const pos = hits.filter((h) => h.sentiment === "positive");
    const mix = hits.filter((h) => h.sentiment === "mixed");
    const block = (label: string, v: typeof hits) =>
      v.length
        ? `${label} (${v.length}):\n` +
          v.map((h) => `  [${cite(h, multi, showRound)}] ${quoteOrWithheld(h)}`).join("\n") +
          "\n"
        : "";
    return out(
      `DRAFT FINDING — ${theme}${scope}\n\n` +
        `Raised by ${people.size} of ${total} participants.\n\n` +
        `WHAT THE EVIDENCE SHOWS\n` +
        block("Friction", neg) +
        (pos.length ? "\n" : "") +
        block("Working", pos) +
        (mix.length ? "\n" : "") +
        block("Mixed", mix) +
        `\nNOT SUPPORTED BY THIS DATA\n` +
        `  Why participants felt this way beyond what they said aloud.\n` +
        `  Whether it generalises past ${total} participants.\n` +
        `  Any causal claim. This is correlation in a small sample.\n\n` +
        `The researcher writes the recommendation. This tool supplies evidence and its limits.`
    );
  }

  // ---------------------------------------------------------------------
  // Tools for teams who have to make a release decision, not just read a
  // report. They still only retrieve and count. What they add is the honest
  // other half: what the evidence does NOT cover.
  // ---------------------------------------------------------------------

  const studyLabel = (st: LoadedStudy) => {
    const bits = [st.study?.product, st.study?.release, st.study?.date].filter(Boolean);
    return bits.length ? `${st.key} (${bits.join(", ")})` : st.key;
  };

  if (name === "release_readiness") {
    if (!rows.length) return out(`No evidence${scope}.`);
    const people = new Set(sessions.map((s) => s.id)).size;
    const tagged = rows.filter((r) => r.severity);
    if (!tagged.length) {
      return out(
        `No severity tags${scope}, so this cannot report readiness.\n\n` +
          `Add "severity": "blocker" | "major" | "minor" to the excerpts that represent problems. ` +
          `Severity is the researcher's judgment, which is why this tool reads it rather than deciding it.`
      );
    }
    // Group by issue where tagged, otherwise fall back to the theme.
    const byIssue: Record<string, typeof tagged> = {};
    tagged.forEach((r) => ((byIssue[r.issue || r.theme] ??= []).push(r)));
    const sections = SEVERITY_ORDER.map((sev) => {
      const issues = Object.entries(byIssue)
        .filter(([, v]) => v.some((r) => r.severity === sev))
        .map(([issue, v]) => {
          const hits = v.filter((r) => r.severity === sev);
          const who = new Set(hits.map((h) => h.participant));
          const segs = [...new Set(hits.map((h) => h.segment))];
          const quotes = hits
            .slice(0, 3)
            .map((h) => `      [${cite(h, multi, showRound)}] ${quoteOrWithheld(h)}`)
            .join("\n");
          return {
            n: who.size,
            text:
              `   ${issue}: ${who.size} of ${people} participants (${segs.join(", ")})\n` +
              quotes +
              (hits.length > 3 ? `\n      ...and ${hits.length - 3} more` : ""),
          };
        })
        .sort((a, b) => b.n - a.n);
      if (!issues.length) return null;
      const total = new Set(
        tagged.filter((r) => r.severity === sev).map((r) => r.participant)
      ).size;
      return `${sev.toUpperCase()} — ${issues.length} issue(s), ${total} participant(s) affected\n${issues
        .map((i) => i.text)
        .join("\n\n")}`;
    }).filter(Boolean);

    const segs = [...new Set(sessions.map((s) => s.segment))];
    const regions = [...new Set(sessions.map((s) => s.region).filter(Boolean))];
    const thin = segs.filter((sg) => sessions.filter((s) => s.segment === sg).length < 5);

    return out(
      `RELEASE READINESS${scope}\n` +
        `Evidence from ${studies.length} study/studies, ${people} participants, ${sessions.length} sessions.\n` +
        studies.map((st) => `  ${studyLabel(st)}`).join("\n") +
        `\n\n${sections.join("\n\n")}\n\n` +
        `WHAT THIS IS NOT\n` +
        `  Not a ship decision. It counts participants who hit an issue; it does not weigh that against revenue, deadline or effort.\n` +
        `  Not a severity judgment. Severity is read from the researcher's tags, not inferred.\n` +
        `  Not frequency in the wild. ${people} participants in a lab is not ${people} percent of customers.\n\n` +
        `THIN EVIDENCE, TREAT WITH CARE\n` +
        (thin.length
          ? thin
              .map(
                (sg) =>
                  `  ${sg}: only ${sessions.filter((s) => s.segment === sg).length} participant(s)`
              )
              .join("\n")
          : `  Every segment has 5 or more participants.`) +
        (regions.length ? `\n  Regions covered: ${regions.join(", ")}` : `\n  No region recorded on any session.`)
    );
  }

  if (name === "track_metric") {
    const want = String(args.metric ?? "").toLowerCase();
    const seg = args.segment ? String(args.segment).toLowerCase() : null;
    const dated = [...all].sort((a, b) =>
      String(a.study?.date ?? "").localeCompare(String(b.study?.date ?? ""))
    );
    const lines = dated.map((st) => {
      let ss = st.sessions;
      if (seg) ss = ss.filter((s) => s.segment.toLowerCase() === seg);
      if (!ss.length) return `${studyLabel(st)}: no sessions${seg ? ` for segment "${args.segment}"` : ""}`;
      const scored = ss.filter((s) => typeof s.sus === "number" && s.sus > 0);
      const completion = `${ss.filter((s) => s.completed).length}/${ss.length}`;
      const sus = scored.length
        ? Math.round(scored.reduce((a, s) => a + s.sus, 0) / scored.length)
        : null;
      const parts: string[] = [];
      if (!want || want.includes("complet")) parts.push(`completion ${completion}`);
      if (!want || want.includes("sus")) parts.push(`mean SUS ${sus === null ? "not recorded" : sus}`);
      return `${studyLabel(st)}: ${parts.join(" | ")}  (n=${ss.length})`;
    });
    return out(
      `Metric over time${seg ? `, segment "${args.segment}"` : ""}, oldest first\n\n` +
        lines.join("\n") +
        `\n\nStudies are listed separately and never averaged together. Different participants, recruitment and tasks.\n` +
        (dated.some((st) => !st.study?.date)
          ? `Some studies have no "date" in their study block, so this order may be wrong. Add one to fix it.`
          : `Ordered by the "date" field on each study.`)
    );
  }

  if (name === "prior_research") {
    const q = String(args.topic ?? "").toLowerCase();
    const found = all
      .map((st) => {
        const rws = allExcerpts([st]).filter(
          (r) =>
            r.theme.toLowerCase().includes(q) ||
            r.quote.toLowerCase().includes(q) ||
            (r.issue ?? "").toLowerCase().includes(q)
        );
        return { st, rws, people: new Set(rws.map((r) => r.participant)) };
      })
      .filter((x) => x.rws.length);
    if (!found.length) {
      return out(
        `No existing study in this repository covers "${args.topic}".\n\n` +
          `Searched ${all.length} study/studies: ${all.map((s) => s.key).join(", ")}.\n` +
          `Absence here means nobody filed it, which is not the same as nobody having asked. Check outside the repository before concluding it is unresearched.`
      );
    }
    return out(
      `"${args.topic}" has already been researched in ${found.length} study/studies\n\n` +
        found
          .map(
            (x) =>
              `${studyLabel(x.st)}\n` +
              `  ${x.people.size} participant(s), ${x.rws.length} excerpt(s)\n` +
              `  themes: ${[...new Set(x.rws.map((r) => r.theme))].join(", ")}\n` +
              `  e.g. [${cite({ ...x.rws[0], study: x.st.key }, true, showRound)}] ${quoteOrWithheld(x.rws[0])}`
          )
          .join("\n\n") +
        `\n\nRead these before commissioning new research on the topic.`
    );
  }

  if (name === "evidence_trail") {
    const q = String(args.issue ?? "").toLowerCase();
    const hits = allExcerpts(all).filter(
      (r) => (r.issue ?? "").toLowerCase() === q || r.theme.toLowerCase() === q ||
             (r.issue ?? "").toLowerCase().includes(q)
    );
    if (!hits.length) {
      return out(`No evidence filed under "${args.issue}" in any study.`);
    }
    const byStudy: Record<string, typeof hits> = {};
    hits.forEach((h) => ((byStudy[h.study] ??= []).push(h)));
    const people = new Set(hits.map((h) => h.participant));
    return out(
      `EVIDENCE TRAIL — ${args.issue}\n` +
        `${hits.length} excerpt(s) from ${people.size} participant(s), across ${Object.keys(byStudy).length} study/studies.\n\n` +
        Object.entries(byStudy)
          .map(([key, v]) => {
            const st = all.find((s) => s.key === key)!;
            return (
              `${studyLabel(st)}\n` +
              v
                .map(
                  (h) =>
                    `  [${h.participant} | R${h.round} | ${h.t}] ${h.segment}` +
                    (h.severity ? ` | ${h.severity}` : "") +
                    `\n    ${quoteOrWithheld(h)}`
                )
                .join("\n")
            );
          })
          .join("\n\n") +
        `\n\nEvery line above is a participant's own words with the session it came from. Nothing here is summarised or rephrased.`
    );
  }

  if (name === "check_moderator") {
    const withTurns = sessions.filter((x) => (x.moderator_turns?.length ?? 0) > 0);
    if (!withTurns.length) {
      return out(
        `No moderator turns recorded${scope}, so there is nothing to check.\n\n` +
          `Import transcripts with --skip-moderator (or --moderator "Name") and the researcher's ` +
          `own turns are kept under "moderator_turns" instead of being thrown away.`
      );
    }

    const toSec = (t: string) => {
      const p = t.split(":").map(Number);
      return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : (p[0] || 0) * 60 + (p[1] || 0);
    };
    const STOP = new Set(
      ("the a an and or but if then than that this these those i you he she it we they me him her us them my your his its our their what which who whom whose when where why how all any both each few more most other some such no nor not only own same so too very can will just do does did doing done have has had having be been being am is are was were would could should may might must shall about above after again against because before below between during for from further here into of off on once out over through to under until up with " +
       "okay yeah yes right sure thanks thank think know like really going get got go went say said tell told talk maybe actually basically kind sort bit lot thing things one two also well now even back way time use used using").split(" ")
    );
    const words = (txt: string) =>
      (txt.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []).filter((w) => !STOP.has(w));

    // 1. PRIMING: a word the moderator says first, that participants then adopt.
    const modFirst = new Map<string, { t: number; quote: string }>();
    for (const sess of withTurns) {
      for (const turn of sess.moderator_turns!) {
        const at = toSec(turn.t);
        for (const w of new Set(words(turn.text))) {
          const prev = modFirst.get(w);
          if (!prev || at < prev.t) modFirst.set(w, { t: at, quote: turn.text });
        }
      }
    }
    type Echo = { participant: string; t: string; quote: string };
    const echoes = new Map<string, Echo[]>();
    const partFirst = new Map<string, number>();
    for (const r of rows) {
      const at = toSec(r.t);
      for (const w of new Set(words(r.quote))) {
        if (!partFirst.has(w) || at < partFirst.get(w)!) partFirst.set(w, at);
        const m = modFirst.get(w);
        if (m && m.t < at) {
          const list = echoes.get(w) ?? [];
          if (!list.some((e) => e.participant === r.participant))
            list.push({ participant: r.participant, t: r.t, quote: r.quote });
          echoes.set(w, list);
        }
      }
    }
    const primed = [...echoes.entries()]
      .filter(([w, list]) => list.length >= 1 && modFirst.get(w)!.t < (partFirst.get(w) ?? Infinity))
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 8);

    // 2. LEADING AND CLOSED QUESTIONS, by phrasing only.
    const LEADING: [RegExp, string][] = [
      [/\b(don'?t|doesn'?t|didn'?t|wouldn'?t|isn'?t|aren'?t|wasn'?t|haven'?t)\s+(you|it|that|they)\b/i, "negative tag question"],
      [/\bso\s+you\b/i, "summarising back to the participant"],
      [/\b(was|is|were)\s+(it|that|this)\s+(hard|difficult|frustrating|confusing|annoying|easy|simple|clear|good|bad)\b/i, "valence supplied in the question"],
      [/\bdid you find\s+(it|that|this)?\s*(hard|difficult|frustrating|confusing|easy|clear)/i, "valence supplied in the question"],
      [/\bhow\s+(frustrating|annoying|difficult|confusing|easy|hard)\b/i, "presupposes the feeling"],
      [/\bwould you say\b/i, "inviting agreement"],
      [/\b(obviously|clearly|surely|of course)\b/i, "assumes agreement"],
      [/,?\s*right\s*\?\s*$/i, "seeking confirmation"],
    ];
    const CLOSED = /^\s*(do|does|did|is|are|was|were|have|has|had|can|could|will|would|should)\b/i;
    const flagged: string[] = [];
    let closedCount = 0, questionCount = 0;
    for (const sess of withTurns) {
      for (const turn of sess.moderator_turns!) {
        const isQ = turn.text.includes("?");
        if (isQ) questionCount++;
        for (const [re, why] of LEADING) {
          if (re.test(turn.text)) {
            flagged.push(`  [${turn.t}] ${why}\n    "${turn.text.trim()}"`);
            break;
          }
        }
        if (isQ && CLOSED.test(turn.text)) closedCount++;
      }
    }

    // 3. AIRTIME, in words.
    const modWords = withTurns.reduce(
      (a, x) => a + x.moderator_turns!.reduce((b, t) => b + t.text.split(/\s+/).length, 0), 0);
    const byParticipant: Record<string, number> = {};
    rows.forEach((r) => {
      byParticipant[r.participant] = (byParticipant[r.participant] ?? 0) + r.quote.split(/\s+/).length;
    });
    const partTotal = Object.values(byParticipant).reduce((a, b) => a + b, 0);
    const airtime = Object.entries(byParticipant).sort((a, b) => b[1] - a[1]);

    return out(
      `MODERATOR CHECK${scope}\n` +
        `${withTurns[0].moderator_turns!.length} moderator turns, ${questionCount} questions asked.\n\n` +
        `VOCABULARY THE MODERATOR USED FIRST\n` +
        (primed.length
          ? primed
              .map(([w, list]) => {
                const m = modFirst.get(w)!;
                return (
                  `  "${w}" — moderator at ${Math.floor(m.t / 60)}:${String(Math.floor(m.t % 60)).padStart(2, "0")}, ` +
                  `then used by ${list.length} participant(s)\n` +
                  `    moderator: "${m.quote.trim().slice(0, 110)}"\n` +
                  list.slice(0, 2).map((e) => `    [${e.participant} ${e.t}] "${e.quote.slice(0, 110)}"`).join("\n")
                );
              })
              .join("\n\n")
          : `  No word appears in a participant's answer that the moderator used first.`) +
        `\n\nQUESTION PHRASING\n` +
        (flagged.length ? flagged.join("\n") : `  No leading phrasings matched.`) +
        `\n  ${closedCount} of ${questionCount} questions opened with a yes/no verb.\n\n` +
        `AIRTIME, IN WORDS\n` +
        `  moderator: ${modWords}\n` +
        airtime.map(([p, n]) => `  ${p}: ${n}${partTotal ? ` (${Math.round((n / partTotal) * 100)}% of participant words)` : ""}`).join("\n") +
        `\n\nWHAT THIS IS NOT\n` +
        `  Not proof of bias. A moderator naturally repeats the product's own vocabulary, and a word appearing here may simply be the right word.\n` +
        `  Not a verdict on any question. Phrasings are matched by pattern, and a closed question is often the correct one to ask.\n` +
        `  Only counts words in excerpts that were tagged, so it sees what you kept, not everything that was said.\n` +
        `  What it is for: deciding whether to go back to the recording before you call something a finding.`
    );
  }

  if (name === "consent_status") {
    const everySession = studies.flatMap((st) => st.sessions.map((x) => ({ ...x, study: st.key })));
    if (!everySession.length) return out(`No sessions${scope}.`);
    const group: Record<Consent, typeof everySession> = {
      full: [], internal: [], counts: [], withdrawn: [],
    };
    everySession.forEach((x) => group[consentOf(x)].push(x));
    const line = (x: (typeof everySession)[number]) =>
      `  ${x.id}${multi ? ` (${x.study})` : ""}${x.consent_note ? ` — ${x.consent_note}` : ""}`;
    const section = (c: Consent, explain: string) =>
      group[c].length ? `${c.toUpperCase()} (${group[c].length}) — ${explain}\n${group[c].map(line).join("\n")}` : "";
    const withheld = everySession.filter(
      (x) => consentOf(x) !== "withdrawn" && !mayQuote(consentOf(x))
    ).length;
    return out(
      `CONSENT${scope}\n` +
        `Audience: ${AUDIENCE === "team" ? "research team (RESEARCH_LENS_AUDIENCE unset or \"team\")" : "external (RESEARCH_LENS_AUDIENCE=external)"}\n` +
        `${everySession.length} participants on file, ${group.withdrawn.length} withdrawn, ` +
        `${withheld} whose quotes are withheld at this audience setting.\n\n` +
        [
          section("full", "quotes may be reproduced"),
          section("internal", `quotes shown to the research team only${AUDIENCE === "external" ? ", withheld here" : ""}`),
          section("counts", "counted, never quoted"),
          section("withdrawn", "removed from every count, quote and denominator"),
        ]
          .filter(Boolean)
          .join("\n\n") +
        `\n\nHOW THIS IS ENFORCED\n` +
        `  Withdrawn participants are removed before anything is counted, so they do not sit in a denominator.\n` +
        `  A withheld quote is always labelled as withheld, never silently dropped. "Nobody said this" and "someone said this and did not consent to it leaving" must never look the same.\n` +
        `  Consent is read from the data. This server never infers it, and a participant with no consent field is treated as "full", which is how studies recorded before consent tracking behave.\n` +
        `  Set RESEARCH_LENS_AUDIENCE=external when the output will leave the research team.`
    );
  }

  if (name === "coverage_gaps") {
    if (!sessions.length) return out(`No sessions${scope}.`);
    const people = new Set(sessions.map((s) => s.id)).size;
    const bySeg: Record<string, Set<string>> = {};
    const byRegion: Record<string, Set<string>> = {};
    sessions.forEach((s) => {
      (bySeg[s.segment] ??= new Set()).add(s.id);
      if (s.region) (byRegion[s.region] ??= new Set()).add(s.id);
    });
    const byTheme: Record<string, Set<string>> = {};
    rows.forEach((r) => (byTheme[r.theme] ??= new Set()).add(r.participant));
    const fragile = Object.entries(byTheme)
      .filter(([, v]) => v.size <= 2)
      .sort((a, b) => a[1].size - b[1].size);
    const thinSeg = Object.entries(bySeg).filter(([, v]) => v.size < 5);

    return out(
      `COVERAGE GAPS${scope}\n${people} participants across ${sessions.length} sessions.\n\n` +
        `SEGMENTS\n` +
        Object.entries(bySeg)
          .sort((a, b) => b[1].size - a[1].size)
          .map(([k, v]) => `  ${k}: ${v.size}`)
          .join("\n") +
        (thinSeg.length
          ? `\n  Thin: ${thinSeg.map(([k, v]) => `${k} (${v.size})`).join(", ")}. A finding about these rests on very few people.`
          : `\n  No segment below 5 participants.`) +
        `\n\nREGIONS\n` +
        (Object.keys(byRegion).length
          ? Object.entries(byRegion)
              .map(([k, v]) => `  ${k}: ${v.size}`)
              .join("\n")
          : `  No region recorded on any session, so nothing can be said about geographic coverage.`) +
        `\n\nTHEMES RESTING ON 1 OR 2 PARTICIPANTS\n` +
        (fragile.length
          ? fragile.map(([k, v]) => `  ${k}: ${v.size}`).join("\n") +
            `\n  These are leads, not findings. Do not put them in a readout as patterns.`
          : `  Every theme has 3 or more participants behind it.`) +
        `\n\nWHAT IS MISSING ENTIRELY\n` +
        `  This tool can only report on people who were recruited. Anyone your recruitment never reached is invisible here, ` +
        `including non-users, people who gave up before becoming customers, and anyone screened out. That is usually the biggest gap and no tool can show it to you.`
    );
  }

  return out(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(
  `research-lens running on stdio, data: ${DATA_PATH ? resolve(DATA_PATH) : "bundled sample"}`
);
