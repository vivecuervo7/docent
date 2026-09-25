import { randomUUID } from "node:crypto";
import { fetchPrFiles, type PrFile } from "./github.js";
import { chatWithTool } from "./modelProvider.js";
import { inLane } from "./notes.js";
import { describeRanges, linesInDiff, numberedFileDiff } from "./prDiff.js";
import { getRecord, keyFor } from "./store.js";
import type { PrSummary, Slice } from "./types.js";
import { runSession } from "./sessions.js";
import type { ExternalReviewer } from "./config.js";

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
  source: "builtin" | "external" | "session";
  // The model Docent's reviewer used.
  model?: string;
  status: "running" | "done" | "failed" | "stopped";
  // The built-in reviewer goes a slice at a time.
  progress?: { done: number; total: number; current?: string };
  findings: Finding[];
  error?: string;
  startedAt: number;
  endedAt?: number;
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

// A PR can have several reviewer entries - a panel - each with its own
// review. `agent-1` is the one every PR has.
export const DEFAULT_REVIEWER = "agent-1";
export const REVIEWER_RE = /^[a-z0-9-]{1,40}$/;

const reviews = new Map<string, Entry>();
const contexts = new Map<string, ReviewContext>();

function prKey(owner: string, repo: string, number: string): string {
  return `${owner}/${repo}/${number}`;
}

function reviewKey(owner: string, repo: string, number: string, reviewer: string): string {
  return `${prKey(owner, repo, number)}#${reviewer}`;
}

// The PR's reviewers as saved in its record, where the browser gives each a
// name ("Copper Eagle") alongside its id.
function savedReviewers(owner: string, repo: string, number: string): { id: string; name?: string }[] {
  const saved = getRecord(keyFor(owner, repo, number)).record.agentReviewers;
  return Array.isArray(saved) && saved.length ? (saved as { id: string; name?: string }[]) : [{ id: DEFAULT_REVIEWER }];
}

const sameName = (a: string, b: string) => a.toLowerCase().replace(/[\s_-]+/g, " ").trim() === b.toLowerCase().replace(/[\s_-]+/g, " ").trim();

// Which reviewer an agent's submission is for. A named one, by name or id;
// otherwise the one waiting for the reviewer's own agent, if there's exactly
// one, else the first. With several waiting there's no telling which agent
// this is, so it has to name one.
export function resolveReviewer(owner: string, repo: string, number: string, reviewer?: string): string {
  const saved = savedReviewers(owner, repo, number);
  const label = (id: string) => saved.find((r) => r.id === id)?.name ?? id;
  if (reviewer?.trim()) {
    const match = saved.find((r) => r.id === reviewer.trim() || (r.name && sameName(r.name, reviewer)));
    if (match) return match.id;
    if (REVIEWER_RE.test(reviewer.trim())) return reviewer.trim();
    throw new Error(`No reviewer called "${reviewer}" on this PR. Its reviewers: ${saved.map((r) => label(r.id)).join(", ")}.`);
  }
  const prefix = `${prKey(owner, repo, number)}#`;
  const waiting = [...reviews]
    .filter(([key, entry]) => key.startsWith(prefix) && entry.review.source === "external" && entry.review.status === "running")
    .map(([key]) => key.slice(prefix.length));
  if (waiting.length === 1) return waiting[0];
  if (waiting.length > 1) {
    throw new Error(
      `Several reviewers are waiting for findings on this PR (${waiting.map(label).join(", ")}). Ask the user which one this review is for, and pass it as \`reviewer\`.`,
    );
  }
  return DEFAULT_REVIEWER;
}

export function getAgentReview(owner: string, repo: string, number: string, reviewer = DEFAULT_REVIEWER): AgentReview | null {
  return reviews.get(reviewKey(owner, repo, number, reviewer))?.review ?? null;
}

export function getReviewContext(owner: string, repo: string, number: string): ReviewContext {
  return contexts.get(prKey(owner, repo, number)) ?? {};
}

