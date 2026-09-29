import { randomUUID } from "node:crypto";
import { codeContext } from "./codeContext.server.js";
import { fetchPrConversation, fetchPrFiles, type PrFile } from "../../github/github.server.js";
import { chatWithTool } from "../../models/modelProvider.server.js";
import { conversationText } from "../posting/postReview.server.js";
import { inLane } from "../reading/threadReplies.server.js";
import { describeRanges, hunkIndicesByFile, linesInDiff, numberedFileDiff } from "../../github/prDiff.server.js";
import { getRecord, keyFor } from "../../storage/store.server.js";
import type { PrSummary, Slice } from "../../types.server.js";
import { runSession } from "./externalSessions.server.js";
import { emptyUsage, usageScope, type Usage } from "../../models/usage.server.js";
import type { ExternalReviewer } from "../../storage/settings.server.js";
import { persistent } from "../../storage/persistent.server.js";

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
  severity?: Severity;
  // Why the reviewer's own process set it aside (pushed back on, filtered),
  // when it handed it back anyway for Docent's editor to judge.
  setAside?: string;
  // The slice the built-in reviewer found it in; none from the whole-PR pass.
  slice?: string;
}

// How much a finding matters, lowest last. "When unsure, the lower one."
export const SEVERITIES = ["blocker", "major", "minor", "nit"] as const;
export type Severity = (typeof SEVERITIES)[number];

// A finding's severity as given, or as its body starts ("Nit: ...").
export function severityOf(raw: unknown, body: string): Severity | undefined {
  if (typeof raw === "string" && (SEVERITIES as readonly string[]).includes(raw.toLowerCase())) return raw.toLowerCase() as Severity;
  const lead = body.trim().match(/^\**(blocker|major|minor|nit)\**\s*[:-]/i)?.[1];
  return lead ? (lead.toLowerCase() as Severity) : undefined;
}

export interface AgentReview {
  id: string;
  source: "builtin" | "external" | "session";
  // The model Docent's reviewer used.
  model?: string;
  status: "running" | "done" | "failed" | "stopped";
  // The built-in reviewer goes a slice at a time.
  // `waiting` while its next call is queued behind others; `finished`, the
  // slices it's done with.
  progress?: { done: number; total: number; current?: string; waiting?: boolean; finished?: string[] };
  findings: Finding[];
  error?: string;
  startedAt: number;
  endedAt?: number;
  // Token use over the review, where the model reports it (Claude Code).
  usage?: Usage;
  // An external reviewer's overall recommendation, when it makes one.
  verdict?: { event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT"; reason?: string };
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

const reviews = persistent("agent-reviews", () => new Map<string, Entry>());
const contexts = persistent("agent-review.contexts", () => new Map<string, ReviewContext>());

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
      const [{ findings, verdict }, files] = await Promise.all([
        runSession(persona, { owner, repo, number }, mcpUrl, controller.signal),
        fetchPrFiles(owner, repo, number),
      ]);
      if (verdict) review.verdict = verdict;
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
  severity?: string;
  setAside?: string;
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
): Promise<Finding> {
  const recorded = { ...checkFinding(finding, files ?? (await fetchPrFiles(owner, repo, number))), ...(slice ? { slice } : {}) };
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
            severity: { type: "string", enum: [...SEVERITIES] },
            body: { type: "string" },
            rationale: { type: "string" },
          },
          required: ["path", "start_line", "severity", "body", "rationale"],
        },
      },
    },
    required: ["findings"],
  },
};

