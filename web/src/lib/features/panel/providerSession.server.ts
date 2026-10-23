import { codeContext } from "./codeContext.server.js";
import { FINDINGS_SCHEMA, fillCommand, toFindings, verdictOf, type SessionResult } from "./externalSessions.server.js";
import { fetchReviewFiles, rangeNote } from "../../github/range.server.js";
import { numberedFileDiff, WHOLE_DIFF_LIMIT } from "../../github/prDiff.server.js";
import { inLane } from "../../models/lanes.server.js";
import { chatWithTool } from "../../models/modelProvider.server.js";
import { providers, type ExternalReviewer } from "../../storage/settings.server.js";
import type { ReviewContext } from "./agentReviews.server.js";

// An external reviewer that runs on one of a provider's models: its prompt
// goes in as the system message, followed only by how to report, and the
// pull request - summary, whole diff, and what Docent looked up about the code
// around it - as the message. There's no session, so no tools; Docent's own
// reviewing instructions aren't part of it.

const REPORT_FINDINGS = {
  name: "report_findings",
  description: "Report the review's findings, and its overall recommendation if it makes one.",
  parameters: FINDINGS_SCHEMA,
};

function handback(): string {
  return `This runs unattended inside Docent, a pull request review tool. There are no tools and no \
checkout: the pull request is in the message that follows - its title and summary, its whole diff with \
the new file's line number at the start of each line, and what Docent looked up about the code around \
it. Report the review through report_findings: for each finding, its file path and new-file lines, \
the comment for the author, and why it was raised - and, if the review ends with an overall \
recommendation (approve, request changes, or just comment), that too, with why. If the review set \
findings aside - pushed back on them, or filtered them out of what it would post - hand those back \
too, each with why it was set aside; Docent's editor makes the final call on them. Leave out \
positive observations. Nobody is here to answer questions, and nothing is posted to GitHub.`;
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
  if (diff.length > WHOLE_DIFF_LIMIT) {
    throw new Error(`The diff is ${diff.length.toLocaleString()} characters, more than the ${WHOLE_DIFF_LIMIT.toLocaleString()} that can be sent to a model whole.`);
  }
  const facts = await codeContext(pr.owner, pr.repo, pr.number, mcpUrl, pr.round);
  signal.throwIfAborted();

  const about = [
    context.title && `PR: ${context.title}`,
    context.summary && `What it does: ${context.summary.what}\nWhy: ${context.summary.why}`,
    rangeNote(pr.owner, pr.repo, pr.number, pr.round),
  ]
    .filter(Boolean)
    .join("\n");
  const aroundIt = facts ? `\n\nWhat the code around the PR shows, looked up for this review - trust it over guesses about code the diff doesn't show:\n${facts}` : "";

  const call = await inLane(
    () =>
      chatWithTool(
        [
          { role: "system", content: `${fillCommand(reviewer.command, pr)}\n\n${handback()}` },
          { role: "user", content: `${about}${aroundIt}\n\nThe whole diff:\n\n${diff}` },
        ],
        REPORT_FINDINGS,
        signal,
        model,
      ),
    model,
  );
  const answer = call.arguments as { findings?: unknown };
  if (!Array.isArray(answer?.findings)) throw new Error("It finished without handing its findings back.");
  return { findings: toFindings(answer.findings), verdict: verdictOf(answer) };
}
