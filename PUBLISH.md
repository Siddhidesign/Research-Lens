# Publishing Research Lens

v2.0.0 is live on npm. These steps ship **v2.1.0**.

---

## 1. Push to GitHub

```bash
cd ~/Documents/Claude/Projects/"Siddhi's Ai assistant"/ux-research-mcp
rm -f .git/index.lock
git add -A
git commit -m "v2.1: release readiness, metric tracking, prior research, evidence trail, coverage gaps"
git push
```

## 2. Publish to npm

```bash
npm publish --access public
```

npm requires 2FA to publish. If it returns `403 Forbidden`, turn on two-factor
authentication at npmjs.com under Account, then run the command again and enter the code
from your authenticator app.

`prepublishOnly` rebuilds automatically, so you cannot publish stale code.

Check it worked:

```bash
npx -y research-lens-mcp
```

It should print `research-lens running on stdio, data: bundled sample` and sit there waiting. Ctrl+C to stop. That is correct behaviour — it is a server, not a command.

If the name `research-lens-mcp` is taken, change `name` in `package.json` to something free and update the README install blocks to match.

## 3. Point GitHub Pages at /docs

Repo → **Settings** → **Pages** → folder `/docs` instead of `/ (root)`.

Still outstanding from before. Until it is changed, `siddhidesign.github.io/Research-Lens/` shows the README rather than the working demo, and the README links to that URL.

---

## Then switch your own setup to the published package

Your Claude Desktop config currently points at a local build. Once published, use the package and your own studies folder:

```bash
mkdir -p ~/Documents/research-studies
cp data/sessions.json ~/Documents/research-studies/money-anchor.json
```

Then edit `~/Library/Application Support/Claude/claude_desktop_config.json` so the `research-lens` entry reads:

```json
"research-lens": {
  "command": "npx",
  "args": ["-y", "research-lens-mcp"],
  "env": { "RESEARCH_LENS_DATA": "/Users/siddhimanche/Documents/research-studies" }
}
```

Quit Claude Desktop with Cmd+Q and reopen. Now you drop new studies into that folder and they appear immediately, no restart, no file swapping.

---

## What shipped in v2

**Multi-study repositories.** `RESEARCH_LENS_DATA` points at a folder of studies. Re-read on every question, so edits take effect with no restart. A new `list_studies` tool shows what is there, and every other tool takes an optional `study` argument.

**It refuses to pool across studies.** This was a bug I introduced and caught in testing: with two studies loaded, `pattern_frequency` reported "trust: 5/8 participants" by adding unrelated studies together. That is precisely the kind of false confidence the tool exists to prevent. Now counts are reported per study, and `compare_rounds` and `draft_findings` decline until you name one, because a denominator that spans two studies is not evidence.

**Installable by anyone.** `npx -y research-lens-mcp`, no clone, no build. Bundled sample study so it works before anyone has data.

**Graceful failure.** Missing folder, empty folder, malformed JSON and unknown study names all return a sentence explaining what to do, rather than crashing the server.

**Parity holds.** 16 of 16 tool responses byte-identical between the demo page and the real server.

---

## Where to tell people about it

Worth doing once it is live, in roughly this order:

1. **Your own LinkedIn post.** Not "I built a thing" — lead with the argument: AI synthesis that cannot cite its sources is a liability in research, so here is a tool that refuses to interpret. The tool is the proof, not the subject.
2. **The MCP servers directory** at github.com/modelcontextprotocol/servers, community section. A pull request adding one line.
3. **r/UXResearch and ResearchOps Slack.** This is their exact complaint about AI.
4. **Your portfolio**, run `#RL-2026`, moved from `building` to `shipped` with both links.

The strongest thing you have here is not the code. It is a defensible position about where AI belongs in research, with a working implementation behind it. Lead with the position.
