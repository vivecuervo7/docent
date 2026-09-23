import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fetchPrConversation, fetchPrFiles, type PrConversation } from "./github.js";
import { chatWithTool } from "./modelProvider.js";
import { inLane } from "./notes.js";
import { commentableLines } from "./prDiff.js";

const execFileAsync = promisify(execFile);

// The last step: combining the comments the reviewer kept into one review,
// then posting it. Preparing uses the model; posting doesn't.

export function conversationText(conversation: PrConversation): string {
  const parts = [
    ...conversation.reviews.filter((r) => r.body).map((r) => `Review by ${r.author} (${r.state}):\n${r.body}`),
    ...conversation.comments.map((c) => `Comment by ${c.author}:\n${c.body}`),
    ...conversation.threads.map((t) => `Thread on ${t.path}:\n${t.entries.map((e) => `${e.author}: ${e.body}`).join("\n")}`),
  ];
  return parts.length > 0 ? parts.join("\n\n") : "Nothing's been said on this PR yet.";
}

export interface Candidate {
  id: string;
  source: "yours" | "agent";
  location: string;
  body: string;
}

export interface PreparedComment {
  from: string[];
  body: string;
}

export interface DroppedComment {
  from: string[];
  reason: string;
}

export interface PreparedReview {
  comments: PreparedComment[];
  dropped: DroppedComment[];
  summary: string;
}

const REPORT_REVIEW_TOOL = {
  name: "report_review",
  description: "Report the review to post.",
  parameters: {
    type: "object",
    properties: {
      comments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            from: { type: "array", items: { type: "string" }, description: "Ids of the candidates it covers." },
            body: { type: "string" },
          },
          required: ["from", "body"],
        },
      },
      dropped: {
        type: "array",
        items: {
          type: "object",
          properties: {
            from: { type: "array", items: { type: "string" } },
            reason: { type: "string", description: "Who already raised it, or why it's left out." },
          },
          required: ["from", "reason"],
        },
      },
      summary: { type: "string" },
    },
    required: ["comments", "dropped", "summary"],
  },
};

const SYSTEM_PROMPT = `You are preparing a code review to post on a pull request. You get the \
candidate comments the reviewer has already chosen to post - some they drafted, some from an \
automated review - and everything already said on the PR. Whether each is worth posting is \
decided: keep them all, however minor, except in the two cases below.
- Merge candidates that make the same point about the same code into one comment, keeping the \
clearest wording.
- Drop a candidate only when its point has already been made in the existing conversation, and \
say who made it. Only drop it if the point really is the same.
Keep every other candidate exactly as written.
Every candidate id goes in exactly one comment's "from", or in "dropped".
Also write a summary for the top of the review: one to three sentences, as the reviewer, about \
the PR overall and what the comments add up to. No headings, and don't list the comments.`;

