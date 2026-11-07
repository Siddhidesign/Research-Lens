# Evaluation 1 — results

Scored against [`eval1-ground-truth.md`](eval1-ground-truth.md), which was written from the
raw transcripts before any tool was run, with the tagged study files closed. Scoring the tool
against its own input would prove nothing.

**Corpus:** two EV charging interviews, first three minutes each, Whisper `tiny.en`.
**Tagged into:** 2 participants, 13 excerpts, 5 themes.
**Tools tested:** `pattern_frequency`, `draft_findings`, `search_transcripts`, `find_dissent`, `check_moderator`.

---

## Score

**9 of 11 findings surfaced. 1 partial. 1 missed entirely.**

| | Finding | Result |
|---|---|---|
| F1 | Price is the first filter | ✅ found — `pricing`, 2/2 participants |
| F2 | Queue length overrides price | ✅ found — `wait time` |
| F3 | Trip type switches the decision | ✅ found — `network choice` |
| F4 | Workplace charging removes the problem | ✅ found — `network choice` |
| F5 | Seven-step session start | ✅ found — `session start`, both excerpts |
| F6 | Supercharger's advantage is no interface | ✅ found — `session start`, positive |
| F7 | Non-Tesla owner says Tesla leads | ✅ found — `reliability` |
| F8 | Broken chargers survivable because flagged | ✅ found — `reliability`, mixed |
| F9 | Users do the fault reporting | ✅ found — `reliability`, positive |
| F10 | Slow charging accepted as normal | ⚠️ partial |
| F11 | Usage frequency differs 10x | ❌ missed |

---

## The two failures are the same failure

**F11, missed outright.** P01 says "Quite often. Probably twice a week." P02 says "maybe once
every two months." A tenfold difference in exposure, which should qualify every comparison
between these two people.

The tool cannot see it. Not because retrieval failed, but because **the line was never
tagged.** It sits in the transcript at 01:16 and never made it into the study file.

**F10, partial.** The quote is retrievable, but it is filed under `wait time / negative`. The
actual finding is the opposite of a complaint: the user has *normalised* the problem — "that's
typical, any EV owner will tell you." A negative tag loses the interesting part, which is the
acceptance. The words are there; the meaning was flattened at tagging time.

Both failures happened before the server ever ran. The tool retrieved correctly in every case.
What it could not do was recover evidence a human did not tag, or re-read a judgment a human
got wrong.

---

## What this says about the design

The honest version of the claim is narrower than it looked:

> Research Lens makes tagged evidence traceable and countable. It does not make untagged
> evidence findable, and it inherits every judgment made at tagging time.

That boundary is deliberate — tagging is interpretation and interpretation stays with the
researcher — but this evaluation puts a number on the cost of it. Roughly one finding in ten
was lost to selective tagging on a small, carefully tagged corpus. On a real repository
tagged in a hurry, it would be worse.

`coverage_gaps` already warns that it "only reports on people who were recruited." It should
also warn that it only reports on **lines that were tagged**, which is a second and larger
blind spot.

---

## What the tools found that the ground truth did not

Two things came out of the tools that were not in the hand-written list.

**`check_moderator` found priming.** The moderator said "failed chargers" at 02:16. P01 said
"failed chargers" at 02:22. Six seconds. F8 may be partly the interviewer's framing rather
than the participant's own. Nothing in the hand-written ground truth caught this, because the
person writing it was reading for what participants said, not for what the researcher planted.

**`find_dissent` separated two kinds of disagreement.** On `session start`, P02 holds both a
positive and a negative view. The tool reported this as one person comparing two products
rather than as a split between participants — a distinction the ground truth did not make.

---

## Known limits of this evaluation

- **Two participants.** Far too small to say anything about accuracy at scale.
- **Six minutes of audio**, not full interviews.
- **Same person wrote the ground truth, the tags, and the tool.** A genuine evaluation needs
  the tagging and the ground truth done by different people, ideally blind.
- **No comparison condition.** It does not show the tool beats pasting the transcript into a
  chat window; it only shows what the tool does and does not surface.

The result worth acting on is not the 9 of 11. It is that **both failures were tagging
failures**, and the tool has no way to tell you when that has happened.
