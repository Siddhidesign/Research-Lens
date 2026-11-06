/**
 * Research Lens, tool logic
 *
 * These five functions are a direct port of src/index.ts, the MCP server.
 * The server speaks MCP over stdio to an AI assistant. This file runs the
 * identical logic in a browser so the output can be seen without a chat client.
 *
 * verify_parity.mjs diffs this file's output against the server's, so the demo
 * cannot drift away from the real thing.
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

function search_transcripts(repo, args) {
  const rows = allExcerpts(repo);
  const q = String(args.query ?? "").toLowerCase();
  const hits = rows.filter(
    (r) => r.quote.toLowerCase().includes(q) || r.theme.toLowerCase().includes(q)
  );
  if (!hits.length) return `No excerpts match "${args.query}".`;
  return (
    `${hits.length} excerpt(s) matching "${args.query}":\n\n` +
    hits
      .map(
        (h) =>
          `[${h.participant} | R${h.round} | ${h.segment} | ${h.t}] ${h.theme} / ${h.sentiment}\n  "${h.quote}"`
      )
      .join("\n\n")
  );
}

function quotes_by_theme(repo, args) {
  const rows = allExcerpts(repo);
  let hits = rows.filter((r) => r.theme === args.theme);
  if (typeof args.round === "number") hits = hits.filter((r) => r.round === args.round);
  if (!hits.length) return `No quotes tagged "${args.theme}".`;
  const groups = { positive: [], negative: [], mixed: [] };
  hits.forEach((h) => groups[h.sentiment].push(h));
  const body = Object.entries(groups)
    .filter(([, v]) => v.length)
    .map(
      ([k, v]) =>
        `${k.toUpperCase()} (${v.length})\n` +
        v.map((h) => `  [${h.participant} | R${h.round} | ${h.t}] "${h.quote}"`).join("\n")
    )
    .join("\n\n");
  return `Theme "${args.theme}" — ${hits.length} excerpt(s)\n\n${body}`;
}

function pattern_frequency(repo) {
  const rows = allExcerpts(repo);
  const total = repo.sessions.length;
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
  return `Pattern frequency across ${total} sessions\n\n${lines.join("\n")}`;
}

function compare_rounds(repo, args) {
  const rows = allExcerpts(repo);
  const theme = String(args.theme);
  const summarise = (round) => {
    const hits = rows.filter((r) => r.theme === theme && r.round === round);
    const sessions = repo.sessions.filter((s) => s.round === round);
    const pos = hits.filter((h) => h.sentiment === "positive").length;
    const neg = hits.filter((h) => h.sentiment === "negative").length;
    const done = sessions.filter((s) => s.completed).length;
    const sus = sessions.length
      ? Math.round(sessions.reduce((a, s) => a + s.sus, 0) / sessions.length)
      : 0;
    return { pos, neg, done, n: sessions.length, sus };
  };
  const r1 = summarise(1);
  const r2 = summarise(2);
  return (
    `Theme "${theme}" across rounds\n\n` +
    `Round 1: ${r1.pos} positive / ${r1.neg} negative | task completed ${r1.done}/${r1.n} | mean SUS ${r1.sus}\n` +
    `Round 2: ${r2.pos} positive / ${r2.neg} negative | task completed ${r2.done}/${r2.n} | mean SUS ${r2.sus}\n\n` +
    `Direction: sentiment ${r2.pos - r1.pos >= 0 ? "improved" : "declined"}, SUS ${
      r2.sus - r1.sus >= 0 ? "+" : ""
    }${r2.sus - r1.sus}.\n` +
    `Caution: small n. Treat as directional, not significant.`
  );
}

function draft_findings(repo, args) {
  const rows = allExcerpts(repo);
  const theme = String(args.theme);
  const hits = rows.filter((r) => r.theme === theme);
  if (!hits.length) return `No evidence tagged "${theme}", so no finding can be drafted.`;
  const people = new Set(hits.map((h) => h.participant));
  const neg = hits.filter((h) => h.sentiment === "negative");
  const pos = hits.filter((h) => h.sentiment === "positive");
  return (
    `DRAFT FINDING — ${theme}\n\n` +
    `Raised by ${people.size} of ${repo.sessions.length} participants.\n\n` +
    `WHAT THE EVIDENCE SHOWS\n` +
    (neg.length
      ? `Friction (${neg.length}):\n` +
        neg.map((h) => `  [${h.participant} ${h.t}] "${h.quote}"`).join("\n") +
        "\n"
      : "") +
    (pos.length
      ? `\nWorking (${pos.length}):\n` +
        pos.map((h) => `  [${h.participant} ${h.t}] "${h.quote}"`).join("\n") +
        "\n"
      : "") +
    `\nNOT SUPPORTED BY THIS DATA\n` +
    `  Why participants felt this way beyond what they said aloud.\n` +
    `  Whether it generalises past ${repo.sessions.length} participants.\n` +
    `  Any causal claim. This is correlation in a small sample.\n\n` +
    `The researcher writes the recommendation. This tool supplies evidence and its limits.`
  );
}

const TOOLS = {
  search_transcripts,
  quotes_by_theme,
  pattern_frequency,
  compare_rounds,
  draft_findings,
};

// Works as an ES module for the parity check, and as a plain script in the page.
if (typeof window !== "undefined") window.RESEARCH_LENS_TOOLS = TOOLS;
export { TOOLS, allExcerpts };
