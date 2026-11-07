/**
 * Research Lens, tool logic for the browser demo.
 *
 * A direct port of src/index.ts for the single-study case, which is what the
 * demo page shows. The server itself also handles a folder of several studies
 * and deliberately refuses to pool counts across them.
 *
 * verify_parity.mjs diffs this file's output against the real server's, so the
 * demo cannot drift away from the implementation.
 *
 * Design intent, unchanged from the server: every result carries the participant
 * ID, round and timestamp behind it, so a claim can always be traced back to who
 * said it. These functions retrieve and count. They do not interpret.
 */

/** Flatten every excerpt with its session context attached. */
function allExcerpts(repo) {
  return repo.sessions.flatMap((s) =>
    s.excerpts.map((e) => ({
      ...e,
      participant: s.id,
      round: s.round,
      segment: s.segment,
      task: s.task,
    }))
  );
}

/** Single study on this page, so citations never need a study prefix. */
const cite = (h) => `${h.participant} | R${h.round} | ${h.t}`;

const norm = (s) => String(s ?? "").trim().toLowerCase();
const themeMatches = (rowTheme, wanted) => norm(rowTheme) === norm(wanted);

function themeSuggestion(rows, wanted) {
  const all = [...new Set(rows.map((r) => r.theme))];
  if (!all.length) return "";
  const q = norm(wanted);
  const near = all.filter((t) => norm(t).includes(q) || q.includes(norm(t)));
  return near.length ? ` Did you mean: ${near.join(", ")}?` : ` Themes in scope: ${all.join(", ")}.`;
}

function applySegment(rows, segment) {
  if (!segment) return { rows, label: "" };
  const q = norm(segment);
  const hit = rows.filter((r) => norm(r.segment) === q);
  if (hit.length) return { rows: hit, label: `, segment "${segment}"` };
  return { rows: rows.filter((r) => norm(r.segment).includes(q)), label: `, segment "${segment}"` };
}

function list_studies(repo) {
  const people = new Set(repo.sessions.map((s) => s.id));
  const rounds = [...new Set(repo.sessions.map((s) => s.round))].sort();
  const segments = [...new Set(repo.sessions.map((s) => s.segment))];
  const themes = [...new Set(repo.sessions.flatMap((s) => s.excerpts.map((e) => e.theme)))];
  const quotes = repo.sessions.reduce((a, s) => a + s.excerpts.length, 0);
  return (
    `name:         ${repo.study?.name ?? "(unnamed)"}\n` +
    `participants: ${people.size}   sessions: ${repo.sessions.length}   quotes: ${quotes}\n` +
    `rounds:       ${rounds.join(", ") || "none"}\n` +
    `segments:     ${segments.join(", ") || "none"}\n` +
    `themes:       ${themes.join(", ") || "none"}`
  );
}

function search_transcripts(repo, args) {
  const rows = allExcerpts(repo);
  const q = String(args.query ?? "").toLowerCase();
  const seg = applySegment(rows, args.segment);
  const hits = seg.rows.filter(
    (r) => r.quote.toLowerCase().includes(q) || r.theme.toLowerCase().includes(q)
  );
  if (!hits.length) return `No excerpts match "${args.query}"${seg.label}.`;
  return (
    `${hits.length} excerpt(s) matching "${args.query}"${seg.label}:\n\n` +
    hits
      .map((h) => `[${cite(h)} | ${h.segment}] ${h.theme} / ${h.sentiment}\n  "${h.quote}"`)
      .join("\n\n")
  );
}

function quotes_by_theme(repo, args) {
  const rows = allExcerpts(repo);
  const seg = applySegment(rows, args.segment);
  let hits = seg.rows.filter((r) => themeMatches(r.theme, args.theme));
  if (typeof args.round === "number") hits = hits.filter((r) => r.round === args.round);
  if (!hits.length) {
    const themeExists = rows.some((r) => themeMatches(r.theme, args.theme));
    if (themeExists && args.segment) {
      const segs = [
        ...new Set(rows.filter((r) => themeMatches(r.theme, args.theme)).map((r) => r.segment)),
      ];
      return (
        `"${args.theme}" was raised, but not by any participant in segment "${args.segment}".\n` +
        `Segments that did raise it: ${segs.join(", ")}.\n` +
        `That the segment did not raise it is not evidence they do not care. They may not have been asked.`
      );
    }
    return `No quotes tagged "${args.theme}"${seg.label}.` + themeSuggestion(rows, args.theme);
  }
  const groups = { positive: [], negative: [], mixed: [] };
  hits.forEach((h) => groups[h.sentiment]?.push(h));
  const body = Object.entries(groups)
    .filter(([, v]) => v.length)
    .map(
      ([k, v]) =>
        `${k.toUpperCase()} (${v.length})\n` +
        v.map((h) => `  [${cite(h)}] "${h.quote}"`).join("\n")
    )
    .join("\n\n");
  return `Theme "${args.theme}"${seg.label} — ${hits.length} excerpt(s)\n\n${body}`;
}

