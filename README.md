# Docent

A local tool for reviewing large pull requests. Docent breaks a PR into small
"ideas" — each a handful of related hunks with a short explanation — and walks
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