function begin(
  owner: string,
  repo: string,
  number: string,
  reviewer: string,
  source: AgentReview["source"],
  context: ReviewContext | null,
  model?: string,
) {
  const key = reviewKey(owner, repo, number, reviewer);
  reviews.get(key)?.controller.abort();
  if (context) contexts.set(prKey(owner, repo, number), context);
  const entry: Entry = {
    review: { id: randomUUID(), source, model, status: "running", findings: [], startedAt: Date.now() },
    controller: new AbortController(),
  };
  reviews.set(key, entry);
  return entry;
}

// Runs one of the reviewer's external reviewers: a session of their own
// tooling. Its findings are held to the diff like any others, except that
// one whose lines aren't in it is kept as a comment on its file.
export function startSessionReview(
  owner: string,
  repo: string,
  number: string,
  context: ReviewContext,
  persona: ExternalReviewer,
  mcpUrl: string,
  reviewer = DEFAULT_REVIEWER,
) {
  const entry = begin(owner, repo, number, reviewer, "session", context, `session:${persona.id}`);
  void (async () => {
    const { review, controller } = entry;
    try {
      const [findings, files] = await Promise.all([
        runSession(persona, { owner, repo, number }, mcpUrl, controller.signal),
        fetchPrFiles(owner, repo, number),
      ]);
      for (const finding of findings) {
        try {
          review.findings.push(checkFinding(finding, files));
        } catch {
          const onFile = finding.path && files.some((f) => f.filename === finding.path);
          review.findings.push(checkFinding({ ...finding, path: onFile ? finding.path : undefined, startLine: undefined, endLine: undefined }, files));
        }
      }
      end(review, "done");
    } catch (err) {
      if (review.status === "running") {
        review.error = (err as Error).message;
        end(review, "failed");
      }
    }
  })();
  return entry.review;
}

// Waits for the reviewer's own agent to submit findings over MCP.
export function openExternalReview(owner: string, repo: string, number: string, context: ReviewContext, reviewer = DEFAULT_REVIEWER) {
  return begin(owner, repo, number, reviewer, "external", context).review;
}

// Ends a running review, noting when.
function end(review: AgentReview, status: "done" | "failed" | "stopped") {
  if (review.status !== "running") return;
  review.status = status;
  review.endedAt = Date.now();
}

// Every review running or not yet collected, for the start page and the
// panel's summary.
export function listAgentReviews() {
  return [...reviews.entries()].map(([key, { review }]) => {
    const [pr, reviewer] = key.split("#");
    const [owner, repo, number] = pr.split("/");
    const { findings, ...rest } = review;
    return { owner, repo, number, reviewer, ...rest, findings: findings.length };
  });
}

export function finishAgentReview(owner: string, repo: string, number: string, reviewer = DEFAULT_REVIEWER): AgentReview | null {
  const entry = reviews.get(reviewKey(owner, repo, number, reviewer));
  if (entry) end(entry.review, "done");
  return entry?.review ?? null;
}

export function stopAgentReview(owner: string, repo: string, number: string, reviewer = DEFAULT_REVIEWER): AgentReview | null {
  const entry = reviews.get(reviewKey(owner, repo, number, reviewer));
  if (entry?.review.status === "running") {
    end(entry.review, "stopped");
    entry.controller.abort();
  }
  return entry?.review ?? null;
}

// Forgets a finished review. With `force`, stops a running one first - for a
// reviewer entry being removed.
export function dismissAgentReview(owner: string, repo: string, number: string, reviewer = DEFAULT_REVIEWER, force = false): void {
  const key = reviewKey(owner, repo, number, reviewer);
  if (force) stopAgentReview(owner, repo, number, reviewer);
  if (reviews.get(key)?.review.status !== "running") reviews.delete(key);
}

export interface SubmittedFinding {
  path?: string;
  startLine?: number;
  endLine?: number;
  body: string;
  rationale?: string;
}

