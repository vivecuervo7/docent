import express from "express";
import { fetchInvolvedPrs, fetchPrStatuses,
  fetchAttachment,
  fetchPrConversation,
  fetchFileContentAtRef,
  fetchPrBaseSha,
  fetchPrFiles,
  fetchPrMeta,
} from "./github.js";
import {
  dismissGeneration,
  getGeneration,
  listGenerations,
  startGeneration,
  stopGeneration,
  type Reuse,
} from "./generation.js";
import { localhostHostValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { startSessionReview, listAgentReviews,
  DEFAULT_REVIEWER,
  REVIEWER_RE,
  dismissAgentReview,
  finishAgentReview,
  getAgentReview,
  openExternalReview,
  startBuiltinReview,
  stopAgentReview,
  type ReviewContext,
} from "./agentReview.js";
import { draftYourFeedback, type ThreadForFeedback } from "./feedback.js";
import {
  addProvider,
  externalReviewers,
  personas,
  defaultPanel,
  modelName,
  providers,
  removeProvider,
  setDefaultPanel,
  setModelName,
  updateProvider,
  type Provider,
} from "./config.js";
import { claudeCodeAvailable, CLAUDE_CODE_MODELS } from "./claudeCode.js";
import { checkSetup } from "./setup.js";
import { matchFindings } from "./grouping.js";
import { ALWAYS_ALLOWED } from "./sessions.js";
import { handleMcpRequest } from "./mcp.js";
import { deleteRecord, getRecord, keyFor, listRecords, putRecord, VersionConflict } from "./store.js";
import { codexStatus, listModelOptions, listProviderModels } from "./modelProvider.js";
import {
  buildReviewPayload,
  fetchViewer,
  findReviewSince,
  postReviewPayload,
  prepareReview,
  type Candidate,
  type CommentToPost,
  type ReviewEvent,
} from "./postReview.js";
import { replyToNote, type NoteContext, type NoteMessage } from "./notes.js";
import type { ConversationSummary, Slice } from "./types.js";

const app = express();
// Whole review records come through here, so allow more than the default.
app.use(express.json({ limit: "20mb" }));

const OWNER_REPO_RE = /^[A-Za-z0-9._-]+$/;
const NUMBER_RE = /^[0-9]+$/;

function validParams(owner: string, repo: string, number: string): boolean {
  return (
    OWNER_REPO_RE.test(owner) && OWNER_REPO_RE.test(repo) && NUMBER_RE.test(number)
  );
}

app.get("/api/pr/:owner/:repo/:number", async (req, res) => {
  const { owner, repo, number } = req.params;
  if (!validParams(owner, repo, number)) {
    return res.status(400).json({ error: "invalid owner, repo, or PR number" });
  }

  try {
    const [files, meta] = await Promise.all([
      fetchPrFiles(owner, repo, number),
      fetchPrMeta(owner, repo, number),
    ]);
    res.json({ files, meta });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.get("/api/attachment", async (req, res) => {
  const { url } = req.query;
  if (typeof url !== "string" || !url) {
    return res.status(400).json({ error: "missing url" });
  }

  try {
    const attachment = await fetchAttachment(url);
    if (!attachment) return res.status(404).end();
    res.setHeader("Content-Type", attachment.contentType);
    res.send(attachment.body);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.get("/api/pr/:owner/:repo/:number/old-content", async (req, res) => {
  const { owner, repo, number } = req.params;
  const { path } = req.query;
  if (!validParams(owner, repo, number) || typeof path !== "string" || !path) {
    return res.status(400).json({ error: "invalid owner, repo, number, or path" });
  }

  try {
    const baseSha = await fetchPrBaseSha(owner, repo, number);
    const content = await fetchFileContentAtRef(owner, repo, baseSha, path);
    res.json({ content });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// Preparing a PR's review (slices, conversation, summary) runs as a
// background generation; see generation.ts.
app.get("/api/generations", (_req, res) => {
  res.json({ generations: listGenerations() });
});

app.post("/api/pr/:owner/:repo/:number/generation", (req, res) => {
  const { owner, repo, number } = req.params;
  if (!validParams(owner, repo, number)) {
    return res.status(400).json({ error: "invalid owner, repo, or PR number" });
  }

  const reuse: Reuse = {};
  if (Array.isArray(req.body?.reuse?.slices)) reuse.slices = req.body.reuse.slices as Slice[];
  if (Array.isArray(req.body?.reuse?.conversation?.reviewers)) {
    reuse.conversation = req.body.reuse.conversation as ConversationSummary;
  }
  const fileNotes = req.body?.reuse?.fileNotes;
  if (fileNotes && typeof fileNotes === "object" && !Array.isArray(fileNotes)) {
    reuse.fileNotes = fileNotes as Reuse["fileNotes"];
  }
  res.json({ generation: startGeneration(owner, repo, number, reuse, reviewModel(req)) });
});

app.get("/api/pr/:owner/:repo/:number/generation", (req, res) => {
  const { owner, repo, number } = req.params;
  if (!validParams(owner, repo, number)) {
    return res.status(400).json({ error: "invalid owner, repo, or PR number" });
  }
  res.json({ generation: getGeneration(owner, repo, number) });
});

app.post("/api/pr/:owner/:repo/:number/generation/stop", (req, res) => {
  const { owner, repo, number } = req.params;
  if (!validParams(owner, repo, number)) {
    return res.status(400).json({ error: "invalid owner, repo, or PR number" });
  }
  res.json({ generation: stopGeneration(owner, repo, number) });
});

app.delete("/api/pr/:owner/:repo/:number/generation", (req, res) => {
  const { owner, repo, number } = req.params;
  if (!validParams(owner, repo, number)) {
    return res.status(400).json({ error: "invalid owner, repo, or PR number" });
  }
  dismissGeneration(owner, repo, number);
  res.status(204).end();
});

// The review's own model, when the request names one; otherwise the model
// picked on the start page is used.
function reviewModel(req: express.Request): string | undefined {
  const model = req.body?.model;
  return typeof model === "string" && model.trim() && model.length <= 200 ? model.trim() : undefined;
}

// Answers a question (or writes up a remark) about lines the reviewer
// selected. Held open until the model replies; see notes.ts for the lane.
app.post("/api/pr/:owner/:repo/:number/notes/reply", async (req, res) => {
  const { owner, repo, number } = req.params;
  const context = req.body?.context as NoteContext | undefined;
  const messages = req.body?.messages as NoteMessage[] | undefined;
  const model = req.body?.model;
  if (
    !validParams(owner, repo, number) ||
    typeof context?.path !== "string" ||
    typeof context?.code !== "string" ||
    !Array.isArray(messages) ||
    messages.length === 0 ||
    (model !== undefined && (typeof model !== "string" || !model || model.length > 200))
  ) {
    return res.status(400).json({ error: "invalid note" });
  }

  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    res.json({ text: await replyToNote(context, messages, controller.signal, model) });
  } catch (err) {
    if (!controller.signal.aborted) res.status(502).json({ error: (err as Error).message });
  }
});

// Drafts review comments from the reviewer's threads. Held open like a note
// reply, in the same lane.
app.post("/api/pr/:owner/:repo/:number/feedback/yours", async (req, res) => {
  const { owner, repo, number } = req.params;
  const threads = req.body?.threads as ThreadForFeedback[] | undefined;
  if (!validParams(owner, repo, number) || !Array.isArray(threads) || threads.length === 0) {
    return res.status(400).json({ error: "invalid threads" });
  }

  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    const prTitle = typeof req.body?.prTitle === "string" ? req.body.prTitle : undefined;
    res.json({ comments: await draftYourFeedback(threads, prTitle, controller.signal, reviewModel(req)) });
  } catch (err) {
    if (!controller.signal.aborted) res.status(502).json({ error: (err as Error).message });
  }
});

// Which of the PR's reviewer entries a request is about: `?reviewer=agent-2`,
// or the first one.
function reviewerParam(req: express.Request): string | null {
  const reviewer = req.query.reviewer ?? DEFAULT_REVIEWER;
  return typeof reviewer === "string" && REVIEWER_RE.test(reviewer) ? reviewer : null;
}

// Where saved PRs stand on GitHub now, for the start page.
app.post("/api/pr-statuses", async (req, res) => {
  const prs = req.body?.prs;
  if (
    !Array.isArray(prs) ||
    prs.length > 200 ||
    !prs.every((p) => p && validParams(String(p.owner), String(p.repo), String(p.number)))
  ) {
    return res.status(400).json({ error: "invalid PRs" });
  }
  try {
    res.json({
      statuses: await fetchPrStatuses(prs.map((p: Record<string, unknown>) => ({ owner: String(p.owner), repo: String(p.repo), number: String(p.number) }))),
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// Open PRs the reviewer is part of, for the start page.
app.get("/api/involved-prs", async (_req, res) => {
  try {
    res.json({ prs: await fetchInvolvedPrs() });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// Which new findings make the same point as ones already on the PR.
app.post("/api/pr/:owner/:repo/:number/findings/match", async (req, res) => {
  const { owner, repo, number } = req.params;
  const valid = (list: unknown) =>
    Array.isArray(list) &&
    list.length <= 200 &&
    list.every((f) => f && typeof f.id === "string" && typeof f.body === "string" && typeof f.location === "string");
  if (!validParams(owner, repo, number) || !valid(req.body?.fresh) || !valid(req.body?.existing)) {
    return res.status(400).json({ error: "invalid findings" });
  }
  if (!req.body.fresh.length || !req.body.existing.length) return res.json({ matches: {} });
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    res.json({ matches: Object.fromEntries(await matchFindings(req.body.fresh, req.body.existing, controller.signal)) });
  } catch (err) {
    if (!controller.signal.aborted) res.status(502).json({ error: (err as Error).message });
  }
});

// Every agent review running or waiting to be collected, across PRs.
app.get("/api/agent-reviews", (_req, res) => {
  res.json({ reviews: listAgentReviews() });
});

// The agent review: Docent's own reviewer ("builtin"), or waiting for the
// reviewer's own agent to submit findings over MCP ("external").
app.post("/api/pr/:owner/:repo/:number/agent-review", (req, res) => {
  const { owner, repo, number } = req.params;
  const mode = req.body?.mode;
  const reviewer = reviewerParam(req);
  const model = req.body?.model;
  const session = mode === "session" ? externalReviewers.list().find((p) => p.id === req.body?.session) : undefined;
  // A persona's instructions, for Docent's reviewer; none means the default.
  const persona = mode === "builtin" && req.body?.persona ? personas.list().find((p) => p.id === req.body.persona) : undefined;
  if (
    !validParams(owner, repo, number) ||
    !reviewer ||
    (mode !== "builtin" && mode !== "external" && mode !== "session") ||
    (mode === "session" && !session) ||
    (model !== undefined && (typeof model !== "string" || !model || model.length > 200))
  ) {
    return res.status(400).json({ error: "invalid PR, reviewer, mode or model" });
  }
  const context: ReviewContext = {
    title: typeof req.body?.context?.title === "string" ? req.body.context.title : undefined,
    summary: req.body?.context?.summary ?? null,
    slices: Array.isArray(req.body?.context?.slices) ? (req.body.context.slices as Slice[]) : null,
  };
  const review =
    mode === "builtin"
      ? startBuiltinReview(owner, repo, number, context, reviewer, model, persona?.instructions)
      : session
        ? startSessionReview(owner, repo, number, context, session, `http://localhost:${PORT}/mcp`, reviewer)
        : openExternalReview(owner, repo, number, context, reviewer);
  res.json({ review });
});

app.get("/api/pr/:owner/:repo/:number/agent-review", (req, res) => {
  const { owner, repo, number } = req.params;
  const reviewer = reviewerParam(req);
  if (!validParams(owner, repo, number) || !reviewer) {
    return res.status(400).json({ error: "invalid PR or reviewer" });
  }
  res.json({ review: getAgentReview(owner, repo, number, reviewer) });
});

app.post("/api/pr/:owner/:repo/:number/agent-review/:action", (req, res) => {
  const { owner, repo, number, action } = req.params;
  const reviewer = reviewerParam(req);
  if (!validParams(owner, repo, number) || !reviewer || (action !== "stop" && action !== "finish")) {
    return res.status(400).json({ error: "invalid PR, reviewer or action" });
  }
  const review =
    action === "stop"
      ? stopAgentReview(owner, repo, number, reviewer)
      : finishAgentReview(owner, repo, number, reviewer);
  res.json({ review });
});

app.delete("/api/pr/:owner/:repo/:number/agent-review", (req, res) => {
  const { owner, repo, number } = req.params;
  const reviewer = reviewerParam(req);
  if (!validParams(owner, repo, number) || !reviewer) {
    return res.status(400).json({ error: "invalid PR or reviewer" });
  }
  // `?force=1` when the reviewer entry itself is removed, stopping it if running.
  dismissAgentReview(owner, repo, number, reviewer, req.query.force === "1");
  res.status(204).end();
});

// Post review: who's reviewing (GitHub won't let you approve or request
// changes on your own PR), preparing the review, and posting it.
app.get("/api/pr/:owner/:repo/:number/review/viewer", async (req, res) => {
  const { owner, repo, number } = req.params;
  if (!validParams(owner, repo, number)) {
    return res.status(400).json({ error: "invalid owner, repo, or PR number" });
  }
  try {
    const [viewer, author] = await Promise.all([
      fetchViewer(),
      fetchPrConversation(owner, repo, number).then((c) => c.prAuthor),
    ]);
    res.json({ viewer, author });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.post("/api/pr/:owner/:repo/:number/review/prepare", async (req, res) => {
  const { owner, repo, number } = req.params;
  const candidates = req.body?.candidates as Candidate[] | undefined;
  if (!validParams(owner, repo, number) || !Array.isArray(candidates)) {
    return res.status(400).json({ error: "invalid candidates" });
  }
  if (candidates.length === 0) return res.json({ comments: [], dropped: [], body: "", inBody: [] });

  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    res.json(await prepareReview(owner, repo, number, candidates, controller.signal, reviewModel(req)));
  } catch (err) {
    if (!controller.signal.aborted) res.status(502).json({ error: (err as Error).message });
  }
});

app.get("/api/pr/:owner/:repo/:number/review/posted-since", async (req, res) => {
  const { owner, repo, number } = req.params;
  const since = Number(req.query.since);
  if (!validParams(owner, repo, number) || !Number.isFinite(since)) {
    return res.status(400).json({ error: "invalid PR or time" });
  }
  try {
    res.json({ url: await findReviewSince(owner, repo, number, since) });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// With dryRun, returns exactly what would be sent without sending it.
app.post("/api/pr/:owner/:repo/:number/review/post", async (req, res) => {
  const { owner, repo, number } = req.params;
  const event = req.body?.event as ReviewEvent | undefined;
  const comments = req.body?.comments as CommentToPost[] | undefined;
  if (
    !validParams(owner, repo, number) ||
    (event !== "COMMENT" && event !== "APPROVE" && event !== "REQUEST_CHANGES") ||
    !Array.isArray(comments)
  ) {
    return res.status(400).json({ error: "invalid review" });
  }
  try {
    const summary = typeof req.body?.summary === "string" ? req.body.summary : "";
    const payload = await buildReviewPayload(owner, repo, number, event, summary, comments);
    if (req.body?.dryRun) return res.json({ payload });
    res.json({ payload, ...(await postReviewPayload(owner, repo, number, payload)) });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// MCP, for the reviewer's own agent. Local only: the host check stops other
// sites the browser has open from reaching it.
app.post("/mcp", localhostHostValidation(), handleMcpRequest);
app.all("/mcp", (_req, res) => {
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
});

// The models that can be picked right now, and which one Docent uses. When
// the picked one isn't among them (its provider was removed, or none was
// ever picked), the first that is takes its place.
app.get("/api/models", async (_req, res) => {
  const options = await listModelOptions();
  let selected = modelName();
  if (options.length && !options.some((o) => o.id === selected)) {
    selected = options[0].id;
    setModelName(selected);
  }
  res.json({ options, selected });
});

app.put("/api/models/selected", (req, res) => {
  const model = req.body?.model;
  if (typeof model !== "string" || !model.trim()) {
    return res.status(400).json({ error: "invalid model" });
  }
  setModelName(model.trim());
  res.json({ selected: modelName() });
});

// The Settings page: Claude Code, Codex, and the OpenAI-compatible providers with
// whether each answers. A provider's key is never sent back, only whether
// it has one.
const publicProvider = ({ apiKey, ...rest }: Provider) => ({ ...rest, hasKey: !!apiKey });

app.get("/api/providers", async (_req, res) => {
  const list = providers();
  const [claude, codex, statuses] = await Promise.all([claudeCodeAvailable(), codexStatus(), Promise.all(list.map(listProviderModels))]);
  res.json({
    claudeCode: { installed: claude, models: claude ? CLAUDE_CODE_MODELS : [] },
    codex,
    providers: list.map((p, i) => ({ ...publicProvider(p), ...statuses[i] })),
  });
});

// Checks and tidies a provider's fields from the page; `partial` for an edit.
function providerFields(body: unknown, partial: boolean): { fields: Record<string, unknown> } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  if (b.name !== undefined || !partial) {
    if (typeof b.name !== "string" || !b.name.trim() || b.name.length > 60) return { error: "Give it a name, up to 60 characters." };
    fields.name = b.name.trim();
  }
  if (b.baseUrl !== undefined || !partial) {
    const url = typeof b.baseUrl === "string" ? b.baseUrl.trim().replace(/\/+$/, "") : "";
    if (!/^https?:\/\/[^\s]+$/.test(url) || url.length > 500) return { error: "The address should start with http:// or https://." };
    fields.baseUrl = url;
  }
  if (b.concurrency !== undefined || !partial) {
    const n = b.concurrency ?? 1;
    if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > 16) return { error: "Requests at once should be from 1 to 16." };
    fields.concurrency = n;
  }
  if (b.apiKey !== undefined) {
    if (b.apiKey !== null && (typeof b.apiKey !== "string" || b.apiKey.length > 1000)) return { error: "That key isn't valid." };
    fields.apiKey = typeof b.apiKey === "string" && b.apiKey.trim() ? b.apiKey.trim() : partial ? null : undefined;
  }
  return { fields };
}

app.post("/api/providers", (req, res) => {
  const checked = providerFields(req.body, false);
  if ("error" in checked) return res.status(400).json(checked);
  res.json({ provider: publicProvider(addProvider(checked.fields as Omit<Provider, "id">)) });
});

app.put("/api/providers/:id", (req, res) => {
  const checked = providerFields(req.body, true);
  if ("error" in checked) return res.status(400).json(checked);
  const provider = updateProvider(req.params.id, checked.fields);
  if (!provider) return res.status(404).json({ error: "No such provider." });
  res.json({ provider: publicProvider(provider) });
});

app.delete("/api/providers/:id", (req, res) => {
  if (!removeProvider(req.params.id)) return res.status(404).json({ error: "No such provider." });
  res.status(204).end();
});

// What's set up on this machine, for the Getting started page.
app.get("/api/setup", async (_req, res) => {
  res.json(await checkSetup());
});

// Personas (Docent's reviewer with a point of view) and external reviewers
// (the reviewer's own sessions), for the Settings page and the panel.
function textField(b: Record<string, unknown>, key: string, max: number, required: boolean, fields: Record<string, unknown>, message: string) {
  if (b[key] === undefined && !required) return null;
  if (b[key] === null && !required) {
    fields[key] = null;
    return null;
  }
  if (typeof b[key] !== "string" || (required && !(b[key] as string).trim()) || (b[key] as string).length > max) return message;
  fields[key] = (b[key] as string).trim() || null;
  return null;
}

function personaFields(body: unknown, partial: boolean): { fields: Record<string, unknown> } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  const error =
    textField(b, "name", 60, !partial || b.name !== undefined, fields, "Give it a name, up to 60 characters.") ??
    textField(b, "instructions", 4000, !partial || b.instructions !== undefined, fields, "Say what it looks for.");
  return error ? { error } : { fields };
}

function externalFields(body: unknown, partial: boolean): { fields: Record<string, unknown> } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  if (b.runner !== undefined || !partial) {
    if (b.runner !== "claude-code" && b.runner !== "codex") return { error: "Choose Claude Code or Codex." };
    fields.runner = b.runner;
  }
  const error =
    textField(b, "name", 60, !partial || b.name !== undefined, fields, "Give it a name, up to 60 characters.") ??
    textField(b, "command", 2000, !partial || b.command !== undefined, fields, "Give it a prompt to run.") ??
    textField(b, "model", 200, false, fields, "That model isn't valid.") ??
    textField(b, "tools", 500, false, fields, "Those tools aren't valid.");
  return error ? { error } : { fields };
}

function crud(path: string, store: typeof personas | typeof externalReviewers, check: typeof personaFields, extra: () => object = () => ({})) {
  app.get(path, (_req, res) => res.json({ items: store.list(), ...extra() }));
  app.post(path, (req, res) => {
    const checked = check(req.body, false);
    if ("error" in checked) return res.status(400).json(checked);
    const fields = Object.fromEntries(Object.entries(checked.fields).filter(([, v]) => v !== null));
    res.json({ item: (store.add as (f: Record<string, unknown>) => object)(fields) });
  });
  app.put(`${path}/:id`, (req, res) => {
    const checked = check(req.body, true);
    if ("error" in checked) return res.status(400).json(checked);
    const item = store.update(req.params.id, checked.fields);
    if (!item) return res.status(404).json({ error: "Not found." });
    res.json({ item });
  });
  app.delete(`${path}/:id`, (req, res) => {
    if (!store.remove(req.params.id)) return res.status(404).json({ error: "Not found." });
    res.status(204).end();
  });
}
crud("/api/personas", personas, personaFields);
crud("/api/external-reviewers", externalReviewers, externalFields, () => ({ alwaysAllowed: ALWAYS_ALLOWED }));

// The review panel a new PR starts with, the same for every repo.
app.get("/api/panel/default", (_req, res) => {
  res.json({ panel: defaultPanel() });
});

app.put("/api/panel/default", (req, res) => {
  const panel = req.body?.panel;
  const valid = (e: unknown) => {
    const { runs, persona } = (e ?? {}) as Record<string, unknown>;
    return typeof runs === "string" && !!runs.trim() && runs.length <= 200 && (persona === undefined || (typeof persona === "string" && persona.length <= 40));
  };
  if (!Array.isArray(panel) || panel.length === 0 || panel.length > 10 || !panel.every(valid)) {
    return res.status(400).json({ error: "invalid panel" });
  }
  setDefaultPanel(panel.map((e: { runs: string; persona?: string }) => ({ runs: e.runs.trim(), ...(e.persona ? { persona: e.persona } : {}) })));
  res.json({ panel: defaultPanel() });
});

// Saved reviews: one record per PR, owned here rather than in the browser so
// agents can read and write them too. See store.ts.
app.get("/api/prs", (_req, res) => {
  res.json({
    prs: listRecords().flatMap(({ key, record }) => {
      const [owner, repo, number] = key.split("/");
      return owner && repo && number ? [{ owner, repo, number, record }] : [];
    }),
  });
});

app.get("/api/prs/:owner/:repo/:number", (req, res) => {
  const { owner, repo, number } = req.params;
  if (!validParams(owner, repo, number)) {
    return res.status(400).json({ error: "invalid owner, repo, or PR number" });
  }
  res.json(getRecord(keyFor(owner, repo, number)));
});

// The version is the one the change was made from; a stale one gets a 409
// with the record as it is now, to redo the change on.
app.put("/api/prs/:owner/:repo/:number", (req, res) => {
  const { owner, repo, number } = req.params;
  const { record, version } = req.body ?? {};
  if (
    !validParams(owner, repo, number) ||
    typeof record !== "object" ||
    record === null ||
    !Number.isInteger(version)
  ) {
    return res.status(400).json({ error: "invalid record" });
  }
  try {
    res.json({ version: putRecord(keyFor(owner, repo, number), record, version) });
  } catch (err) {
    if (err instanceof VersionConflict) return res.status(409).json(err.current);
    throw err;
  }
});

app.delete("/api/prs/:owner/:repo/:number", (req, res) => {
  const { owner, repo, number } = req.params;
  if (!validParams(owner, repo, number)) {
    return res.status(400).json({ error: "invalid owner, repo, or PR number" });
  }
  deleteRecord(keyFor(owner, repo, number));
  res.status(204).end();
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`docent backend listening on http://localhost:${PORT}`);
});
