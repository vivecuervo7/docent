import { randomUUID } from "node:crypto";
import { fetchPrFiles, type PrFile } from "./github.js";
import { chatWithTool } from "./modelProvider.js";
import { inLane } from "./notes.js";
import { describeRanges, linesInDiff, numberedFileDiff } from "./prDiff.js";
import type { PrSummary, Slice } from "./types.js";

// The agent review of a PR: findings from either Docent's own reviewer or
// the reviewer's own agent, which submits them over MCP (see mcp.ts). Both
// land in the same place, which the browser checks in on and copies from,
// like review preparation. It lives in memory, as long as this process.

export interface Finding {
  id: string;
  path?: string;
  startLine?: number;
  endLine?: number;
  body: string;
  // For the reviewer deciding whether to keep it; never posted.
  rationale?: string;
}

export interface AgentReview {
  id: string;
  source: "builtin" | "external";
  status: "running" | "done" | "failed" | "stopped";
  // The built-in reviewer goes a slice at a time.
  progress?: { done: number; total: number; current?: string };
  findings: Finding[];
  error?: string;
}

// What the browser knows about the PR that GitHub doesn't: the slices and
// summary it prepared. Passed in when a review starts, and served to agents.
export interface ReviewContext {
  title?: string;
  summary?: PrSummary | null;
  slices?: Slice[] | null;
}

interface Entry {
  review: AgentReview;
  controller: AbortController;
}

const reviews = new Map<string, Entry>();
const contexts = new Map<string, ReviewContext>();

function keyFor(owner: string, repo: string, number: string): string {
  return `${owner}/${repo}/${number}`;
}

export function getAgentReview(owner: string, repo: string, number: string): AgentReview | null {
  return reviews.get(keyFor(owner, repo, number))?.review ?? null;
}

export function getReviewContext(owner: string, repo: string, number: string): ReviewContext {
  return contexts.get(keyFor(owner, repo, number)) ?? {};
}

function begin(owner: string, repo: string, number: string, source: AgentReview["source"], context: ReviewContext) {
  const key = keyFor(owner, repo, number);
  reviews.get(key)?.controller.abort();
  contexts.set(key, context);
  const entry: Entry = {
    review: { id: randomUUID(), source, status: "running", findings: [] },
    controller: new AbortController(),
  };
  reviews.set(key, entry);
  return entry;
}

// Waits for the reviewer's own agent to submit findings over MCP.
export function openExternalReview(owner: string, repo: string, number: string, context: ReviewContext) {
  return begin(owner, repo, number, "external", context).review;
}

export function finishAgentReview(owner: string, repo: string, number: string): AgentReview | null {
  const entry = reviews.get(keyFor(owner, repo, number));
  if (entry?.review.status === "running") entry.review.status = "done";
  return entry?.review ?? null;
}

export function stopAgentReview(owner: string, repo: string, number: string): AgentReview | null {
  const entry = reviews.get(keyFor(owner, repo, number));
  if (entry?.review.status === "running") {
    entry.review.status = "stopped";
    entry.controller.abort();
  }
  return entry?.review ?? null;
}

export function dismissAgentReview(owner: string, repo: string, number: string): void {
  const key = keyFor(owner, repo, number);
  if (reviews.get(key)?.review.status !== "running") reviews.delete(key);
}

export interface SubmittedFinding {
  path?: string;
  startLine?: number;
  endLine?: number;
  body: string;
  rationale?: string;
}

// Checks a finding against the PR and records it. Lines have to be in the
// diff, since that's all a review comment can sit on; the error says which
// lines are, so an agent can correct itself.
export async function submitFinding(
  owner: string,
  repo: string,
  number: string,
  finding: SubmittedFinding,
  files?: PrFile[],
): Promise<Finding> {
  const body = finding.body.trim();
  if (!body) throw new Error("A finding needs a body.");
  let { path, startLine, endLine } = finding;
  if (startLine !== undefined && endLine === undefined) endLine = startLine;
  if (path) {
    const file = (files ?? (await fetchPrFiles(owner, repo, number))).find((f) => f.filename === path);
    if (!file) throw new Error(`${path} isn't one of the files this PR changes.`);
    if (startLine !== undefined && endLine !== undefined) {
      if (endLine < startLine) [startLine, endLine] = [endLine, startLine];
      const commentable = linesInDiff(file);
      if (!commentable.has(startLine) || !commentable.has(endLine)) {
        throw new Error(
          `Lines ${startLine}-${endLine} of ${path} aren't in the diff. Lines in the diff: ${describeRanges(commentable)}. Leave the lines out to comment on the whole file.`,
        );
      }
    }
  } else {
    startLine = undefined;
    endLine = undefined;
  }

  const key = keyFor(owner, repo, number);
  // An agent can start submitting before anyone pressed Run in Docent.
  const entry =
    reviews.get(key)?.review.status === "running"
      ? reviews.get(key)!
      : begin(owner, repo, number, "external", contexts.get(key) ?? {});
  const rationale = finding.rationale?.trim() || undefined;
  const recorded: Finding = { id: randomUUID(), path, startLine, endLine, body, rationale };
  entry.review.findings.push(recorded);
  return recorded;
}