// Checks a finding against the PR's files. Lines have to be in the diff,
// since that's all a review comment can sit on; the error says which lines
// are, so an agent can correct itself.
function checkFinding(finding: SubmittedFinding, files: PrFile[]): Finding {
  const body = finding.body.trim();
  if (!body) throw new Error("A finding needs a body.");
  let { path, startLine, endLine } = finding;
  if (startLine !== undefined && endLine === undefined) endLine = startLine;
  if (path) {
    const file = files.find((f) => f.filename === path);
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
  return { id: randomUUID(), path, startLine, endLine, body, rationale: finding.rationale?.trim() || undefined };
}

// The review findings are going into: the reviewer's running one, or a new
// one, since an agent can start submitting before anyone pressed Run in Docent.
function openReview(owner: string, repo: string, number: string, reviewer: string): Entry {
  const entry = reviews.get(reviewKey(owner, repo, number, reviewer));
  return entry?.review.status === "running" ? entry : begin(owner, repo, number, reviewer, "external", null);
}

// Records one finding, for agents that report as they go.
export async function submitFinding(
  owner: string,
  repo: string,
  number: string,
  finding: SubmittedFinding,
  files?: PrFile[],
  reviewer = DEFAULT_REVIEWER,
): Promise<Finding> {
  const recorded = checkFinding(finding, files ?? (await fetchPrFiles(owner, repo, number)));
  openReview(owner, repo, number, reviewer).review.findings.push(recorded);
  return recorded;
}

// Records a whole review at once, and finishes it. Every finding is checked
// first: if any is wrong, nothing is recorded and the error covers them all,
// so the agent can fix them and send the review again.
export async function submitReview(
  owner: string,
  repo: string,
  number: string,
  findings: SubmittedFinding[],
  reviewer: string,
): Promise<AgentReview> {
  const files = await fetchPrFiles(owner, repo, number);
  const checked: Finding[] = [];
  const problems: string[] = [];
  findings.forEach((finding, i) => {
    try {
      checked.push(checkFinding(finding, files));
    } catch (err) {
      problems.push(`Finding ${i + 1}: ${(err as Error).message}`);
    }
  });
  if (problems.length) {
    throw new Error(`Nothing was recorded. Fix these, then send the whole review again:\n${problems.join("\n")}`);
  }
  const entry = openReview(owner, repo, number, reviewer);
  entry.review.findings.push(...checked);
  end(entry.review, "done");
  return entry.review;
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
// `focus` is a persona's instructions: what this reviewer looks for.
export function startBuiltinReview(
  owner: string,
  repo: string,
  number: string,
  context: ReviewContext,
  reviewer = DEFAULT_REVIEWER,
  model?: string,
  focus?: string,
) {
  const entry = begin(owner, repo, number, reviewer, "builtin", context, model);
  void runBuiltin(owner, repo, number, context, entry, reviewer, model, focus);
  return entry.review;
}

async function runBuiltin(
  owner: string,
  repo: string,
  number: string,
  context: ReviewContext,
  entry: Entry,
  reviewer: string,
  model?: string,
  focus?: string,
) {
  const { review, controller } = entry;
  const system = focus
    ? `${SYSTEM_PROMPT}\n\nThis review has a particular focus, and raises only what falls within it:\n${focus}`
    : SYSTEM_PROMPT;
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
              { role: "system", content: system },
              { role: "user", content: `${about}\n\nThis part: ${part.title}\n\n${part.diff}` },
            ],
            REPORT_FINDINGS_TOOL,
            signal,
            model,
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
            await submitFinding(owner, repo, number, finding, files, reviewer);
          } catch {
            // Lines outside the diff: keep the point, on the file as a whole.
            if (finding.path) {
              await submitFinding(owner, repo, number, { ...finding, startLine: undefined, endLine: undefined }, files, reviewer).catch(() => {});
            }
          }
        }
        review.progress = { ...review.progress!, done: review.progress!.done + 1 };
      }),
    );
    end(review, "done");
  } catch (err) {
    if (review.status === "running") {
      review.error = (err as Error).message;
      end(review, "failed");
    }
  }
}
