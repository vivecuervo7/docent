# Docent

A local tool for reviewing large pull requests. Docent breaks a PR into small
"slices" — each a handful of related hunks with a short explanation — and walks
you through them one at a time, starting from an overview of what the PR does,
why, and what reviewers have already said.

Everything runs on your machine: GitHub is read through the `gh` CLI, and the
summaries come from a local model. Review progress lives in your browser's
IndexedDB.

## Requirements

- A recent Node.js (the frontend is built with Vite 8)
- [GitHub CLI](https://cli.github.com/), authenticated (`gh auth login`) with
  access to the repos you want to review
- A local OpenAI-compatible chat endpoint at `http://127.0.0.1:8000/v1`, such
  as oMLX. The endpoint and model name are set in
  `backend/src/modelProvider.ts`.

## Running

```sh
cd backend && npm install && npm run dev    # http://localhost:3001
cd frontend && npm install && npm run dev   # http://localhost:5173
```

Open http://localhost:5173 and paste a GitHub PR URL.

## Using your own agent for the agent review

The backend serves an MCP server at `http://localhost:3001/mcp` (Streamable
HTTP, local connections only). With Claude Code, add it once:

```sh
claude mcp add --scope user --transport http docent http://localhost:3001/mcp
```

Then choose "Use your own agent" on a PR's Agent feedback page and run
`/mcp__docent__review owner/repo#123` to review it your usual way, or
`/mcp__docent__submit owner/repo#123` to send the findings of a review you've
already run in the session. Other MCP-capable agents can connect to the same
address; the page shows a prompt to give them. The agent reads the PR through `get_review_context`, `get_diff`,
`read_file` and `get_existing_comments`, and its `submit_finding` calls appear
on the page as they arrive.
