# Loading a new study into Research Lens

Two ways in. Both end with the same `data/sessions.json`, and neither needs a restart.

- **A** You already have structured notes → fill in `template.csv`, run one command.
- **B** You have raw transcripts → paste the prompt below into Claude and let it do the
  tagging, with you approving it.

---

## A. From a spreadsheet

Open `template.csv` in Excel, Numbers or Google Sheets. One row per quote. Fill down the
participant columns so every row for a person repeats their details.

| Column | What goes in it | Required |
|---|---|---|
| participant | P01, P02 … | yes |
| round | 1, 2 … | yes |
| segment | the user group, e.g. "new user" | yes |
| task | what you asked them to do | no |
| completed | yes / no | no |
| sus | their SUS score, blank if none | no |
| timestamp | 04:12 | no |
| theme | what the quote is about | yes |
| sentiment | positive, negative or mixed | yes |
| quote | their words, verbatim | yes |

Save as CSV, then:

```bash
npm run import my-study.csv "Study name" "IRB number"
```

It backs up the old data, refuses to write anything if a row is malformed, and tells you
exactly which row is wrong. Then just ask your assistant a question.

---

## B. From raw transcripts, with a prompt

Put your transcript files in a folder. Open any AI assistant that can read the folder (Claude Code, Cursor, Windsurf, ChatGPT
with the files attached) and paste everything below the line.

---

You are helping me load a UX study into Research Lens, an MCP server that answers questions
about a research repository. Your job is to turn raw transcripts into one CSV row per
meaningful quote. Read `INGEST_PROMPT.md` and `template.csv` in this project first so you
match the format exactly.

**The rule that matters most: every quote must be the participant's actual words, copied
from the transcript.** Do not paraphrase, tidy, shorten or improve them. Do not write a
quote that is not in the source. If a line is unclear, leave it out and tell me, rather than
guessing what they meant. A repository full of invented quotes is worse than no repository.

Work in this order, and stop at each checkpoint.

**1. Tell me what you found.** How many transcripts, how many participants, and whether each
one tells you the round, the user segment, the task, completion and a SUS score. List what is
missing. Ask me for anything you cannot read off the files. Do not guess a segment from
someone's name or how they talk.

**2. Propose a theme list, then stop.** Read everything, then suggest 4 to 8 themes that
cover what people actually talked about, with a one-line definition of each and a rough
count of how many participants touched it. Themes should describe the subject, not the
verdict: "onboarding", not "onboarding is confusing". Wait for me to approve, rename or
merge them before you tag anything.

**3. Tag the quotes.** Once themes are agreed, pull every quote that carries evidence about
one of them. Skip small talk, moderator speech and anything that is just task narration.
For each, record the timestamp if the transcript has one, the theme, and a sentiment of
positive, negative or mixed. Sentiment is about the experience being described, not the
person's tone. If you are unsure between two sentiments, use mixed and flag it.

**4. Show me the ones you were unsure about, then stop.** Before writing anything, list
every quote where the theme or sentiment was a judgment call, with your reasoning in one
line each. I will correct them. Do not skip this step, even if the list is short, and do not
hide uncertainty by picking the safer label.

**5. Write the file and verify.** Save as `study.csv` in the project root in exactly the
`template.csv` column order, then run:

```bash
npm run import study.csv "<study name>" "<IRB number or blank>"
```

Report what the importer printed. If it found problems, fix those rows and run it again.
Then run `node docs/build.mjs` so the demo page shows the new study too.

**6. Hand it back to me.** Tell me how many participants, sessions and quotes went in, and
the participant count per theme. Then stop. Do not tell me what the findings mean, do not
write recommendations, and do not describe anything as a problem users have. That judgment
is mine, and the whole point of this tool is that it supplies evidence rather than
conclusions.

**Anonymising:** replace real names with P01, P02 and so on, consistently. Strip employers,
locations, email addresses and anything else that could identify someone. If a quote cannot
be anonymised without changing its words, leave it out and tell me which one.

---

## Why the tagging is not a tool on the server

The server has five tools and none of them tag anything. That is deliberate. Deciding a
quote is "about trust" and "negative" is interpretation, and interpretation is the thing the
researcher is responsible for.

Keeping it out here means an AI can suggest the tags, quickly, over a lot of material, but a
person signs off before any of it gets counted. Once tagged data is in the repository, the
server only ever retrieves and counts it. The line is: AI proposes, the researcher decides,
the tool keeps score.
