# PR review tool — design history and destination

This is context and rationale, not a build spec. **The actual v1 build
brief is `START_HERE.md` — read that first, build exactly what it says,
and only come back to this document once that's working.** Reading this
first, before the first slice exists, is what sank the two earlier
attempts at this: the fuller vision here is real and worth having
written down, but it isn't scope for what gets built next.

## Origin

Reviewing large, lazily-organized agent-generated PRs ("just get your
agent to review it") is a bottleneck. The goal: a tool that lets a human
reviewer move through a PR at speed — skip the generated/mechanical
parts, skim tests as "here's what's pinned," spend real attention only
where a PR carries actual design judgment, with a drafted comment ready
where one's warranted.

## What was built and validated (as a CodeTour-based proof of concept)

A Claude Code skill validated the concept before any app existed: it
checked out a PR read-only in an isolated worktree, ran a two-phase
pipeline (below), and rendered the result as chained CodeTour tour files
with a companion VS Code extension. **That skill's files no longer exist
on disk** — they were deleted during the incident that led to
`START_HERE.md` existing at all. The design they embodied is preserved
in this document; the code isn't, and doesn't need to be — none of it
ported directly into the app regardless (see the `plan`-porting note
below).

Validated end-to-end against three real PRs: correct tiering, correct
sliver grouping (independently-startable mental chunks), correct
mechanical test-to-source pairing, real diff anchoring to actual hunks
(not foldable/collapsed regions), real GitHub-side viewed-state writes.

**The two-phase pipeline is the reusable design, independent of anything
CodeTour-specific:**

1. **`plan`** — pure inspection, zero judgment. Per file: status, hunk
   count/lines, a cheap tier guess, hunk-derived anchor lines (skipping
   pure-deletion hunks, which fold by default in diff viewers),
   mechanical test↔source pairing by basename.

   **Correction from the original design:** the CodeTour-era `plan`
   read a real `git diff` against a local checkout. The app's own
   architecture is checkout-free (diffs come from the GitHub API — see
   "No checkout" below), so only `plan`'s *logic* carries over — hunk
   anchoring that skips foldable pure-deletion hunks, test-pairing by
   basename — not its git-based input layer. That layer gets rewritten
   from scratch against API diff text. This was caught but never fixed
   before the first build attempt; fix it for real this time.

2. **Judgment pass** — an LLM reads each file's diff against the PR's
   title/body/ticket and writes a descriptions document:
   `{prOrientation, slivers: [{id, title, narrative}], files: {path:
   {tier, sliver, order, description, proposedComment}}}`. This pass —
   not the rendering — is the actual product. Key rules, learned the
   hard way:
   - Slivers ordered easy/removal-first, judgment-heavy-last. Files
     *within* a sliver ordered beefy-first (front-load the story) — a
     different, non-contradictory heuristic.
   - A `proposedComment` must raise something the diff genuinely can't
     answer — never something checkable from a file already read in the
     same pass.
   - PR orientation gets its own standalone step, not glued onto
     whichever sliver happens to run first.
   - Ticket references (Jira keys, Linear/GitHub-issue URLs — detected
     generically, not hardcoded to one tracker) enrich the orientation
     when a fetch tool for that tracker is available; degrade silently
     to PR-body-only otherwise.

This pipeline has no CodeTour dependency and was already
renderer-agnostic by design. It's a v2+ concern — not in `START_HERE.md`
— but the design above is what to build toward once tiering/judgment
enters the picture.

## Why not CodeTour, a CodeTour fork, or a VS Code extension

CodeTour's entire UI is VS Code's Comments API: one thread, on one line,
read-only body plus markdown command-links.

- No multi-file/multi-block simultaneous view — strictly one step at a
  time.
- No interactive channel — a comment thread can't take free-form input.
- No state model beyond "which step is next" — GitHub's own viewed-state
  is a single file-level boolean; nothing tracks per-line review state,
  let alone the same line's state under multiple concepts at once.

Forking CodeTour doesn't help: multi-block display or two-way
interaction means replacing the comment-thread engine with a custom
webview, at which point most of CodeTour's own code is irrelevant.

**Extension (webview) vs. standalone app** came down to one
discriminating question: *during a real review, how often do you leave
the diff to touch the live codebase?* Rarely, by the user's own account
— review is diff-first, escalate to more context only on demand. That,
plus wanting genuine per-line/multi-concept review state (a data-model
need, not a rendering one) and wanting the AI layer to be a live,
review-aware agent rather than a one-shot generation script, tipped it
to a standalone app.

## Converged architecture

- **No checkout required.** Diffs come straight from GitHub: `gh pr diff
  <n>` or `gh api repos/{owner}/{repo}/pulls/{n}/files` (returns each
  file's `patch`). Full-file context beyond the diff, when needed, is
  fetched lazily per file via `gh api repos/{owner}/{repo}/contents/
  {path}?ref=<sha>` — not upfront, not via a clone. A real checkout is
  an escalation for later (running tests, repo-wide grep), not a v1
  concern.
- **Central data structure (v2+): a persistent review-session object
  per PR** — PR metadata + diffs + judgment-pass output + lazily-fetched
  extra context + conversation/Q&A history + per-line, per-concept
  reviewed/unreviewed state (the same line can be "done" for one
  concept and still open under another). This is the thing neither
  CodeTour nor GitHub's own review UI can represent, and is the app's
  biggest differentiator over "just use GitHub's PR review screen." v1
  only needs file-level reviewed/not-reviewed state — the coarsest
  possible case of this same model, not a different one; nothing about
  building it now gets thrown away later.
- **The "fetch more context if needed" rule generalizes** from the
  judgment pass's one-shot version (read a paired test file in full if
  that's what actually answers a question) into a continuous, visible
  loop: available to the reviewer as a live question, and available to
  the agent proactively whenever it's about to write something it can't
  back up from what it's read so far. v2+ concern.
- **Diff rendering: `react-diff-view`.** Considered against Monaco's
  embeddable diff editor and `diff2html`. Monaco has genuinely superior
  single-diff fidelity (real tokenizers, minimap, folding) but is built
  as an editor, not a review-annotation surface — its decorations API
  isn't purpose-built for persistent per-line state/comments the way
  `react-diff-view`'s widget system is, and running many Monaco
  instances at once (for multi-file display) is measurably heavier than
  many lightweight diff components. `diff2html` is simpler but has weak
  hooks for attaching custom state to individual lines. `react-diff-view`
  renders one file's diff per component — compose as many as needed on
  one page — and its widget/gutter system is built specifically for
  attaching interactive per-line affordances, which is the direction
  this product is headed regardless of how far v1 goes.
- **Model backend: a provider-abstraction interface** (send
  messages/tools, get back response/tool-calls), local-only for now —
  oMLX's OpenAI-compatible server, Qwen 35B as the default model. No
  Claude/Anthropic code anywhere, not even a stub behind the interface,
  until explicitly requested. A frontier option is the eventual end
  goal, evaluated once there's a working baseline to compare against —
  not assumed or scaffolded for now.

## Where this is actually going (destination, not scope)

The product the user described: a big PR gets broken into features, and
each feature into smaller "ideas" — a single idea might be a composite
view spanning a partial hunk from one file, a full small file, and a
couple of already-reviewed lines from elsewhere kept for context, shown
together with a brief explanation of why it's needed and where it fits
in the PR as a whole. Any comment or explanation in that view can be
grabbed and asked about, feeding a single ongoing review-scoped
conversation that helps the reviewer move through the PR quickly. This
is why `react-diff-view` was chosen over the alternatives — composing
arbitrary partial spans across files into one addressable, annotatable
view is exactly its model — but building any of this is several slices
past v1, not part of it.

## What's still genuinely open (not blocking v1, worth flagging so it isn't silently decided later)

- Exact UI/layout for the "ideas" composite view.
- Whether this stays single-user/local forever or ever becomes shared —
  currently single-user by design, not by omission.
- Review-submission shape once there's AI+human combined feedback to
  submit: almost certainly the app's own data shape first, with a
  separate agent-driven translation step into a GitHub review, rather
  than designing around GitHub's review API directly. Not decided, and
  not close to being relevant yet.
