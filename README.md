# Research Lens

**An MCP server that lets an AI assistant query your UX research repository — with the participant ID attached to every claim.**

[Try the live demo](https://siddhidesign.github.io/Research-Lens/) · [Install](#install) · [Format](#your-data) · [Why it refuses to interpret](#the-constraint)

```
You:  Did trust improve between round one and round two?

      Theme "trust", round 1 vs round 2

      Round 1: 0 positive / 1 negative | completed 1/3 | mean SUS 55
      Round 2: 2 positive / 0 negative | completed 3/3 | mean SUS 81

      Direction: sentiment improved, SUS +26.
      Caution: 6 sessions is a small n. Treat as directional, not significant.
```

That last line is the point.

---

## The problem

You finish twelve interviews. Now someone asks how many people struggled with signup, and whether the redesign helped.

The usual answer is copy and paste: move transcript chunks into a chat window, let the model summarise. Two things go wrong, and neither is the model's fault.

**It only sees what you pasted.** So it cannot tell you how many participants raised a theme, or whether round two beat round one. It can only describe the fragment in front of it, confidently.

**The output has no citations.** You get a fluent paragraph about what "users" want. You cannot trace a single claim back to a person, which means you cannot defend it when a stakeholder asks "says who?"

That is not a model problem. It is an access problem.

## What this does

Research Lens gives the assistant direct, structured access to your repository. You ask questions in plain language; it queries the actual data.

| Ask | Tool | You get |
|---|---|---|
| "What's in my repository?" | `list_studies` | Every study, its participants, rounds, segments and themes |
| "Did anyone mention pricing?" | `search_transcripts` | Matching quotes, each with participant, round and timestamp |
| "Show me everything about trust" | `quotes_by_theme` | Verbatim quotes grouped by sentiment |
| "Is this a real pattern?" | `pattern_frequency` | Distinct participants per theme, split by segment |
| "Did the redesign work?" | `compare_rounds` | Sentiment, completion and SUS, round over round |
| "Draft a finding on onboarding" | `draft_findings` | Evidence with citations, plus what the data does not support |

Teams shipping on a release schedule, and anyone whose decisions have to survive an audit, get five more:

| Ask | Tool | You get |
|---|---|---|
| "What's still open before we ship?" | `release_readiness` | Issues by the severity you tagged, participants affected, quotes behind each |
| "Did it improve since last release?" | `track_metric` | Completion and SUS per study in date order, never averaged across studies |
| "Has anyone studied this already?" | `prior_research` | Which past studies touched a topic, when, with how many participants |
| "Why did we make that change?" | `evidence_trail` | Every verbatim quote behind one issue, with participant, study, release and date |
| "Whose experience are we guessing about?" | `coverage_gaps` | Segments, regions and themes resting on too few people |

`release_readiness` ends with what it is *not*: not a ship decision, not a severity judgment, not frequency in the wild. `coverage_gaps` ends by naming the gap no tool can show you, the people your recruitment never reached.

## The constraint

**The server retrieves and counts. It does not interpret.**

That line is enforced, not aspirational, and it shows up in four places:

**Citations are mandatory.** Every excerpt returns as `[P14 | R2 | 08:47]`. A finding you cannot trace is a finding you cannot defend.

**It counts participants, not quotes.** Three quotes from one enthusiastic person is not a pattern. `pattern_frequency` counts distinct people and splits by segment, which is how you discover that a complaint belongs to new users only.

**It says what it cannot tell you.** `draft_findings` ends with a NOT SUPPORTED section: no causal claims, no generalising past the sample. An AI that sounds certain about six participants is a liability.

**It refuses to pool across studies.** Ask for a finding while two studies are loaded and it declines, because "5 of 8 participants" across two unrelated studies is a number that looks like evidence and is not one. Different recruitment, different questions, different people.

The tools never say what a finding *means*. That judgment stays with the researcher. This is the line between AI that accelerates research and AI that quietly replaces thinking with plausible text.

## Consent, enforced at the point of query

Research platforms manage consent at the storage layer: who can log into the tool. Research
Lens enforces it at the **query** layer, where an AI agent actually reads. Each participant
carries what they agreed to, and the server obeys it.

| Consent | What happens |
|---|---|
| `full` | Quotes reproduced normally. The default, so existing studies are unaffected. |
| `internal` | Quotes shown to the research team, withheld when the output is external. |
| `counts` | Counted in every pattern, never quoted. They agreed to be studied, not published. |
| `withdrawn` | Removed from every count, quote and **denominator**. |

Set `RESEARCH_LENS_AUDIENCE=external` when the answer will leave the research team.

A withheld quote is always labelled:

```
MIXED (1)
  [P07 | R1 | 02:55] [quote withheld: consented to research-team use only, and this output is external]
```

It is never silently dropped. "Nobody said this" and "someone said this and did not consent
to it leaving" must never look the same, because one is a finding and the other is a
compliance breach wearing a finding's clothes.

`consent_status` reports who agreed to what, who withdrew, and what is being withheld right
now. Consent is read from the data and never inferred.

## Install

**Claude Desktop.** Open your config:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Add this inside `mcpServers`:

```json
{
  "mcpServers": {
    "research-lens": {
      "command": "npx",
      "args": ["-y", "research-lens-mcp"],
      "env": {
        "RESEARCH_LENS_DATA": "/absolute/path/to/your/studies"
      }
    }
  }
}
```

Restart Claude Desktop. Leave out the `env` block to try it against the bundled sample study first.

**Claude Code**

```bash
claude mcp add research-lens -e RESEARCH_LENS_DATA=/path/to/studies -- npx -y research-lens-mcp
```

**Any other MCP client:** the command is `npx -y research-lens-mcp` over stdio.

Node 18 or newer. Nothing to clone, nothing to build.

## Your data

`RESEARCH_LENS_DATA` points at a folder. One `.json` file per study, added or edited any time — the server re-reads on every question, so no restart.

```json
{
  "study": { "name": "Refund flow usability test", "irb": "optional" },
  "sessions": [
    {
      "id": "P01",
      "round": 1,
      "segment": "new user",
      "task": "find a refund",
      "completed": false,
      "sus": 52,
      "excerpts": [
        {
          "t": "04:12",
          "theme": "navigation",
          "sentiment": "negative",
          "quote": "I could not tell which button actually submits."
        }
      ]
    }
  ]
}
```

Only `id`, `round`, `segment` and the excerpt fields are required. Everything else is optional and degrades gracefully: no SUS scores means `compare_rounds` reports "not recorded" rather than inventing a number.

### Getting your data in

**From a spreadsheet.** Fill in [`template.csv`](template.csv), one row per quote, then:

```bash
npx research-lens-mcp-import my-study.csv "Study name"
```

It validates every row, names the row and the reason if something is wrong, and writes nothing until the file is clean.

**From raw transcripts.** [`INGEST_PROMPT.md`](INGEST_PROMPT.md) is a prompt you hand to Claude along with your transcripts. It proposes a theme list and stops for your approval, tags the quotes, then shows you every judgment call before writing anything. It is instructed to use verbatim quotes only and to anonymise as it goes.

Tagging lives in that prompt rather than in the server on purpose. Deciding a quote is "about trust" and "negative" is interpretation, and interpretation is the researcher's job. AI proposes, the researcher decides, the tool keeps score.

## How it is kept honest

The [demo page](https://siddhidesign.github.io/Research-Lens/) reimplements the tools in the browser so you can read the raw responses without installing anything. That creates a drift risk — the page could start saying something the server does not.

So `npm run verify` spawns the real server over stdio, calls every tool with the same arguments the page uses, and fails if any response differs by a single byte. Currently 16 of 16 identical. A demo that quietly disagrees with the thing it demonstrates is worse than no demo.

## Development

```bash
git clone https://github.com/Siddhidesign/research-lens.git
cd research-lens && npm install && npm run build
npm run verify              # parity between demo page and server
node docs/build.mjs         # rebuild the self-contained demo page
```

TypeScript, Node, `@modelcontextprotocol/sdk`, stdio transport. No runtime dependencies beyond the SDK.

## Credits

Built by [Siddhi Manche](https://siddhidesign.github.io/Portfolio/), a UX researcher and designer, with an AI coding assistant.

The bundled sample is six sessions from an IRB-approved study (HUM00280873) on an AI personal finance product. Quotes are paraphrased and anonymised.

MIT licensed. Issues and pull requests welcome — particularly from researchers who try it on a real study and find where it falls short.
