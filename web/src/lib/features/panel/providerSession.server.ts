import { codeContext } from "./codeContext.server.js";
import { ALWAYS_ALLOWED, FINDINGS_SCHEMA, fillCommand, toFindings, verdictOf, type SessionResult } from "./externalSessions.server.js";
import { fetchReviewFiles, rangeNote } from "../../github/range.server.js";
import { numberedFileDiff, WHOLE_DIFF_LIMIT } from "../../github/prDiff.server.js";
import { inLane } from "../../models/lanes.server.js";
import { chatWithTool } from "../../models/modelProvider.server.js";
import { prRef } from "../../storage/rounds.server.js";
import { providers, type ExternalReviewer } from "../../storage/settings.server.js";
import type { ReviewContext } from "./agentReviews.server.js";

// An external reviewer that runs on one of a provider's models: its prompt
// goes in as the system message, followed only by how to report, and the
// pull request - summary, whole diff, and what Docent looked up about the code
// around it - as the message. It can look further through Docent's read
// tools, in a loop Docent runs; Docent's own reviewing instructions aren't
// part of it.

// The read tools a session on Claude Code or Codex is approved for.
const LOOK_TOOLS = ALWAYS_ALLOWED.filter((t) => t.startsWith("mcp__docent__")).map((t) => t.slice("mcp__docent__".length));

const REPORT_FINDINGS = {
  name: "report_findings",
  description: "Report the review's findings, and its overall recommendation if it makes one.",
  parameters: FINDINGS_SCHEMA,
};

function handback(pr: string): string {
  return `This runs unattended inside Docent, a pull request review tool. There's no checkout: the pull \
request is in the message that follows - its title and summary, its diff with the new file's line \
number at the start of each line (a diff too large to send is listed by file, to read with get_diff), and \
what Docent looked up about the code around it. To check anything \
the diff doesn't show before raising it, use Docent's tools (get_diff, read_file, list_files, search_code, \
get_existing_comments), passing the pull request as ${pr}. Report the review through report_findings: for each finding, its file path and new-file lines, \
the comment for the author, and why it was raised - and, if the review ends with an overall \
recommendation (approve, request changes, or just comment), that too, with why. If the review set \
findings aside - pushed back on them, or filtered them out of what it would post - hand those back \
too, each with why it was set aside; Docent's editor makes the final call on them. Leave out \
positive observations. Nobody is here to answer questions, and nothing is posted to GitHub.`;
}

// What a model sent in place of the findings, for the error saying it didn't.
function excerpt(sent: unknown): string {
  const text = typeof sent === "string" ? sent : (JSON.stringify(sent) ?? String(sent));
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

export async function runProviderSession(
  reviewer: ExternalReviewer,
  pr: { owner: string; repo: string; number: string; round?: number },
  context: ReviewContext,
  mcpUrl: string,
  signal: AbortSignal,
): Promise<SessionResult> {
  const provider = providers().find((p) => p.id === reviewer.provider);
  if (!provider) throw new Error("That reviewer's provider isn't set up any more.");
  if (!reviewer.model) throw new Error("That reviewer has no model chosen.");
  const model = `${provider.id}:${reviewer.model}`;

  const files = await fetchReviewFiles(pr.owner, pr.repo, pr.number, pr.round);
  const diff = files.map((f) => numberedFileDiff(f)).join("\n\n");
  const facts = await codeContext(pr.owner, pr.repo, pr.number, mcpUrl, pr.round);
  signal.throwIfAborted();

  const about = [
    context.title && `PR: ${context.title}`,
    context.summary && `What it does: ${context.summary.what}\nWhy: ${context.summary.why}`,
    rangeNote(pr.owner, pr.repo, pr.number, pr.round),
  ]
    .filter(Boolean)
    .join("\n");
  // A diff too big to send whole is listed by file, for the model to read with get_diff.
  const shown =
    diff.length <= WHOLE_DIFF_LIMIT
      ? `The whole diff:\n\n${diff}`
      : `The diff is ${diff.length.toLocaleString()} characters, too much to send whole. The files it changes (read their diffs with get_diff):\n${files.map((f) => f.filename).join("\n")}`;
  const aroundIt = facts ? `\n\nWhat the code around the PR shows, looked up for this review - trust it over guesses about code the diff doesn't show:\n${facts}` : "";

  const call = await inLane(
    () =>
      chatWithTool(
        [
          { role: "system", content: `${fillCommand(reviewer.command, pr)}\n\n${handback(prRef(pr.owner, pr.repo, pr.number, pr.round))}` },
          { role: "user", content: `${about}${aroundIt}\n\n${shown}` },
        ],
        REPORT_FINDINGS,
        signal,
        model,
        { mcpUrl, tools: LOOK_TOOLS },
      ),
    model,
  );
  const answer = call.arguments as { findings?: unknown };
  if (!Array.isArray(answer?.findings)) throw new Error(`It finished without handing its findings back. It sent: ${excerpt(call.arguments)}`);
  return { findings: toFindings(answer.findings), verdict: verdictOf(answer) };
}
