# Deploying Research Lens to GitHub Pages

Target URL: **https://siddhidesign.github.io/research-lens/**

Everything below is free and uses the GitHub account you already have.

---

## Before you push

Run both of these from the project folder. If either fails, fix it before deploying.

```bash
npm run build                  # compiles the TypeScript server
node docs/build.mjs            # regenerates the self-contained docs/index.html
node docs/verify_parity.mjs    # must print "13/13 identical"
```

The parity check is the important one. It spawns the real MCP server and asserts the demo
page returns byte-identical output. If it fails, the page is lying about what the server
does, and that is the one thing this project cannot afford.

## Create the repo and push

```bash
cd ux-research-mcp
git init
git add .
git commit -m "Research Lens: MCP server for UX research repositories, with demo page"
git branch -M main
```

Then on github.com, create a new **public** repo named `research-lens`. Do not add a README,
licence or .gitignore, since you already have them. Copy the remote URL it gives you, then:

```bash
git remote add origin https://github.com/Siddhidesign/research-lens.git
git push -u origin main
```

## Turn on Pages

In the new repo: **Settings → Pages**.

- Source: **Deploy from a branch**
- Branch: **main**, folder: **/docs**
- Save

Give it a minute or two. The URL appears at the top of that same settings page.

## Check it worked

Open https://siddhidesign.github.io/research-lens/ and confirm:

- all five tools are listed
- `search_transcripts` is expanded and already shows a result
- clicking **Run** on each one returns text, not an error
- the theme dropdowns are populated (trust, control, onboarding, explainability)
- the page is readable on your phone

## Updating it later

```bash
node docs/build.mjs
node docs/verify_parity.mjs
git add . && git commit -m "what changed" && git push
```

Pages redeploys on push. Never hand-edit `docs/index.html` or `docs/sessions.js`, since both
are generated and your changes will be overwritten. Edit `docs/tools.mjs`, `docs/page.mjs`,
`docs/index.template.html` or `data/sessions.json` instead.

---

## Once it is live

**On the resume**, Research Lens can carry a URL and move from a side note to a project line:

> Research Lens, AI Research Tool | Self-Built, MCP Server | siddhidesign.github.io/research-lens

**In the portfolio**, this is run `#RL-2026` in `Portfolio_Change_Prompt.md`. Change its
status from `building` to `shipped` and add the live link.

**In outreach**, it stops being "I've been building" and becomes "here it is."

## The honest next step

The demo runs on six sessions of paraphrased Money Anchor data. The version that is actually
interview-proof runs on your own anonymised capstone transcripts, because then you can answer
"what did you learn using it on real data" with something other than a shrug. That is the next
piece of work, and it does not need any new code: just a replacement `data/sessions.json` in
the same schema, then `node docs/build.mjs`.
