# Start here

Build exactly this, and only this, first. `HANDOFF.md` holds the full
design history and where this product is eventually going — reference
material for later, not part of this brief. Reading ahead into it to
decide what else belongs in this first pass is the specific mistake that
sank the last two attempts at this. Don't open it until this slice is
built, working, and looked at together.

## What v1 is

Fetch a PR's changed files and diffs, show them file-by-file, let the
reviewer tick each file off as reviewed. That's the whole thing:

- A backend endpoint that, given an owner/repo/PR number, fetches the
  changed files and their diffs via the `gh` CLI.
- A frontend page that renders each file's diff with `react-diff-view`,
  one file after another.
- A per-file checkbox (reviewed / not reviewed) whose state persists to
  a local JSON file, one per review session.

No model calls. No tiering or judgment pass. No grouping into
features/ideas. No line-level state. No comment drafting. No writing
anything back to GitHub. All of that is real and already designed in
`HANDOFF.md` — just not in this slice.

## Confirmed, not up for re-deciding

- Lives in `/Users/isaac/repos/codetour-pr`. The name used so far is a
  placeholder — don't invent a permanent one.
- Stack: Node/TypeScript backend, Vite/React frontend.
- GitHub access via the `gh` CLI (already authenticated).
- Diff rendering: `react-diff-view`.
- Persistence: flat JSON files — not SQLite, not DuckDB.
- Single user, local only.

## How this gets built

State the one specific thing about to be built, in one sentence, and
stop — wait for an explicit "do this," not a question being answered or
a design point being confirmed. Once this slice works, stop and ask
what's next rather than continuing into `HANDOFF.md`'s broader scope
unasked. (This is also the standing rule in the user's own CLAUDE.md —
restated here because it's the exact thing that broke last time.)