const REPORT_FINDINGS_TOOL = {
  name: "report_findings",
  description: "Report the problems found in this part of the pull request.",
  parameters: {
    type: "object",
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            start_line: { type: "integer" },
            end_line: { type: "integer" },
            body: { type: "string" },
            rationale: { type: "string" },
          },
          required: ["path", "start_line", "body", "rationale"],
        },
      },
    },
    required: ["findings"],
  },
};

const SYSTEM_PROMPT = `You are reviewing one part of a pull request, as a careful senior engineer. \
Report real problems in the changed code: bugs, missed cases, risky behaviour, unclear or \
misleading code, and meaningful simplifications. Report only things the author should change or \
answer - never an observation that the code is correct, and never a hedge like "ensure that" or \
"make sure". Leave out style preferences and anything you aren't reasonably sure of; reporting \
nothing is fine, and often right.
Each finding names the file and the new-file line numbers shown at the start of each diff line \
(start_line, and end_line if it spans several) - the few lines the point is actually about, not \
the whole block around them - and a body written to the author: a sentence or \
two, specific, with a suggestion where there is one. Start a minor point with "Nit: ", as \
reviewers do. The finding is shown on its lines, so don't mention line numbers in the body. Put \
code in backticks.
Also give a rationale, for the reviewer deciding whether to post it (the author never sees it): \
why it matters, what in the code shows it, and how sure you are - say so plainly if you're \
unsure, here rather than in the body. Two or three sentences.`;

function hunkIndicesByFile(slice: Slice): Map<string, number[]> {
  const byFile = new Map<string, number[]>();
  for (const ref of slice.hunks) {
    const at = ref.lastIndexOf("#");
    const path = ref.slice(0, at);
    byFile.set(path, [...(byFile.get(path) ?? []), Number(ref.slice(at + 1))]);
  }
  return byFile;
}

// Docent's own reviewer: one focused pass per slice with the configured
// model, rather than open-ended exploring, which a small local model does
// poorly. The passes share the interactive lane, so questions asked meanwhile
// only wait for a free turn, not the whole review.
export function startBuiltinReview(owner: string, repo: string, number: string, context: ReviewContext) {
  const entry = begin(owner, repo, number, "builtin", context);
  void runBuiltin(owner, repo, number, context, entry);
  return entry.review;
}

async function runBuiltin(owner: string, repo: string, number: string, context: ReviewContext, entry: Entry) {
  const { review, controller } = entry;
  const { signal } = controller;
  try {
    const files = await fetchPrFiles(owner, repo, number);
    const parts: { title: string; diff: string }[] =
      context.slices && context.slices.length > 0
        ? context.slices.map((slice) => ({
            title: slice.title,
            diff: [...hunkIndicesByFile(slice)]
              .map(([path, indices]) => {
                const file = files.find((f) => f.filename === path);
                return file ? numberedFileDiff(file, indices) : "";
              })
              .filter(Boolean)
              .join("\n\n"),
          }))
        : files.map((file) => ({ title: file.filename, diff: numberedFileDiff(file) }));

    review.progress = { done: 0, total: parts.length };
    const about = [
      context.title && `PR: ${context.title}`,
      context.summary && `What it does: ${context.summary.what}\nWhy: ${context.summary.why}`,
    ]
      .filter(Boolean)
      .join("\n");

    // Slices are reviewed side by side, as many at once as the model allows.
    await Promise.all(
      parts.map(async (part) => {
        const call = await inLane(async () => {
          signal.throwIfAborted();
          review.progress = { ...review.progress!, current: part.title };
          return chatWithTool(
            [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: `${about}\n\nThis part: ${part.title}\n\n${part.diff}` },
            ],
            REPORT_FINDINGS_TOOL,
            signal,
          );
        });
        if (review.status !== "running") return;
        const raw = (call.arguments as { findings?: unknown }).findings;
        for (const item of Array.isArray(raw) ? raw : []) {
          const { path, start_line, end_line, body, rationale } = (item ?? {}) as Record<string, unknown>;
          if (typeof body !== "string") continue;
          const finding: SubmittedFinding = {
            path: typeof path === "string" ? path : undefined,
            startLine: typeof start_line === "number" ? start_line : undefined,
            endLine: typeof end_line === "number" ? end_line : undefined,
            body,
            rationale: typeof rationale === "string" ? rationale : undefined,
          };
          try {
            await submitFinding(owner, repo, number, finding, files);
          } catch {
            // Lines outside the diff: keep the point, on the file as a whole.
            if (finding.path) {
              await submitFinding(owner, repo, number, { ...finding, startLine: undefined, endLine: undefined }, files).catch(() => {});
            }
          }
        }
        review.progress = { ...review.progress!, done: review.progress!.done + 1 };
      }),
    );
    if (review.status === "running") review.status = "done";
  } catch (err) {
    if (review.status === "running") {
      review.status = "failed";
      review.error = (err as Error).message;
    }
  }
}