function pattern_frequency(repo) {
  const rows = allExcerpts(repo);
  const sessions = repo.sessions;
  if (!sessions.length) return "No sessions.";
  const total = new Set(sessions.map((s) => s.id)).size;
  const byTheme = {};
  const bySegment = {};
  rows.forEach((r) => {
    (byTheme[r.theme] ??= new Set()).add(r.participant);
    ((bySegment[r.theme] ??= {})[r.segment] ??= new Set()).add(r.participant);
  });
  const lines = Object.entries(byTheme)
    .sort((a, b) => b[1].size - a[1].size)
    .map(([theme, set]) => {
      const seg = Object.entries(bySegment[theme])
        .map(([s, ids]) => `${s} ${ids.size}`)
        .join(", ");
      return `${theme}: ${set.size}/${total} participants (${seg})`;
    });
  return (
    `Pattern frequency\n\n${lines.join("\n")}\n\n` +
    `Counts are distinct participants, not quotes. One person saying a thing three times is still one.`
  );
}

function compare_rounds(repo, args) {
  const rows = allExcerpts(repo);
  const sessions = repo.sessions;
  const theme = String(args.theme);
  const rounds = [...new Set(sessions.map((s) => s.round))].sort((a, b) => a - b);
  if (rounds.length < 2) {
    return `Only round ${rounds[0] ?? "none"} exists, so there is nothing to compare.`;
  }
  const summarise = (round) => {
    const hits = rows.filter((r) => r.theme === theme && r.round === round);
    const ss = sessions.filter((s) => s.round === round);
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
  const susLine = (r) => (r.sus === null ? "not recorded" : String(r.sus));
  const susDelta =
    first.sus !== null && last.sus !== null
      ? `SUS ${last.sus - first.sus >= 0 ? "+" : ""}${last.sus - first.sus}`
      : "SUS not comparable";
  const header =
    rounds.length === 2 ? `round ${rounds[0]} vs round ${rounds[1]}` : `rounds ${rounds.join(", ")}`;
  const body = rounds
    .map((rd, i) => {
      const r = perRound[i];
      return `Round ${rd}: ${r.pos} positive / ${r.neg} negative | completed ${r.done}/${r.n} | mean SUS ${susLine(r)}`;
    })
    .join("\n");
  const totalSessions = perRound.reduce((a, r) => a + r.n, 0);
  return (
    `Theme "${theme}", ${header}\n\n` +
    body +
    `\n\nDirection: sentiment ${last.pos - first.pos >= 0 ? "improved" : "declined"}, ${susDelta}.\n` +
    `Caution: ${totalSessions} sessions is a small n. Treat as directional, not significant.` +
    (rounds.length > 2
      ? `\nDirection compares round ${rounds[0]} with round ${rounds[rounds.length - 1]} only. Read the middle rounds above before concluding it improved throughout.`
      : "")
  );
}

function draft_findings(repo, args) {
  const rows = allExcerpts(repo);
  const theme = String(args.theme);
  const hits = rows.filter((r) => themeMatches(r.theme, theme));
  if (!hits.length)
    return `No evidence tagged "${theme}", so no finding can be drafted.` + themeSuggestion(rows, theme);
  const people = new Set(hits.map((h) => h.participant));
  const total = new Set(repo.sessions.map((s) => s.id)).size;
  const neg = hits.filter((h) => h.sentiment === "negative");
  const pos = hits.filter((h) => h.sentiment === "positive");
  const mix = hits.filter((h) => h.sentiment === "mixed");
  const block = (label, v) =>
    v.length
      ? `${label} (${v.length}):\n` + v.map((h) => `  [${cite(h)}] "${h.quote}"`).join("\n") + "\n"
      : "";
  return (
    `DRAFT FINDING — ${theme}\n\n` +
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

const TOOLS = {
  list_studies,
  search_transcripts,
  quotes_by_theme,
  pattern_frequency,
  compare_rounds,
  draft_findings,
};

if (typeof window !== "undefined") window.RESEARCH_LENS_TOOLS = TOOLS;
export { TOOLS, allExcerpts };