const SYSTEM_PROMPT = `You are reviewing a pull request - all of it, or one part - as a careful senior engineer, \
reporting the problems its author would want to know about and fix. Reporting nothing is fine, and \
often right.

Raise a finding only when all of these hold:
1. The change introduced it. A problem the code already had, in the same form, isn't this PR's to fix.
2. It has a concrete cost: you can say what breaks or goes wrong, for whom, and when - or it makes \
the code materially harder to change safely, with the situation where that bites.
3. You can point at the code it affects. That something elsewhere might be disturbed isn't enough; \
name the code that is.
4. It rests on what the code shows, not on guesses about code you haven't seen or the author's \
intent. Where you're given facts about the code around the change, trust them over guesses.
5. Fixing it asks for no more rigour than the rest of the codebase shows.
6. It isn't plainly deliberate.
7. The author would likely fix it once told.
A missing test is worth raising when the code looks right but a likely mistake in it would go \
unnoticed, or when a test would still pass with the code wrong. A test for a problem you're \
already raising belongs in that finding's fix, not in a finding of its own.
A risk to later changes counts when the PR already pays for it: a comment or doc it has made \
wrong, logic that has already drifted apart, a name that already misleads.
Leave out style preferences, "worth considering" design remarks, and what a linter, type checker or \
the build would catch. Don't ask for comments that restate what the code does; a comment the change \
has made wrong is worth raising. Never report that code is correct, and never hedge with "ensure \
that" or "make sure".

Give each finding a severity, choosing the lower one when unsure:
- blocker: ships broken behaviour - a crash, data loss, a security hole, broken build or tests, or a \
stated requirement missed.
- major: a likely bug, an unhandled real failure, or a regression - only when you can name the failure.
- minor: a narrow correctness or clarity problem with a small blast radius.
- nit: naming, small tidy-ups, wording - nobody would hold the PR for it.

Each finding names the file and the new-file line numbers shown at the start of each diff line \
(start_line, and end_line if it spans several) - the few lines the point is actually about, not \
the whole block around them - and a body written to the author: why it's a problem and the \
conditions under which it happens, then a concrete fix. One short paragraph, matter-of-fact, no \
flattery or filler. The finding is shown on its lines, so don't mention line numbers in the body, \
and its severity is shown beside it, so don't start the body with it. Put code in backticks, and \
keep any snippet to three lines. One finding per distinct problem.
Also give a rationale, for the reviewer deciding whether to post it (the author never sees it): \
why it matters, what in the code shows it, and how sure you are - say so plainly if you're \
unsure, here rather than in the body. Two or three sentences.

Before reporting, go through your findings once more and keep only those that meet every rule \
above, and that the author couldn't fairly answer with "it was already like that" or "that's \
deliberate". Keep nits to the few that are cheap and clearly worth it, so they don't bury what \
matters.`;

// A persona narrows where the reviewer looks; the reviewer's own bar still
// decides what it raises.
const focusNote = (focus: string) =>
  `\n\nThis review has a particular focus. It narrows where you look, and doesn't lower the bar \
for what you raise: report only what falls within it and is still worth the author's time. The \
focus:\n${focus}`;

// The whole-PR pass: read everything first, so each part is reviewed
// knowing what the rest of the PR does.
const FINDING_ITEM = REPORT_FINDINGS_TOOL.parameters.properties.findings.items;

const REPORT_BRIEF_TOOL = {
  name: "report_brief",
  description: "Report the review brief for the whole pull request.",
  parameters: {
    type: "object",
    properties: {
      brief: {
        type: "string",
        description:
          "What the PR sets out to do, the rules it has to keep (e.g. every new entity needs a delete source and a test), and choices that look odd but are deliberate. A short paragraph or a few lines.",
      },
      checks: {
        type: "array",
        description: "What to look at closely in particular parts.",
        items: {
          type: "object",
          properties: { part: { type: "string", description: "The part's title, as listed." }, check: { type: "string" } },
          required: ["part", "check"],
        },
      },
      findings: { type: "array", description: "Problems that only show across parts.", items: FINDING_ITEM },
    },
    required: ["brief", "checks", "findings"],
  },
};

const BRIEF_PROMPT = `You're about to review a pull request in parts, as a careful senior engineer. \
First read the whole of it and write a brief for yourself: what it sets out to do, the rules it has \
to keep, and choices that look odd but are deliberate - so a part isn't faulted for something \
handled elsewhere in the PR. Note anything worth checking closely in particular parts. Report as \
findings only problems that show across parts, such as a change made in one place but not its \
counterpart, or a new case left untested; problems within one part are for the part reviews.`;

