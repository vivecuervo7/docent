# Docent

A local tool for reviewing large pull requests. Docent breaks a PR into small
"slices" — each a handful of related hunks with a short explanation — and walks
you through them one at a time, starting from an overview of what the PR does,
why, and what reviewers have already said.

Everything runs on your machine: GitHub is read through the `gh` CLI, and the
summaries come from the model you configure. Reviews are saved by the backend,
in `backend/data/docent.db`.

## Requirements

- A recent Node.js
- [GitHub CLI](https://cli.github.com/), signed in (`gh auth login`) with
  access to the repos you want to review. Docent reads PRs and posts your
  reviews through it, as you.
- A model, from either or both of:
  - [Claude Code](https://code.claude.com), installed and signed in. Choosing
    one of its models runs every model call through `claude -p` on your own
    login. Those calls have no tools, MCP servers or user settings, so they
    can only read the prompt Docent sends.
  - Any number of OpenAI-compatible providers: a local server such as oMLX
    or LM Studio, or a hosted proxy such as LiteLLM. Add them on the
    **Settings** page, with a key if they need one and how many requests
    each takes at once.

Settings are saved on your machine in `backend/data/settings.json` (keys
included; the file is written owner-only and keys never go back to the
browser). An endpoint from an older `backend/.env` is imported there the
first time the backend starts, after which the `.env` file isn't used.

Pick the model from the menu on the start page. The app's **Getting started**
page (linked from the start page) checks each of these for you.

## Running

```sh
cd backend && npm install && npm run dev    # http://localhost:3001
cd web && npm install && npm run dev        # http://localhost:5174
```

Open http://localhost:5174 and paste a GitHub PR URL.

## Bringing your own agent

A PR's review panel can include your own agent beside Docent's reviewers.
The backend serves an MCP server at `http://localhost:3001/mcp` (Streamable
HTTP, local connections only). With Claude Code, add it once for all your
projects:

```sh
claude mcp add --scope user --transport http docent http://localhost:3001/mcp
```

Then set a reviewer on the panel to "Claude Code or any MCP agent" and start
it. After your usual review, tell your agent the sentence the panel shows
(it names the PR and the reviewer), and the findings are pinned on the code
as you read. You can also run `/mcp__docent__review owner/repo#123` to have
it review the PR, or `/mcp__docent__submit owner/repo#123` to send the
findings of a review already done in the session.

The agent reads the PR through `get_review_context`, `get_diff`, `read_file`
and `get_existing_comments`, and sends its findings with `submit_review`.
Other MCP-capable agents can connect to the same address.
