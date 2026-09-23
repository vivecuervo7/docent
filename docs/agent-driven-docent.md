# Agent-driven Docent

A direction we've discussed but haven't built: letting the reviewer's own
coding agent (Claude Code, Codex, or anything that speaks MCP) do Docent's
heavy lifting, with Docent as the guided review UI around it.

## What

The expensive, patient work moves to the reviewer's agent, driven over MCP:

1. **Prepare the review.** A command in the agent, such as
   `/mcp__docent__prepare owner/repo#123`, reads the PR, with the actual
   repo at hand to explore, run and follow references in. It submits the
   slices, the summary and the conversation summary through Docent's
   tools, and optionally runs its review and submits findings too. Docent's
   start page shows the PR being prepared, then ready.
2. **Review in Docent.** Slices, questions and comments work as they do now.
   Replies to questions come from the local model, or from a headless agent
   run (`claude -p` or similar) for frontier-quality answers at a few
   seconds' start-up per question.
3. **Build the feedback.** A second command pulls the reviewer's threads,
   the agent findings and the PR's existing conversation through tools,
   distils the reviewer's feedback, merges it with the agent's, dedupes
   against what's already been said, and submits a draft review.
4. **Post the review.** The reviewer ticks, rewords and picks an outcome in
   Docent, which posts with a plain `gh api` call. No model is involved.

## Why

- Slicing, summarising, reviewing and building feedback are the biggest
  tasks, and they tolerate latency. A frontier model with the whole repo does
  them far better than a small local model reading patches.
- Reviewers use their own subscription, model, skills and conventions, with
  no API keys, provider settings or hosting for Docent to manage.
- Docent concentrates on what it's for: the guided walk through the PR, the
  state of the review, and checks on what gets submitted.

## How

**Direction of calls.** MCP is driven by the agent: it calls Docent's
tools when it chooses to, and Docent can't hand work to a running session.
Work the agent starts (preparing, reviewing, building feedback) fits MCP
directly. Work the reviewer starts in Docent's UI, such as asking about
lines, runs on the local model, or on a headless agent that Docent launches
per task with its MCP server attached. Follow-up questions can resume the
same headless session so a thread keeps its context.

**State moves to the backend.** Today each PR's state lives in the
browser's IndexedDB, which agents can't reach. Building the feedback needs
the reviewer's threads and ticks, so this direction needs per-PR state in a
store the backend owns, with the browser reading and writing through it. That
reverses the current "browser only" choice.

**Checks on what agents submit.** The tools check what they receive and
return errors an agent can act on, the way `submit_finding` already rejects
lines outside the diff and lists the ones that are in it. For slices, that
means every hunk is covered exactly once by valid `path#index` references.

**What carries over.** The UI, the MCP server and its read tools, the
findings path, the line checks and the local-model fallback all stay. What
changes is who runs preparation and feedback, and where state lives.

**First slice when we build it.** "Prepare" tools (`submit_slices`,
`submit_summary`, `submit_conversation`) together with backend-owned state,
since neither works without the other.

**Still to check.** The exact flags for passing an MCP config to
`claude -p` and for structured output. MCP sampling, which would let Docent
ask the agent's model for completions directly, isn't supported by Claude
Code (its feature request, anthropics/claude-code#1785, is still open); Codex
is unchecked.
