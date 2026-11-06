# UX Research MCP Server

An MCP server that gives an AI assistant direct, structured access to a UX research repository, so synthesis happens against the actual evidence instead of pasted snippets.

Built by Siddhi Manche.

---

## The problem

Synthesis is where research time goes and where research quality is lost.

The usual AI workflow is copy and paste: you move transcript chunks into a chat window, the model summarises them, and you get something fluent back. Two things go wrong. The model only sees what you happened to paste, so it cannot tell you how many participants raised a theme or whether round two improved on round one. And the output has no citations, so you cannot trace a claim back to who actually said it.

That is not a model problem. It is an access problem.

## The approach

MCP lets the assistant query the repository directly. Five tools, and a deliberate constraint: **the server retrieves and counts, it does not interpret.**

Every result carries participant ID, timestamp, round and segment. The researcher still writes the finding. The tool supplies the evidence and, importantly, states its limits.

## Tools

| Tool | What it answers |
|---|---|
| `search_transcripts` | Where was this mentioned, by whom, when |
| `quotes_by_theme` | Give me every quote on this theme, grouped by sentiment |
| `pattern_frequency` | Is this a pattern or one loud participant |
| `compare_rounds` | Did the design change actually work |
| `draft_findings` | Evidence skeleton with citations, plus what the data does not support |

## Design decisions worth defending

**Citations are mandatory, not optional.** Every excerpt returns with `[P14 | R2 | 08:47]`. A finding you cannot trace is a finding you cannot defend in a stakeholder review.

**Participant counts, not quote counts.** `pattern_frequency` counts distinct participants, because three quotes from one person is not a pattern. It splits by segment for the same reason.

**The server says what it cannot tell you.** `draft_findings` ends with a NOT SUPPORTED section: no causal claims, no generalising past the sample. An AI that sounds confident about six participants is a liability in research.

**No interpretation.** The tools never say what a finding means. That judgment stays with the researcher. This is the line between AI that accelerates research and AI that quietly replaces thinking with plausible text.

## The demo page

`docs/index.html` runs all five tools in a browser so the responses can be read without a
chat client. It is a single self-contained file: no build step on the host, no dependencies,
no backend. Open it directly or serve the folder.

It is built from the same sources as the server, never hand-edited:

| Source | What it holds |
|---|---|
| `data/sessions.json` | the research repository, single source of truth |
| `docs/tools.mjs` | the five tool functions, ported from `src/index.ts` |
| `docs/page.mjs` | the demo UI |
| `docs/index.template.html` | markup and styles |

```bash
node docs/build.mjs            # regenerates docs/index.html
node docs/verify_parity.mjs    # asserts the page matches the real server
```

`verify_parity.mjs` spawns the built MCP server over stdio, calls every tool with the same
arguments as the browser port, and fails if any response differs by a single byte. A demo
that quietly disagrees with the server is worse than no demo, so this runs before any deploy.

## Running it

```bash
npm install
npm run build
node test_client.mjs     # exercises the tools without a chat client
```

To use it in Claude Desktop, add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ux-research": {
      "command": "node",
      "args": ["/absolute/path/to/ux-research-mcp/build/index.js"]
    }
  }
}
```

Then ask things like:

- "Which themes came up across the most participants?"
- "Did trust improve between round one and round two?"
- "Draft a finding on explainability and show me the quotes."

## Data

`data/sessions.json` holds six sessions from a two-round usability study on an AI personal finance product. Quotes are paraphrased and anonymised for portfolio use. The schema takes any study: sessions, segments, rounds, tagged excerpts, SUS scores.

## Stack

TypeScript, Node, `@modelcontextprotocol/sdk`, stdio transport.
