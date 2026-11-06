#!/usr/bin/env node
/**
 * UX Research MCP Server
 *
 * Gives an AI assistant direct, structured access to a UX research repository
 * so synthesis happens against the actual evidence instead of pasted snippets.
 *
 * Design intent: every tool returns the participant IDs and timestamps behind
 * an answer, so a claim can always be traced back to who said it. The server
 * deliberately does NOT interpret. It retrieves and counts; the researcher
 * still decides what it means.
 *
 * Tools
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
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

type Excerpt = {
  t: string;
  theme: string;
  sentiment: "positive" | "negative" | "mixed";
  quote: string;
};

type Session = {
  id: string;
  round: number;
  segment: string;
  task: string;
  completed: boolean;
  sus: number;
  excerpts: Excerpt[];
};

type Repo = {
  study: Record<string, unknown>;
  sessions: Session[];
};

function loadRepo(): Repo {
  const path = join(__dirname, "..", "data", "sessions.json");
  return JSON.parse(readFileSync(path, "utf-8")) as Repo;
}

/** Flatten every excerpt with its session context attached. */
function allExcerpts(repo: Repo) {
  return repo.sessions.flatMap((s) =>
    s.excerpts.map((e) => ({ ...e, participant: s.id, round: s.round, segment: s.segment, task: s.task }))
  );
}

const server = new Server(
  { name: "ux-research", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_transcripts",
      description:
        "Full-text search across all session excerpts. Returns matching quotes with participant ID, timestamp, round and segment so every result is traceable.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "Words or phrase to find." } },
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
          theme: { type: "string", description: "e.g. trust, explainability, control, onboarding" },
          round: { type: "number", description: "Optional: restrict to one research round." },
        },
        required: ["theme"],
      },
    },
    {
      name: "pattern_frequency",
      description:
        "How many distinct participants raised each theme, split by segment. Answers 'is this a pattern or one loud participant'.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "compare_rounds",
      description:
        "For one theme, compare sentiment and task completion between round 1 and round 2. Use to show whether a design change worked.",
      inputSchema: {
        type: "object",
        properties: { theme: { type: "string" } },
        required: ["theme"],
      },
    },
    {
      name: "draft_findings",
      description:
        "An evidence-backed findings skeleton for a theme: the pattern, who said it, supporting quotes with citations, and what is NOT yet supported by the data.",
      inputSchema: {
        type: "object",
        properties: { theme: { type: "string" } },
        required: ["theme"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const repo = loadRepo();
  const rows = allExcerpts(repo);
  const name = req.params.name;
  const args = (req.params.arguments ?? {}) as Record<string, any>;
  const out = (text: string) => ({ content: [{ type: "text" as const, text }] });

  if (name === "search_transcripts") {
    const q = String(args.query ?? "").toLowerCase();
    const hits = rows.filter((r) => r.quote.toLowerCase().includes(q) || r.theme.toLowerCase().includes(q));
    if (!hits.length) return out(`No excerpts match "${args.query}".`);
    return out(
      `${hits.length} excerpt(s) matching "${args.query}":\n\n` +
        hits
          .map((h) => `[${h.participant} | R${h.round} | ${h.segment} | ${h.t}] ${h.theme} / ${h.sentiment}\n  "${h.quote}"`)
          .join("\n\n")
    );
  }

  if (name === "quotes_by_theme") {
    let hits = rows.filter((r) => r.theme === args.theme);
    if (typeof args.round === "number") hits = hits.filter((r) => r.round === args.round);
    if (!hits.length) return out(`No quotes tagged "${args.theme}".`);
    const groups: Record<string, typeof hits> = { positive: [], negative: [], mixed: [] };
    hits.forEach((h) => groups[h.sentiment].push(h));
    const body = Object.entries(groups)
      .filter(([, v]) => v.length)
      .map(
        ([k, v]) =>
          `${k.toUpperCase()} (${v.length})\n` +
          v.map((h) => `  [${h.participant} | R${h.round} | ${h.t}] "${h.quote}"`).join("\n")
      )
      .join("\n\n");
    return out(`Theme "${args.theme}" — ${hits.length} excerpt(s)\n\n${body}`);
  }

  if (name === "pattern_frequency") {
    const total = repo.sessions.length;
    const byTheme: Record<string, Set<string>> = {};
    const bySegment: Record<string, Record<string, Set<string>>> = {};
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
    return out(`Pattern frequency across ${total} sessions\n\n${lines.join("\n")}`);
  }

  if (name === "compare_rounds") {
    const theme = String(args.theme);
    const summarise = (round: number) => {
      const hits = rows.filter((r) => r.theme === theme && r.round === round);
      const sessions = repo.sessions.filter((s) => s.round === round);
      const pos = hits.filter((h) => h.sentiment === "positive").length;
      const neg = hits.filter((h) => h.sentiment === "negative").length;
      const done = sessions.filter((s) => s.completed).length;
      const sus = sessions.length ? Math.round(sessions.reduce((a, s) => a + s.sus, 0) / sessions.length) : 0;
      return { pos, neg, done, n: sessions.length, sus };
    };
    const r1 = summarise(1);
    const r2 = summarise(2);
    return out(
      `Theme "${theme}" across rounds\n\n` +
        `Round 1: ${r1.pos} positive / ${r1.neg} negative | task completed ${r1.done}/${r1.n} | mean SUS ${r1.sus}\n` +
        `Round 2: ${r2.pos} positive / ${r2.neg} negative | task completed ${r2.done}/${r2.n} | mean SUS ${r2.sus}\n\n` +
        `Direction: sentiment ${r2.pos - r1.pos >= 0 ? "improved" : "declined"}, SUS ${r2.sus - r1.sus >= 0 ? "+" : ""}${r2.sus - r1.sus}.\n` +
        `Caution: small n. Treat as directional, not significant.`
    );
  }

  if (name === "draft_findings") {
    const theme = String(args.theme);
    const hits = rows.filter((r) => r.theme === theme);
    if (!hits.length) return out(`No evidence tagged "${theme}", so no finding can be drafted.`);
    const people = new Set(hits.map((h) => h.participant));
    const neg = hits.filter((h) => h.sentiment === "negative");
    const pos = hits.filter((h) => h.sentiment === "positive");
    return out(
      `DRAFT FINDING — ${theme}\n\n` +
        `Raised by ${people.size} of ${repo.sessions.length} participants.\n\n` +
        `WHAT THE EVIDENCE SHOWS\n` +
        (neg.length ? `Friction (${neg.length}):\n` + neg.map((h) => `  [${h.participant} ${h.t}] "${h.quote}"`).join("\n") + "\n" : "") +
        (pos.length ? `\nWorking (${pos.length}):\n` + pos.map((h) => `  [${h.participant} ${h.t}] "${h.quote}"`).join("\n") + "\n" : "") +
        `\nNOT SUPPORTED BY THIS DATA\n` +
        `  Why participants felt this way beyond what they said aloud.\n` +
        `  Whether it generalises past ${repo.sessions.length} participants.\n` +
        `  Any causal claim. This is correlation in a small sample.\n\n` +
        `The researcher writes the recommendation. This tool supplies evidence and its limits.`
    );
  }

  return out(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("ux-research MCP server running on stdio");
