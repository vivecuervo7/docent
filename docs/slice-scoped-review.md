# Slice-scoped review

An idea we want to explore but haven't built: review a PR one slice at a
time, then in a second pass look at how the slices fit together, instead of
reviewing the whole PR in one go.

## What

**Review a slice on its own.** Each slice can be reviewed by itself, from its
page ("Review this slice") or as part of a full review. The reviewer sees
the slice's diff, its summary, the PR's summary, and whatever else it needs
to read (other files, callers, tests). Its findings are pinned to that slice,
so the slice's page and its sidebar row show what was found there.

**Then an integration pass.** Once the slices are reviewed, one more pass
reads the slice summaries and their findings, not the raw diff, and looks
for what no single slice can show:

- a contract changed in one slice but not followed through in another;
- behaviour that nothing tests;
- naming, error handling or conventions that differ across slices;
- dead ends: code added but never used, or used but never added.

Its findings are about the PR as a whole, or about several slices at once.

**Re-review a slice.** When the author changes a slice, only that slice
needs reviewing again, followed by a fresh integration pass.

## Why

Agent reviews usually take in the whole PR at once. As PRs grow, that gets
less trustworthy: attention thins, findings get vaguer, and later files get
less scrutiny than earlier ones. Slices are Docent's answer to the same
problem for the human reviewer, a small coherent piece at a time with the
context to understand it, and an agent reviewer may benefit in the same way.

It also makes the review accountable: findings attached to slices show which
parts of the PR were looked at, and which weren't.

And it may curb the habit agents have of always finding something to raise,
warranted or not. A small, coherent slice leaves less surface to go looking
in, and "nothing to raise in this slice" becomes an ordinary result rather
than a review that seems to have failed.

## How

**What exists already.** Docent's own reviewer (`backend/src/agentReview.ts`)
already makes one pass per slice. What's missing is the integration pass,
triggering one slice's review on its own, and keeping findings attached to
their slice.

**Findings know their slice.** A finding records the slice it came from,
alongside its file and lines. Integration findings record the slices they
connect, or none.

**Over MCP.** The same shape suits an agent in the reviewer's own harness:
a `review_slice` command reviews one slice through `get_diff` with the
slice's id, then `submit_finding` with that id; a `review_integration`
command reads `get_review_context` and the existing findings, then submits
its own. A full review is every slice, then integration.

**Context beyond the slice.** A slice's diff isn't always enough to judge
it. Agents with repo access (MCP, `claude -p`) can read what they need;
Docent's own reviewer would need a `read_file` step, or the slice's files in
full, to do the same.

## Open questions

- Does the integration pass find real problems, or mostly restate the slice
  findings? Is it better fed the slice findings, the summaries, or both?
- How much context does a slice pass need beyond its own diff before it's
  reliable?
- Cost: N slice passes plus an integration pass, against one whole-PR pass.
- How to tell whether it's more trustworthy. A starting point: run both on a
  large PR (PA-970) and compare the findings by hand, counting real issues,
  false positives and misses.