export function prepareReview(
  owner: string,
  repo: string,
  number: string,
  candidates: Candidate[],
  signal: AbortSignal,
): Promise<PreparedReview> {
  return inLane(async () => {
    signal.throwIfAborted();
    const conversation = await fetchPrConversation(owner, repo, number);
    const listed = candidates
      .map(
        (c) =>
          `Candidate ${c.id} (${c.source === "yours" ? "the reviewer's" : "automated review"}, ${c.location}):\n${c.body}`,
      )
      .join("\n\n");
    const call = await chatWithTool(
      [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Candidate comments:\n\n${listed}\n\nAlready said on the PR:\n\n${conversationText(conversation)}`,
        },
      ],
      REPORT_REVIEW_TOOL,
      signal,
    );
    return settle(candidates, call.arguments as Record<string, unknown>);
  });
}

// Holds the model to its instructions: unknown ids are ignored, a candidate
// can only be used once, and any it didn't mention are kept as they were -
// nothing the reviewer ticked disappears without a reason shown.
function settle(candidates: Candidate[], raw: Record<string, unknown>): PreparedReview {
  const known = new Set(candidates.map((c) => c.id));
  const used = new Set<string>();
  const take = (ids: unknown): string[] =>
    (Array.isArray(ids) ? ids : []).filter((id): id is string => typeof id === "string" && known.has(id) && !used.has(id)).map((id) => {
      used.add(id);
      return id;
    });

  const comments: PreparedComment[] = [];
  for (const entry of Array.isArray(raw.comments) ? raw.comments : []) {
    const { from, body } = (entry ?? {}) as { from?: unknown; body?: unknown };
    const ids = take(from);
    if (ids.length > 0 && typeof body === "string" && body.trim()) comments.push({ from: ids, body: body.trim() });
    else ids.forEach((id) => used.delete(id));
  }
  const dropped: DroppedComment[] = [];
  for (const entry of Array.isArray(raw.dropped) ? raw.dropped : []) {
    const { from, reason } = (entry ?? {}) as { from?: unknown; reason?: unknown };
    const ids = take(from);
    if (ids.length > 0) dropped.push({ from: ids, reason: typeof reason === "string" && reason.trim() ? reason.trim() : "Left out." });
  }
  for (const candidate of candidates) {
    if (!used.has(candidate.id)) comments.push({ from: [candidate.id], body: candidate.body });
  }
  return { comments, dropped, summary: typeof raw.summary === "string" ? raw.summary.trim() : "" };
}

export async function fetchViewer(): Promise<string> {
  const { stdout } = await execFileAsync("gh", ["api", "user", "--jq", ".login"]);
  return stdout.trim();
}

export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

export interface CommentToPost {
  body: string;
  path?: string;
  start?: { side: "old" | "new"; line: number };
  end?: { side: "old" | "new"; line: number };
}

interface InlineComment {
  path: string;
  body: string;
  line: number;
  side: "LEFT" | "RIGHT";
  start_line?: number;
  start_side?: "LEFT" | "RIGHT";
}

export interface ReviewPayload {
  event: ReviewEvent;
  body: string;
  comments: InlineComment[];
}

const githubSide = (side: "old" | "new") => (side === "old" ? "LEFT" : "RIGHT");

function describeLocation(comment: CommentToPost): string {
  if (!comment.path) return "";
  if (!comment.start || !comment.end) return `**\`${comment.path}\`:** `;
  const lines =
    comment.start.line === comment.end.line ? `line ${comment.start.line}` : `lines ${comment.start.line}-${comment.end.line}`;
  return `**\`${comment.path}\`, ${lines}:** `;
}

// Builds exactly what gets sent. Comments on lines in the diff go inline;
// the rest - on expanded lines, a whole file, or the PR as a whole - go in
// the review's text after the summary, since GitHub can only attach inline
// comments to lines in the diff.
export async function buildReviewPayload(
  owner: string,
  repo: string,
  number: string,
  event: ReviewEvent,
  summary: string,
  comments: CommentToPost[],
): Promise<ReviewPayload> {
  const files = await fetchPrFiles(owner, repo, number);
  const inline: InlineComment[] = [];
  const inBody: string[] = [];
  for (const comment of comments) {
    const file = comment.path ? files.find((f) => f.filename === comment.path) : undefined;
    const { start, end } = comment;
    if (file && start && end) {
      const lines = commentableLines(file);
      if (lines[start.side].has(start.line) && lines[end.side].has(end.line)) {
        const single = start.side === end.side && start.line === end.line;
        inline.push({
          path: file.filename,
          body: comment.body,
          line: end.line,
          side: githubSide(end.side),
          ...(single ? {} : { start_line: start.line, start_side: githubSide(start.side) }),
        });
        continue;
      }
    }
    inBody.push(`${describeLocation(comment)}${comment.body}`);
  }
  const body = [summary.trim(), ...inBody].filter(Boolean).join("\n\n");
  return { event, body, comments: inline };
}

export async function postReviewPayload(
  owner: string,
  repo: string,
  number: string,
  payload: ReviewPayload,
): Promise<{ url: string }> {
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn("gh", [
      "api",
      "--method",
      "POST",
      `repos/${owner}/${repo}/pulls/${number}/reviews`,
      "--input",
      "-",
    ]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || stdout.trim() || `gh exited with ${code}`))));
    child.stdin.end(JSON.stringify(payload));
  });
  const { html_url } = JSON.parse(output) as { html_url?: string };
  return { url: html_url ?? `https://github.com/${owner}/${repo}/pull/${number}` };
}
