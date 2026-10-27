import { randomUUID } from "node:crypto";
import { type PrFile } from "../../github/github.server.js";
import { describeRanges, linesInDiff } from "../../github/prDiff.server.js";
import { allReviewers, changeRound, prRef, roundOf } from "../../storage/rounds.server.js";
import { editRound } from "./editorRuns.server.js";
import { knownMcpUrl } from "../../api/mcpUrl.server.js";
import { SEVERITIES, type AgentFinding, type AgentReview as SharedAgentReview, type PrSummary, type Severity, type Slice } from "../../types.js";
import { runSession } from "./externalSessions.server.js";
import { runBuiltin } from "./builtinReviewer.server.js";
import { runProviderSession } from "./providerSession.server.js";
import { emptyUsage, usageScope, type Usage } from "../../models/usage.server.js";
import type { ExternalReviewer } from "../../storage/settings.server.js";
import { persistent } from "../../storage/persistent.server.js";
import { keyFor } from "../../storage/store.server.js";
import { fetchReviewFiles } from "../../github/range.server.js";

// The agent review of a PR: findings from either Docent's own reviewer or
// the reviewer's own agent, which submits them over MCP (see mcp/mcp.server.ts). Both
// land in the same place, which the browser checks in on and copies from,
// like review preparation. It lives in memory, as long as this process.

// A finding's severity as given, or as its body starts ("Nit: ...").
export function severityOf(raw: unknown, body: string): Severity | undefined {
  if (typeof raw === "string" && (SEVERITIES as readonly string[]).includes(raw.toLowerCase())) return raw.toLowerCase() as Severity;
  const lead = body.trim().match(/^\**(blocker|major|minor|nit)\**\s*[:-]/i)?.[1];
  return lead ? (lead.toLowerCase() as Severity) : undefined;
}

// As the page has it, with the tokens it took where the model says.
export interface AgentReview extends SharedAgentReview {
  usage?: Usage;
}

// What Docent knows about the PR that GitHub doesn't: the slices and summary
// it prepared, read from the round when a review starts and served to agents.
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

const reviews = persistent("agent-reviews", () => new Map<string, Entry>());
// How each review saves itself into the PR's record.
const savers = persistent("agent-reviews.savers", () => new WeakMap<AgentReview, () => void>());
const contexts = persistent("agent-review.contexts", () => new Map<string, ReviewContext>());

function reviewKey(owner: string, repo: string, number: string, reviewer: string): string {
  return `${keyFor(owner, repo, number)}#${reviewer}`;
}

// The PR's reviewers as saved in its record, in every round, where the
// browser gives each a name ("Copper Eagle") alongside its id.
function savedReviewers(owner: string, repo: string, number: string): { id: string; name?: string }[] {
  const saved = allReviewers(owner, repo, number);
  return saved.length ? saved : [{ id: DEFAULT_REVIEWER }];
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
  const prefix = `${keyFor(owner, repo, number)}#`;
  const waiting = [...reviews]
    .filter(([key, entry]) => key.startsWith(prefix) && entry.review.source === "external" && entry.review.status === "running")
    .map(([key]) => key.slice(prefix.length));
  if (waiting.length === 1) return waiting[0];
  if (waiting.length > 1) {
    throw new Error(
      `Several reviewers are waiting for findings on this PR (${waiting.map(label).join(", ")}). Ask the user which one this review is for, and pass it as \`reviewer\`.`,
    );
  }
  // Else the panel's first reviewer, whichever that is now any can be removed.
  return saved[0].id;
}

export function getAgentReview(owner: string, repo: string, number: string, reviewer = DEFAULT_REVIEWER): AgentReview | null {
  return reviews.get(reviewKey(owner, repo, number, reviewer))?.review ?? null;
}

// Per round, as each has its own slices and summary.
export function getReviewContext(owner: string, repo: string, number: string, round?: number): ReviewContext {
  return contexts.get(prRef(owner, repo, number, round)) ?? {};
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
  if (context) contexts.set(prRef(owner, repo, number, roundOf(owner, repo, number, reviewer)), context);
  const entry: Entry = {
    review: { id: randomUUID(), source, model, status: "running", findings: [], startedAt: Date.now() },
    controller: new AbortController(),
  };
  reviews.set(key, entry);
  savers.set(entry.review, () => saveReview(owner, repo, number, reviewer, entry.review));
  return entry;
}

