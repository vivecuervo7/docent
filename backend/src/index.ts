import express from "express";
import {
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
import {
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
import { handleMcpRequest } from "./mcp.js";
import { deleteRecord, getRecord, keyFor, listRecords, putRecord, VersionConflict } from "./store.js";
import { listModelOptions, listProviderModels } from "./modelProvider.js";
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
  res.json({ generation: startGeneration(owner, repo, number, reuse) });
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

// Answers a question (or writes up a remark) about lines the reviewer
// selected. Held open until the model replies; see notes.ts for the lane.
app.post("/api/pr/:owner/:repo/:number/notes/reply", async (req, res) => {
  const { owner, repo, number } = req.params;
  const context = req.body?.context as NoteContext | undefined;
  const messages = req.body?.messages as NoteMessage[] | undefined;
  if (
    !validParams(owner, repo, number) ||
    typeof context?.path !== "string" ||
    typeof context?.code !== "string" ||
    !Array.isArray(messages) ||
    messages.length === 0
  ) {
    return res.status(400).json({ error: "invalid note" });
  }

  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    res.json({ text: await replyToNote(context, messages, controller.signal) });
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
    res.json({ comments: await draftYourFeedback(threads, prTitle, controller.signal) });
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

// The agent review: Docent's own reviewer ("builtin"), or waiting for the
// reviewer's own agent to submit findings over MCP ("external").
app.post("/api/pr/:owner/:repo/:number/agent-review", (req, res) => {
  const { owner, repo, number } = req.params;
  const mode = req.body?.mode;
  const reviewer = reviewerParam(req);
  const model = req.body?.model;
  if (
    !validParams(owner, repo, number) ||
    !reviewer ||
    (mode !== "builtin" && mode !== "external") ||
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
      ? startBuiltinReview(owner, repo, number, context, reviewer, model)
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
    res.json(await prepareReview(owner, repo, number, candidates, controller.signal));
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

// The Settings page: Claude Code, and the OpenAI-compatible providers with
// whether each answers. A provider's key is never sent back, only whether
// it has one.
const publicProvider = ({ apiKey, ...rest }: Provider) => ({ ...rest, hasKey: !!apiKey });

app.get("/api/providers", async (_req, res) => {
  const list = providers();
  const [claude, statuses] = await Promise.all([claudeCodeAvailable(), Promise.all(list.map(listProviderModels))]);
  res.json({
    claudeCode: { installed: claude, models: claude ? CLAUDE_CODE_MODELS : [] },
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

// The review panel a new PR starts with, the same for every repo.
app.get("/api/panel/default", (_req, res) => {
  res.json({ panel: defaultPanel() });
});

app.put("/api/panel/default", (req, res) => {
  const panel = req.body?.panel;
  if (
    !Array.isArray(panel) ||
    panel.length === 0 ||
    panel.length > 10 ||
    panel.some((p) => typeof p !== "string" || !p.trim() || p.length > 200)
  ) {
    return res.status(400).json({ error: "invalid panel" });
  }
  setDefaultPanel(panel.map((p: string) => p.trim()));
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