// A diff bigger than this is summed up by its files instead, in each part's
// review.
const WHOLE_DIFF_LIMIT = 120_000;

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
  void usageScope.run(entry.review.usage, () => runBuiltin(owner, repo, number, context, entry, reviewer, model, focus, mcpUrl));
  return entry.review;
}

async function runBuiltin(
  owner: string,
  repo: string,
  number: string,
  context: ReviewContext,
  entry: Entry,
  reviewer: string,
  model: string | undefined,
  focus: string | undefined,
  mcpUrl: string,
) {
  const { review, controller } = entry;
  const system = focus ? SYSTEM_PROMPT + focusNote(focus) : SYSTEM_PROMPT;
  const { signal } = controller;
  try {
    const [files, conversation] = await Promise.all([
      fetchPrFiles(owner, repo, number),
      fetchPrConversation(owner, repo, number).then(conversationText, () => ""),
    ]);
    // The code around the PR, looked up alongside the whole-PR pass.
    const lookingUp = codeContext(owner, repo, number, mcpUrl);
    // What's been said on the PR already, so a point raised and settled
    // there isn't raised again.
    const said = conversation
      ? `\n\nAlready said on the PR - leave out any point raised there and answered, fixed or explained:\n${conversation}`
      : "";
    const parts: { id?: string; title: string; diff: string }[] =
      context.slices && context.slices.length > 0
        ? context.slices.map((slice) => ({
            id: slice.id,
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

    const about = [
      context.title && `PR: ${context.title}`,
      context.summary && `What it does: ${context.summary.what}\nWhy: ${context.summary.why}`,
    ]
      .filter(Boolean)
      .join("\n");
    const partList = parts.map((p, i) => `${i + 1}. ${p.title}`).join("\n");
    const wholeDiff = files.map((f) => numberedFileDiff(f)).join("\n\n");
    const fits = wholeDiff.length <= WHOLE_DIFF_LIMIT;
    const fileList = files.map((f) => `${f.filename} (+${f.additions} -${f.deletions})`).join("\n");
    const briefFocus = focus ? focusNote(focus) : "";
    const keep = async (raw: unknown, slice?: string) => {
      for (const item of Array.isArray(raw) ? raw : []) {
        const { path, start_line, end_line, body, rationale, severity } = (item ?? {}) as Record<string, unknown>;
        if (typeof body !== "string") continue;
        const finding: SubmittedFinding = {
          path: typeof path === "string" ? path : undefined,
          startLine: typeof start_line === "number" ? start_line : undefined,
          endLine: typeof end_line === "number" ? end_line : undefined,
          body,
          rationale: typeof rationale === "string" ? rationale : undefined,
          severity: typeof severity === "string" ? severity : undefined,
        };
        try {
          await submitFinding(owner, repo, number, finding, files, reviewer, slice);
        } catch {
          // Lines outside the diff: keep the point, on the file as a whole.
          if (finding.path) {
            await submitFinding(owner, repo, number, { ...finding, startLine: undefined, endLine: undefined }, files, reviewer, slice).catch(
              () => {},
            );
          }
        }
      }
    };

    // A reviewer with a persona looks through one narrow lens, which the
    // whole PR at once serves as well as its parts do: one call rather than
    // one per part, when the diff fits.
    if (focus && fits) {
      review.progress = { done: 0, total: 2, current: "the code around it", finished: [] };
      const facts = await lookingUp;
      if (review.status !== "running") return;
      const aroundIt = facts
        ? `\n\nWhat the code around the PR shows, looked up for this review - trust it over guesses about code the diff doesn't show:\n${facts}`
        : "";
      review.progress = { ...review.progress, waiting: true };
      const call = await inLane(async () => {
        signal.throwIfAborted();
        review.progress = { ...review.progress!, done: 1, current: "the PR as a whole", waiting: false };
        return chatWithTool(
          [
            { role: "system", content: `${system}${said}${aroundIt}` },
            {
              role: "user",
              content: `${about}\n\nReview the whole pull request. Its parts, for orientation:\n${partList}\n\nThe whole diff:\n\n${wholeDiff}`,
            },
          ],
          REPORT_FINDINGS_TOOL,
          signal,
          model,
        );
      }, model);
      if (review.status !== "running") return;
      await keep((call.arguments as { findings?: unknown }).findings);
      review.progress = { ...review.progress!, done: 2 };
      end(review, "done");
      return;
    }

    // First the whole PR, for the brief every part's review starts from.
    review.progress = { done: 0, total: parts.length + 1, current: "the whole PR", waiting: true, finished: [] };
    const briefCall = await inLane(() => {
      signal.throwIfAborted();
      review.progress = { ...review.progress!, waiting: false };
      return chatWithTool(
        [
          { role: "system", content: BRIEF_PROMPT + briefFocus },
          {
            role: "user",
            content: `${about}\n\nIts parts:\n${partList}\n\n${fits ? `The whole diff:\n\n${wholeDiff}` : `The files it changes:\n${fileList}`}${said}`,
          },
        ],
        REPORT_BRIEF_TOOL,
        signal,
        model,
      );
    }, model);
    if (review.status !== "running") return;
    const briefArgs = briefCall.arguments as { brief?: unknown; checks?: unknown; findings?: unknown };
    const brief = typeof briefArgs.brief === "string" ? briefArgs.brief : "";
    const checks = (Array.isArray(briefArgs.checks) ? briefArgs.checks : []).flatMap((c) => {
      const { part, check } = (c ?? {}) as { part?: unknown; check?: unknown };
      return typeof part === "string" && typeof check === "string" ? [{ part, check }] : [];
    });
    await keep(briefArgs.findings);
    review.progress = { ...review.progress, done: 1, current: "the code around it" };
    const facts = await lookingUp;
    if (review.status !== "running") return;
    const around = facts
      ? `\n\nWhat the code around the PR shows, looked up for this review - trust it over guesses about code the diff doesn't show:\n${facts}`
      : "";

    // Every part's review starts with the same block - instructions, the
    // brief, the parts and the diff - in the system prompt, where Claude Code
    // caches it; only the part itself follows.
    const shared = `${system}

## The whole pull request
${about}

Brief, from reading all of it first:
${brief || "(none)"}

Its parts:
${partList}

${fits ? `The whole diff, for context:\n\n${wholeDiff}` : `The files it changes:\n${fileList}`}${said}${around}

Raise only what still holds given the whole PR: leave out anything the brief shows is handled \
elsewhere in it, or deliberate, and anything already settled on the PR. Problems that span parts \
have been raised already.`;
    const reviewPart = async (part: (typeof parts)[number]) => {
      review.progress = { ...review.progress!, waiting: true };
      const call = await inLane(async () => {
        signal.throwIfAborted();
        review.progress = { ...review.progress!, current: part.title, waiting: false };
        const toCheck = checks.filter((c) => c.part.trim().toLowerCase() === part.title.trim().toLowerCase()).map((c) => `- ${c.check}`);
        return chatWithTool(
          [
            { role: "system", content: shared },
            {
              role: "user",
              content: `Review this part: ${part.title}${toCheck.length ? `\n\nCheck in particular:\n${toCheck.join("\n")}` : ""}\n\n${part.diff}`,
            },
          ],
          REPORT_FINDINGS_TOOL,
          signal,
          model,
        );
      }, model);
      if (review.status !== "running") return;
      await keep((call.arguments as { findings?: unknown }).findings, part.id);
      review.progress = {
        ...review.progress!,
        done: review.progress!.done + 1,
        finished: [...(review.progress!.finished ?? []), ...(part.id ? [part.id] : [])],
      };
    };
    // The first part alone writes the shared block to the cache; the rest,
    // side by side, then read it.
    const [first, ...rest] = parts;
    if (first) await reviewPart(first);
    await Promise.all(rest.map(reviewPart));
    end(review, "done");
  } catch (err) {
    if (review.status === "running") {
      review.error = (err as Error).message;
      end(review, "failed");
    }
  }
}