// Saves a review into its round of the PR's record as it goes - its
// findings, keeping whatever's been done with one already there, and how the
// run went - so they land whether or not a page is open. A reviewer taken
// off the panel isn't put back.
function saveReview(owner: string, repo: string, number: string, reviewer: string, review: AgentReview) {
  const round = roundOf(owner, repo, number, reviewer);
  try {
    changeRound(owner, repo, number, round, (record) => {
      // A record from before panels were saved has the one first reviewer.
      const panel = (record.agentReviewers ?? [{ id: DEFAULT_REVIEWER }]) as { id: string; lastRun?: unknown }[];
      if (!panel.some((a) => a.id === reviewer)) return;
      const feedback = (record.feedback ?? {}) as Record<string, { items: Record<string, unknown>[]; draftedAt: number } | undefined>;
      const before = new Map((feedback[reviewer]?.items ?? []).map((i) => [i.id, i]));
      feedback[reviewer] = {
        items: review.findings.map((f) => ({
          included: true,
          // The editor's correction, kept over the reviewer's.
          ...(f.severity ? { severity: f.severity } : {}),
          ...(f.setAside ? { setAside: f.setAside } : {}),
          ...before.get(f.id),
          id: f.id,
          body: f.body,
          rationale: f.rationale,
          path: f.path,
          ...(f.slice ? { slice: f.slice } : {}),
          ...(f.startLine ? { start: { side: "new", line: f.startLine }, end: { side: "new", line: f.endLine ?? f.startLine } } : {}),
        })),
        draftedAt: Date.now(),
      };
      record.feedback = feedback;
      const lastRun = {
        startedAt: review.startedAt,
        endedAt: review.endedAt,
        status: review.status,
        findings: review.findings.length,
        ...(review.error ? { error: review.error } : {}),
        ...(review.verdict ? { verdict: review.verdict } : {}),
      };
      record.agentReviewers = panel.map((a) => (a.id === reviewer ? { ...a, lastRun } : a));
    });
  } catch (err) {
    console.error(`[agent-review] couldn't save ${owner}/${repo}#${number} ${reviewer}: ${(err as Error).message}`);
    return;
  }
  // Then the editor, over whatever of the round's findings is ready for it.
  void editRound(owner, repo, number, round, knownMcpUrl());
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
  const round = roundOf(owner, repo, number, reviewer);
  void (async () => {
    const { review, controller } = entry;
    try {
      const pr = { owner, repo, number, round };
      const [{ findings, verdict }, files] = await Promise.all([
        persona.runner === "provider"
          ? runProviderSession(persona, pr, context, mcpUrl, controller.signal)
          : runSession(persona, pr, mcpUrl, controller.signal),
        fetchReviewFiles(owner, repo, number, round),
      ]);
      if (verdict) review.verdict = verdict;
      for (const finding of findings) {
        try {
          review.findings.push(checkFinding(finding, files));
          savers.get(review)?.();
        } catch {
          const onFile = finding.path && files.some((f) => f.filename === finding.path);
          review.findings.push(checkFinding({ ...finding, path: onFile ? finding.path : undefined, startLine: undefined, endLine: undefined }, files));
          savers.get(review)?.();
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
  savers.get(review)?.();
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
  severity?: string;
  setAside?: string;
}

// Checks a finding against the PR's files. Lines have to be in the diff,
// since that's all a review comment can sit on; the error says which lines
// are, so an agent can correct itself.
function checkFinding(finding: SubmittedFinding, files: PrFile[]): AgentFinding {
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
  const severity = severityOf(finding.severity, body);
  return { id: randomUUID(), path, startLine, endLine, body, rationale: finding.rationale?.trim() || undefined, ...(severity ? { severity } : {}), ...(finding.setAside?.trim() ? { setAside: finding.setAside.trim() } : {}) };
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
  slice?: string,
): Promise<AgentFinding> {
  const recorded = {
    ...checkFinding(finding, files ?? (await fetchReviewFiles(owner, repo, number, roundOf(owner, repo, number, reviewer)))),
    ...(slice ? { slice } : {}),
  };
  const { review } = openReview(owner, repo, number, reviewer);
  review.findings.push(recorded);
  savers.get(review)?.();
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
  const files = await fetchReviewFiles(owner, repo, number, roundOf(owner, repo, number, reviewer));
  const checked: AgentFinding[] = [];
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
  model: string | undefined,
  focus: string | undefined,
  mcpUrl: string,
) {
  const entry = begin(owner, repo, number, reviewer, "builtin", context, model);
  entry.review.usage = emptyUsage();
  void usageScope.run(entry.review.usage, () => runBuiltin(owner, repo, number, context, entry, reviewer, model, focus, mcpUrl, { submit: submitFinding, end }));
  return entry.review;
}

